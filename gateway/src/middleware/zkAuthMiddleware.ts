
import { Request, Response, NextFunction } from 'express';
import { zkProofService, AccessRequest } from '../services/zkProofService.js';
import { consentHandshakeService } from '../services/consentHandshake.js';
import { replayProtection } from '../services/replayProtection.js';
import axios from 'axios';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../lib/logger.js';
import { accessRequestsCounter, consentDenialsCounter } from '../metrics/prometheus.js';

const HAPI_FHIR_URL = process.env.HAPI_FHIR_URL || "http://localhost:8080/fhir";

// We only want to incur the overhead of ZK proofs for sensitive clinical data.
// Infrastructure resources like Conformance/StructureDefinition can be skipped.
const CLINICAL_RESOURCES = [
    "Patient",
    "Observation",
    "Condition",
    "MedicationRequest",
    "DiagnosticReport",
    "Encounter",
    "Immunization",
    "Procedure"
];

// Placeholder for the actual blockchain transaction. 
// We'll replace this with the ethers.js contract call once the smart contract is deployed on Amoy.
const submitToBlockchain = async (proofResult: any) => {
    // Simulate network latency for now
    await new Promise(resolve => setTimeout(resolve, 50));
    return {
        txHash: "0x" + crypto.randomBytes(32).toString('hex'),
        blockNumber: 12345
    };
};

/**
 * Helper to create a temporary FHIR Consent resource upon patient approval.
 * Valid for 1 hour.
 */
const createJitConsent = async (accessRequest: AccessRequest) => {
    const consentId = uuidv4();
    const now = new Date();
    const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);

    const consentResource = {
        resourceType: "Consent",
        id: consentId,
        status: "active",
        scope: {
            coding: [{
                system: "http://terminology.hl7.org/CodeSystem/consentscope",
                code: "patient-privacy"
            }]
        },
        category: [{
            coding: [{
                system: "http://terminology.hl7.org/CodeSystem/consentcategorycodes",
                code: "acd" // Advance Care Directive (Generic placeholder)
            }]
        }],
        patient: { reference: `Patient/${accessRequest.patientId}` },
        dateTime: now.toISOString(),
        // We restrict this consent specifically to the requested interaction
        provision: {
            type: "permit",
            period: {
                start: now.toISOString(),
                end: oneHourLater.toISOString()
            },
            // Logic: We grant access to ALL resources of this type for simplicity in Phase 2,
            // or we could be specific. Let's allow the Category (ResourceType).
            class: [{
                code: accessRequest.resourceType
            }]
        }
    };

    try {
        await axios.put(`${HAPI_FHIR_URL}/Consent/${consentId}`, consentResource);
        console.log(`[ZK Middleware] JIT Consent created: ${consentId}`);
        return consentId;
    } catch (e: any) {
        console.error(`[ZK Middleware] Failed to create JIT Consent: ${e.message}`);
        throw new Error("CONSENT_CREATION_FAILED");
    }
};

