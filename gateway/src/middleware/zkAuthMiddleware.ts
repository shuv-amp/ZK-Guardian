
import { Request, Response, NextFunction } from 'express';
import { zkProofService, AccessRequest } from '../services/zkProofService.js';
import { consentHandshakeService } from '../services/consentHandshake.js';
import axios from 'axios';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

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
        console.log(`[ZK Middleware] Initiating Audit for ${resourceType}/${resourceId}`);

        // Generate Proof
        const proofResult = await zkProofService.generateAccessProof(request);

        // Submit to Chain
        const txInfo = await submitToBlockchain(proofResult);

        // Attach Receipt
        req.zkAudit = {
            proofHash: proofResult.proofHash,
            txHash: txInfo.txHash,
            accessEventHash: proofResult.publicSignals[2]
        };

        console.log(`[ZK Middleware] Audit Success. Tx: ${txInfo.txHash}`);
    };

    try {
        await performAudit(accessRequest);
        next();
    } catch (error: any) {
        if (error.message === 'NO_ACTIVE_CONSENT') {
            console.log(`[ZK Middleware] Consent Missing. Triggering Handshake...`);

            try {
                // Trigger WebSocket Handshake
                const granted = await consentHandshakeService.requestConsent(accessRequest.patientId, {
                    practitioner: accessRequest.clinicianId,
                    resourceType: accessRequest.resourceType,
                    resourceId: accessRequest.resourceId
                });

                if (granted) {
                    console.log(`[ZK Middleware] Patient Approved. creating consent...`);
                    await createJitConsent(accessRequest);

                    // Retry Audit
                    await performAudit(accessRequest);
                    return next();
                } else {
                    return res.status(403).json({
                        error: "Access Denied: Patient refused consent.",
                        code: "CONSENT_REFUSED"
                    });
                }
            } catch (handshakeError: any) {
                console.error(`[ZK Middleware] Handshake/Retry Failed: ${handshakeError.message}`);
                return res.status(403).json({
                    error: "Access Denied: Consent handshake failed or timed out.",
                    code: "CONSENT_TIMEOUT"
                });
            }
        } else if (error.message === 'FHIR_FETCH_FAILED') {
            return res.status(502).json({ error: "Upstream FHIR Service Unavailable" });
        } else {
            console.error(`[ZK Middleware] Unexpected Error: ${error.message}`);
            return res.status(500).json({ error: "ZK Audit Generation Failed" });
        }
    }
};
