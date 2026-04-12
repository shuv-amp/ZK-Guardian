/**
 * E2E Tests: Complete Consent Flow
 * 
 * Full journey tests from consent request to blockchain audit.
 * These tests validate the entire ZK Guardian pipeline.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import { ethers } from 'ethers';
import axios from 'axios';

// Test configuration
const GATEWAY_URL = process.env.TEST_GATEWAY_URL || 'http://localhost:3000';
const WS_URL = process.env.TEST_WS_URL || 'ws://localhost:3000/ws/consent';
const POLYGON_RPC = process.env.POLYGON_AMOY_RPC || 'https://rpc-amoy.polygon.technology';
const AUDIT_CONTRACT = process.env.AUDIT_CONTRACT_ADDRESS;

// Timeout configuration for slow operations
const PROOF_TIMEOUT = 30000; // 30s for proof generation
const CONSENT_TIMEOUT = 60000; // 60s for consent handshake
const TX_TIMEOUT = 120000; // 2min for blockchain confirmation
const runE2ETests = process.env.RUN_E2E_TESTS === 'true';

describe.skipIf(!runE2ETests)('E2E: Complete Consent Flow', () => {
    let provider: ethers.JsonRpcProvider;
    let testToken: string;

    beforeAll(async () => {
        provider = new ethers.JsonRpcProvider(POLYGON_RPC);

        // Get test token (in real E2E, this comes from SMART auth)
        testToken = await getTestToken();
    });

    describe('SUCCESS: Normal Access Flow', () => {
        it('should complete consent -> proof -> audit journey', async () => {
            const patientId = `test-patient-${Date.now()}`;
            const clinicianId = 'test-clinician-001';
            const resourceType = 'Observation';

            // Step 1: Create test consent in FHIR
            const consent = await createTestConsent(patientId, ['Observation', 'DiagnosticReport']);
            expect(consent.id).toBeDefined();

            // Step 2: Initiate access request via WebSocket
            const { requestId, ws } = await initiateAccessRequest(
                patientId,
                clinicianId,
                resourceType
            );
            expect(requestId).toBeDefined();

            // Step 3: Simulate patient approval
            const approvalResult = await approveConsent(requestId, patientId);
            expect(approvalResult.approved).toBe(true);
            expect(approvalResult.nullifier).toBeDefined();

            // Step 4: Wait for proof generation
            const proofResult = await waitForProofGeneration(ws, PROOF_TIMEOUT);
            expect(proofResult.proof).toBeDefined();
            expect(proofResult.publicSignals).toHaveLength(7);

            // Step 5: Verify audit log in database
            const auditLog = await getAuditLog(proofResult.accessEventHash);
            expect(auditLog).toBeDefined();
            expect(auditLog.patientId).toBe(patientId);

            // Step 6: Verify on blockchain (if contract deployed)
            if (AUDIT_CONTRACT) {
                const blockchainRecord = await verifyBlockchainAudit(
                    proofResult.accessEventHash
                );
                expect(blockchainRecord.timestamp).toBeGreaterThan(0);
            }

            ws.close();
        }, TX_TIMEOUT);

        it('should handle multiple concurrent consent requests', async () => {
            const requests = Array.from({ length: 5 }, (_, i) => ({
                patientId: `concurrent-patient-${i}`,
                clinicianId: `concurrent-clinician-${i}`,
                resourceType: 'Observation'
            }));

            const results = await Promise.all(
                requests.map(req => executeFullFlow(req))
            );

            expect(results.filter(r => r.success)).toHaveLength(5);
        }, TX_TIMEOUT * 2);
    });

    describe('FAILURE: Access Denied Scenarios', () => {
        it('should deny access for non-consented resource type', async () => {
            const patientId = `test-patient-noconsent-${Date.now()}`;

            // Create consent for Observation only
            await createTestConsent(patientId, ['Observation']);

            // Request MedicationRequest (not consented)
            const { ws } = await initiateAccessRequest(
                patientId,
                'clinician-001',
                'MedicationRequest'
            );

            const result = await waitForProofGeneration(ws, PROOF_TIMEOUT).catch(e => e);
            expect(result.message).toContain('CATEGORY_NOT_ALLOWED');

            ws.close();
        }, PROOF_TIMEOUT + 5000);

        it('should deny access for expired consent', async () => {
            const patientId = `test-patient-expired-${Date.now()}`;

            // Create expired consent
            await createTestConsent(patientId, ['Observation'], {
                validFrom: '2020-01-01',
                validTo: '2020-12-31' // Expired
            });

            const { ws } = await initiateAccessRequest(
                patientId,
                'clinician-001',
                'Observation'
            );

            const result = await waitForProofGeneration(ws, PROOF_TIMEOUT).catch(e => e);
            expect(result.message).toContain('CONSENT_EXPIRED');

            ws.close();
        }, PROOF_TIMEOUT + 5000);

        it('should deny access when patient denies consent request', async () => {
            const patientId = `test-patient-deny-${Date.now()}`;
            await createTestConsent(patientId, ['Observation']);

            const { requestId, ws } = await initiateAccessRequest(
                patientId,
                'clinician-001',
                'Observation'
            );

            // Patient explicitly denies
            await denyConsent(requestId, patientId);

            const result = await waitForProofGeneration(ws, PROOF_TIMEOUT).catch(e => e);
            expect(result.message).toContain('CONSENT_DENIED');

            ws.close();
        }, CONSENT_TIMEOUT);

        it('should timeout when patient does not respond', async () => {
            const patientId = `test-patient-timeout-${Date.now()}`;
            await createTestConsent(patientId, ['Observation']);

            const { ws } = await initiateAccessRequest(
                patientId,
                'clinician-001',
                'Observation'
            );

            // Don't approve - wait for timeout
            const result = await waitForProofGeneration(ws, 35000).catch(e => e);
            expect(result.message).toContain('CONSENT_TIMEOUT');

            ws.close();
        }, 40000);
    });

    describe('BREAK-GLASS: Emergency Access', () => {
        it('should allow break-glass access with audit trail', async () => {
            const patientId = `test-patient-breakglass-${Date.now()}`;

            const response = await axios.post(
                `${GATEWAY_URL}/api/break-glass/${patientId}`,
                {
                    reason: 'LIFE_THREATENING_EMERGENCY',
                    justification: 'Patient unconscious in ER, immediate access to allergies required',
                    clinicianSignature: 'Dr. Emergency Test'
                },
                { headers: { Authorization: `Bearer ${testToken}` } }
            );

            expect(response.status).toBe(201);
            expect(response.data.sessionId).toBeDefined();
            expect(response.data.warning).toContain('logged and will be audited');

            // Verify break-glass event in database
            const event = await getBreakGlassEvent(response.data.sessionId);
            expect(event).toBeDefined();
            expect(event.reviewed).toBe(false); // Pending review
        });
    });
});

// Helper functions

async function getTestToken(): Promise<string> {
    // In real E2E tests, this would authenticate via SMART on FHIR
    // For local testing, we use a mock token
    return 'test-token-e2e';
}

async function createTestConsent(
    patientId: string,
    resourceCategories: string[],
    validity?: { validFrom: string; validTo: string }
): Promise<{ id: string }> {
    const now = new Date();
    const nextYear = new Date(now.getFullYear() + 1, 11, 31);

    const consent = {
        resourceType: 'Consent',
        id: `consent-${patientId}`,
        status: 'active',
        patient: { reference: `Patient/${patientId}` },
        dateTime: now.toISOString(),
        provision: {
            type: 'permit',
            period: {
                start: validity?.validFrom || now.toISOString(),
                end: validity?.validTo || nextYear.toISOString()
            },
            class: resourceCategories.map(cat => ({ code: cat }))
        }
    };

    // POST to HAPI FHIR (or mock FHIR server)
    const fhirUrl = process.env.HAPI_FHIR_URL || 'http://localhost:8080/fhir';
    const response = await axios.put(
        `${fhirUrl}/Consent/${consent.id}`,
        consent,
        { headers: { 'Content-Type': 'application/fhir+json' } }
    );

    return { id: response.data.id };
}

async function initiateAccessRequest(
    patientId: string,
    clinicianId: string,
    resourceType: string
): Promise<{ requestId: string; ws: WebSocket }> {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(WS_URL);

        ws.on('open', () => {
            ws.send(JSON.stringify({
                type: 'CLINICIAN_CONNECT',
                clinicianId,
                patientId,
                resourceType,
                purpose: 'E2E Test'
            }));
        });

        ws.on('message', (data: Buffer) => {
            const message = JSON.parse(data.toString());
            if (message.type === 'CONSENT_REQUEST') {
                resolve({ requestId: message.requestId, ws });
            }
        });

        ws.on('error', reject);
        setTimeout(() => reject(new Error('WebSocket connection timeout')), 10000);
    });
}

async function approveConsent(
    requestId: string,
    patientId: string
): Promise<{ approved: boolean; nullifier: string }> {
    // Simulate mobile app approval
    const response = await axios.post(
        `${GATEWAY_URL}/api/patient/${patientId}/consent-response`,
        {
            requestId,
            approved: true,
            nullifier: `0x${Date.now().toString(16)}`,
            sessionNonce: Date.now().toString()
        }
    );

    return response.data;
}

async function denyConsent(
    requestId: string,
    patientId: string
): Promise<void> {
    await axios.post(
        `${GATEWAY_URL}/api/patient/${patientId}/consent-response`,
        {
            requestId,
            approved: false
        }
    );
}

async function waitForProofGeneration(
    ws: WebSocket,
    timeout: number
): Promise<{ proof: any; publicSignals: any[]; accessEventHash: string }> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error('CONSENT_TIMEOUT'));
        }, timeout);

        ws.on('message', (data: Buffer) => {
            const message = JSON.parse(data.toString());

            if (message.type === 'PROOF_GENERATED') {
                clearTimeout(timer);
                resolve(message);
            }

            if (message.type === 'ERROR') {
                clearTimeout(timer);
                reject(new Error(message.message));
            }
        });
    });
}

async function getAuditLog(accessEventHash: string): Promise<any> {
    const response = await axios.get(
        `${GATEWAY_URL}/api/audit/${accessEventHash}`
    );
    return response.data;
}

async function verifyBlockchainAudit(accessEventHash: string): Promise<{ timestamp: number }> {
    const provider = new ethers.JsonRpcProvider(POLYGON_RPC);
    const contract = new ethers.Contract(
        AUDIT_CONTRACT!,
        ['function getAuditTimestamp(bytes32) view returns (uint64)'],
        provider
    );

    const timestamp = await contract.getAuditTimestamp(accessEventHash);
    return { timestamp: Number(timestamp) };
}

async function getBreakGlassEvent(sessionId: string): Promise<any> {
    const response = await axios.get(
        `${GATEWAY_URL}/api/break-glass/session/${sessionId}`
    );
    return response.data;
}

async function executeFullFlow(params: {
    patientId: string;
    clinicianId: string;
    resourceType: string;
}): Promise<{ success: boolean }> {
    try {
        await createTestConsent(params.patientId, [params.resourceType]);
        const { requestId, ws } = await initiateAccessRequest(
            params.patientId,
            params.clinicianId,
            params.resourceType
        );
        await approveConsent(requestId, params.patientId);
        await waitForProofGeneration(ws, PROOF_TIMEOUT);
        ws.close();
        return { success: true };
    } catch {
        return { success: false };
    }
}
