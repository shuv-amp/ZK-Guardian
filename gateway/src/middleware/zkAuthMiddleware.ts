
import { Request, Response, NextFunction } from 'express';
import { zkProofService, AccessRequest } from '../services/zkProofService.js';
import crypto from 'crypto';

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

export const zkAuthMiddleware = async (req: Request, res: Response, next: NextFunction) => {
    try {
        // 1. Identify Resource Type
        // Assuming router mounted at /fhir. req.path starts with /ResourceType...
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
            // Direct read: /Observation/123
            resourceId = pathParts[1];
        } else {
            // Search/List: /Observation?patient=123
            // We use a hash of the query parameters to legally bind this "Search" event
            // This ensures every search is unique but reproducible for the audit
            const queryStr = JSON.stringify(req.query);
            resourceId = crypto.createHash("sha256").update(queryStr).digest("hex").slice(0, 16);
        }

        const accessRequest: AccessRequest = {
            patientId: smartContext.patient,
            clinicianId: smartContext.practitioner || smartContext.sub || "unknown",
            resourceId,
            resourceType
        };

        console.log(`[ZK Middleware] Initiating Audit for ${resourceType}/${resourceId}`);
        console.log(`[ZK Middleware] Patient: ${accessRequest.patientId}, Clinician: ${accessRequest.clinicianId}`);

        // 4. Generate Proof via Service
        const proofResult = await zkProofService.generateAccessProof(accessRequest);

        // 5. Submit to Blockchain (Mocked for Phase 2)
        const txInfo = await submitToBlockchain(proofResult);

        // 6. Attach Audit Receipt
        req.zkAudit = {
            proofHash: proofResult.proofHash,
            txHash: txInfo.txHash,
            // Public Signals: [proofOfPolicyMatch, currentTimestamp, accessEventHash]
            // We want the accessEventHash (index 2)
            accessEventHash: proofResult.publicSignals[2]
        };

        console.log(`[ZK Middleware] Audit Success. Tx: ${txInfo.txHash}`);

        // Proceed to Proxy
        next();

    } catch (error: any) {
        console.error(`[ZK Middleware] Verification Failed: ${error.message}`);

        if (error.message === 'NO_ACTIVE_CONSENT') {
            return res.status(403).json({
                error: "Access Denied: No active consent found for this patient.",
                code: "CONSENT_REQUIRED"
            });
        }

        if (error.message === 'FHIR_FETCH_FAILED') {
            return res.status(502).json({ error: "Upstream FHIR Service Unavailable during Audit" });
        }

        // General ZK/Circuit Error
        return res.status(500).json({ error: "ZK Audit Proof Generation Failed" });
    }
};