export const zkAuthMiddleware = async (req: Request, res: Response, next: NextFunction) => {
    // 1. Identify Resource Type
    const pathParts = req.path.split('/').filter(p => p);
    const resourceType = pathParts[0];

    // Skip if not a targeted clinical resource
    if (!resourceType || !CLINICAL_RESOURCES.includes(resourceType)) {
        return next();
    }

    // 2. Validate Context
    const smartContext = req.smartContext;
    if (!smartContext || !smartContext.patient) {
        console.warn("[ZK Middleware] Missing SMART context for clinical resource");
        return res.status(401).json({ error: "Missing SMART context for clinical access audit" });
    }

    // 3. Determine Resource ID
    let resourceId = "";
    if (pathParts[1]) {
        resourceId = pathParts[1];
    } else {
        const queryStr = JSON.stringify(req.query);
        resourceId = crypto.createHash("sha256").update(queryStr).digest("hex").slice(0, 16);
    }

    const accessRequest: AccessRequest = {
        patientId: smartContext.patient,
        clinicianId: smartContext.practitioner || smartContext.sub || "unknown",
        resourceId,
        resourceType
    };

    const performAudit = async (request: AccessRequest): Promise<void> => {
        logger.info({ resourceType, resourceId }, 'Initiating ZK Audit');
        accessRequestsCounter.inc({ resource_type: resourceType, status: 'initiated' });

        // Generate Proof
        const proofResult = await zkProofService.generateAccessProof(request);

        // CRITICAL: Check for replay attack BEFORE blockchain submission
        const replayCheck = await replayProtection.checkAndReserve(proofResult.proofHash, {
            accessEventHash: proofResult.publicSignals[2] || '',
            patientId: request.patientId,
            clinicianId: request.clinicianId,
            resourceType: request.resourceType
        });

        if (!replayCheck.isNew) {
            logger.warn({
                proofHash: proofResult.proofHash,
                existingEntry: replayCheck.existingEntry
            }, 'Replay attack detected');
            accessRequestsCounter.inc({ resource_type: resourceType, status: 'replay_detected' });

            throw new Error('PROOF_ALREADY_USED');
        }

        // Submit to Chain
        let txInfo;
        try {
            txInfo = await submitToBlockchain(proofResult);
            
            // Mark proof as confirmed
            await replayProtection.confirmProof(proofResult.proofHash, txInfo.txHash);
            accessRequestsCounter.inc({ resource_type: resourceType, status: 'success' });
        } catch (blockchainError: any) {
            // Mark proof as failed so it can be retried
            await replayProtection.markFailed(proofResult.proofHash, blockchainError.message);
            accessRequestsCounter.inc({ resource_type: resourceType, status: 'blockchain_error' });
            throw blockchainError;
        }

        // Attach Receipt
        req.zkAudit = {
            proofHash: proofResult.proofHash,
            txHash: txInfo.txHash,
            accessEventHash: proofResult.publicSignals[2]
        };

        logger.info({ txHash: txInfo.txHash }, 'ZK Audit Success');
    };

    try {
        await performAudit(accessRequest);
        next();
    } catch (error: any) {
        if (error.message === 'PROOF_ALREADY_USED') {
            return res.status(400).json({
                error: 'PROOF_ALREADY_USED',
                message: 'Replay attack detected - this proof has already been submitted'
            });
        }
        if (error.message === 'NO_ACTIVE_CONSENT') {
            logger.info({ patientId: accessRequest.patientId }, 'No consent, triggering handshake');
            accessRequestsCounter.inc({ resource_type: resourceType, status: 'consent_needed' });

            try {
                // Trigger WebSocket Handshake
                const granted = await consentHandshakeService.requestConsent(accessRequest.patientId, {
                    practitioner: accessRequest.clinicianId,
                    resourceType: accessRequest.resourceType,
                    resourceId: accessRequest.resourceId
                });

                if (granted) {
                    logger.info({ patientId: accessRequest.patientId }, 'Patient approved, creating JIT consent');
                    await createJitConsent(accessRequest);

                    // Retry Audit
                    await performAudit(accessRequest);
                    return next();
                } else {
                    consentDenialsCounter.inc({ reason: 'user_denied' });
                    return res.status(403).json({
                        error: "CONSENT_DENIED",
                        message: "Patient denied access request"
                    });
                }
            } catch (handshakeError: any) {
                logger.error({ error: handshakeError.message }, 'Consent handshake failed');
                consentDenialsCounter.inc({ reason: 'timeout_or_error' });
                return res.status(403).json({
                    error: "CONSENT_TIMEOUT",
                    message: "Consent handshake failed or timed out"
                });
            }
        } else if (error.message === 'FHIR_FETCH_FAILED') {
            accessRequestsCounter.inc({ resource_type: resourceType, status: 'fhir_error' });
            return res.status(502).json({ 
                error: "FHIR_UNAVAILABLE",
                message: "Upstream FHIR Service Unavailable" 
            });
        } else {
            logger.error({ error: error.message }, 'ZK Audit failed');
            accessRequestsCounter.inc({ resource_type: resourceType, status: 'audit_failed' });
            return res.status(500).json({ 
                error: "AUDIT_FAILED",
                message: "ZK Audit Generation Failed" 
            });
        }
    }
};
