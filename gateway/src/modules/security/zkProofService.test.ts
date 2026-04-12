import { describe, it, expect, vi, beforeAll } from 'vitest';
import { zkProofService } from './zkProofService.js';
import axios from 'axios';

// Mock Axios to avoid real network calls to HAPI FHIR
vi.mock('axios');

const mockConsentCacheFindMany = vi.fn().mockResolvedValue([]);

vi.mock('../../db/client.js', () => ({
    prisma: {
        consentCache: {
            findMany: (...args: any[]) => mockConsentCacheFindMany(...args)
        }
    }
}));

// Define constants locally for the test (needed for path resolution even if mocked, though service uses internal path)
import path from 'path';
const CIRCUITS_BUILD_DIR = path.resolve(__dirname, "../../../circuits/build");
const CIRCUIT_WASM = path.join(CIRCUITS_BUILD_DIR, "AccessIsAllowed_js/AccessIsAllowed.wasm");
const CIRCUIT_ZKEY = path.join(CIRCUITS_BUILD_DIR, "AccessIsAllowed_final.zkey");

// Mock snarkjs object
const mockSnarkJS = {
    groth16: {
        fullProve: vi.fn().mockResolvedValue({
            proof: { pi_a: [], pi_b: [], pi_c: [], protocol: "groth16", curve: "bn128" },
            // Public signals: [proofOfPolicyMatch, currentTimestamp, accessEventHash, isValid, blindedPatientId, blindedAccessHash, nullifierHash]
            publicSignals: ["12345", "1677721600", "54321", "1", "999", "888", "777"]
        }),
        exportSolidityCallData: vi.fn().mockResolvedValue('["0x1"], [["0x2"]], ["0x3"], ["0xPolicy", "0xTime", "0xEvent", "0xValid", "0xBlindedId", "0xBlindedAccess", "0xNullifier"]')
    }
};

describe('ZKProofService Integration', () => {
    beforeAll(async () => {
        // Init service (loads Poseidon)
        await zkProofService.initialize();
        // Inject mock because Vitest has issues with snarkjs web-workers
        zkProofService.setSnarkJS(mockSnarkJS);
    });

    it('should generate a valid proof for a compliant access request', async () => {
        // 1. Mock valid FHIR Consent
        const mockConsent = {
            resourceType: "Consent",
            id: "consent-123",
            status: "active",
            scope: { coding: [{ code: "patient-privacy" }] },
            patient: { reference: "Patient/123" },
            provision: {
                period: {
                    start: "2020-01-01",
                    end: "2030-01-01"
                },
                class: [{ code: "http://hl7.org/fhir/resource-types/Observation" }] // Matches requested resource
            }
        };

        // Mock axios response
        (axios.get as any).mockResolvedValue({
            data: {
                entry: [{ resource: mockConsent }]
            }
        });

        // 2. Request Access
        const request = {
            patientId: "123",
            clinicianId: "practitioner-456",
            resourceId: "http://hl7.org/fhir/resource-types/Observation", // Must match consent class for Phase 1 circuit
            resourceType: "Observation",
            patientNullifier: "1234567890",
            sessionNonce: "987654321"
        };

        // 3. Generate Proof (Mocked)
        const result = await zkProofService.generateAccessProof(request);

        // 4. Verification
        expect(result).toBeDefined();
        expect(result.proof).toBeDefined();
        expect(result.publicSignals).toBeDefined();
        // AccessIsAllowedSecure has 7 public signals (inputs + outputs)
        expect(result.publicSignals.length).toBe(7);

        console.log("Proof generated successfully (Mocked):");
        console.log("Public Signals:", result.publicSignals);
    }, 30000);

    it('should reject access when consent does not authorize the clinician', async () => {
        const consentWithSpecificClinician = {
            resourceType: "Consent",
            id: "consent-actor-bound",
            status: "active",
            patient: { reference: "Patient/123" },
            provision: {
                period: {
                    start: "2020-01-01",
                    end: "2030-01-01"
                },
                class: [{ code: "Observation" }],
                actor: [{
                    reference: {
                        reference: "Practitioner/practitioner-allowed"
                    }
                }]
            }
        };

        (axios.get as any).mockResolvedValue({
            data: {
                entry: [{ resource: consentWithSpecificClinician }]
            }
        });

        const request = {
            patientId: "123",
            clinicianId: "practitioner-blocked",
            resourceId: "Observation",
            resourceType: "Observation",
            patientNullifier: "1234567890",
            sessionNonce: "987654321"
        };

        await expect(zkProofService.generateAccessProof(request))
            .rejects
            .toThrow("CONSENT_PRACTITIONER_MISMATCH");
    });
});
