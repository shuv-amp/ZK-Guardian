
import { Request, Response, NextFunction } from 'express';
import { zkProofService, AccessRequest } from '../modules/security/zkProofService.js';
import { consentHandshakeService } from '../modules/consent/consentHandshake.js';
import { replayProtection } from '../modules/security/replayProtection.js';
import { recordAccessEvent } from '../routes/patientAudit.js';
import { getRedis } from '../db/redis.js';
import { ethers } from 'ethers';
import { env } from '../config/env.js';
import axios from 'axios';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../lib/logger.js';
import { accessRequestsCounter, consentDenialsCounter } from '../metrics/prometheus.js';
import { webhookService } from '../modules/notification/webhookService.js';

const HAPI_FHIR_URL = env.HAPI_FHIR_URL || 'http://localhost:8080/fhir';

// Clinical resources that require ZK proof verification
const CLINICAL_RESOURCES = [
    'Patient', 'Observation', 'Condition', 'MedicationRequest',
    'DiagnosticReport', 'Encounter', 'Immunization', 'Procedure'
];

// ZKGuardianAudit ABI (minimal for verifyAndAudit)
const ZK_GUARDIAN_AUDIT_ABI = [
    'function verifyAndAudit(uint256[2] calldata _pA, uint256[2][2] calldata _pB, uint256[2] calldata _pC, uint256[7] calldata _pubSignals) external',
    'event AccessAudited(bytes32 indexed accessEventHash, bytes32 indexed proofHash, uint256 blindedPatientId, uint256 blindedAccessHash, uint64 timestamp, address indexed auditor)'
];

/**
 * Submits ZK proof to blockchain.
 * Uses real tx in prod, mocks it in dev to save cash.
 */
const submitToBlockchain = async (proofResult: any): Promise<{ txHash: string; blockNumber: number }> => {
    const privateKey = env.GATEWAY_PRIVATE_KEY;
    const rpcUrl = env.POLYGON_AMOY_RPC;
    const auditAddress = env.AUDIT_CONTRACT_ADDRESS;

    // Development fallback - mock if not configured
    if (!privateKey || !rpcUrl || !auditAddress) {
        logger.warn('Blockchain not configured - using mock submission (dev mode)');
        await new Promise(resolve => setTimeout(resolve, 50));
        return {
            txHash: "0xMOCK_" + crypto.randomBytes(30).toString('hex'),
            blockNumber: 0
        };
    }

    try {
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const wallet = new ethers.Wallet(privateKey, provider);
        const contract = new ethers.Contract(auditAddress, ZK_GUARDIAN_AUDIT_ABI, wallet);

        // Parse proof components from proofResult
        // Note: zkProofService returns { proof: { a, b, c }, publicSignals }
        const { proof, publicSignals } = proofResult;
        const pA = proof.a;
        const pB = proof.b;
        const pC = proof.c;

        logger.info({ contract: auditAddress }, 'Submitting verifyAndAudit to blockchain');

        const tx = await contract.verifyAndAudit(pA, pB, pC, publicSignals, { gasLimit: 500000 });
        const receipt = await tx.wait();

        logger.info({
            txHash: receipt.hash,
            blockNumber: receipt.blockNumber,
            gasUsed: receipt.gasUsed?.toString()
        }, 'ZK proof verified on-chain');

        return {
            txHash: receipt.hash,
            blockNumber: receipt.blockNumber
        };
    } catch (error: any) {
        logger.error({ error: error.message }, 'Blockchain submission failed');
        throw new Error(`BLOCKCHAIN_ERROR: ${error.message}`);
    }
};

/**
 * Need consent validation ASAP?
 * Creates a temp JIT consent resource valid for 1 hour.
 */
const createJitConsent = async (accessRequest: AccessRequest): Promise<string> => {
    const consentId = uuidv4();
    const now = new Date();
    const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);

    // FHIR R4 Consent resource structure
    const consentResource = {
        resourceType: "Consent",
        id: consentId,
        status: "active",
        scope: {
            coding: [{
                system: "http://terminology.hl7.org/CodeSystem/consentscope",
                code: "patient-privacy",
                display: "Privacy Consent"
            }]
        },
        category: [{
            coding: [{
                system: "http://loinc.org",
                code: "59284-0",
                display: "Consent Document"
            }]
        }],
        patient: { reference: `Patient/${accessRequest.patientId}` },
        dateTime: now.toISOString(),
        provision: {
            type: "permit",
            period: {
                start: now.toISOString(),
                end: oneHourLater.toISOString()
            },
            data: [{
                meaning: "instance",
                reference: {
                    reference: `${accessRequest.resourceType}/${accessRequest.resourceId || '*'}`
                }
            }]
        }
    };

    try {
        await axios.put(`${HAPI_FHIR_URL}/Consent/${consentId}`, consentResource, {
            timeout: 10000,
            headers: { 'Content-Type': 'application/fhir+json' }
        });
        logger.info({ consentId, patientId: accessRequest.patientId }, 'JIT Consent created in FHIR');
        return consentId;
    } catch (error: any) {
        // In development, log the error but continue with mock consent
        // This allows testing without a working FHIR server
        if (env.NODE_ENV !== 'production') {
            logger.warn({
                error: error.response?.data || error.message,
                patientId: accessRequest.patientId
            }, 'FHIR consent creation failed (DEV mode) - continuing with local consent');
            return `local-consent-${consentId}`;
        }
        throw error;
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

    // Generate or retrieve session parameters
    const redis = getRedis();
    const nullifierKey = `zk:nullifier:${smartContext.patient}`;
    let patientNullifier = await redis.get(nullifierKey);
    let sessionNonce = "";

    if (patientNullifier) {
        // If we have the nullifier, generate a fresh nonce for this request
        // 31 bytes to fit in BN254 field
        sessionNonce = BigInt("0x" + crypto.randomBytes(31).toString("hex")).toString();
    }

    // Prepare partial request (might be missing nullifier if not cached)
    const accessRequest: any = {
        patientId: smartContext.patient,
        clinicianId: smartContext.practitioner || smartContext.sub || "unknown",
        resourceId,
        resourceType,
        patientNullifier, // might be null
        sessionNonce
    };

    const performAudit = async (request: AccessRequest): Promise<void> => {
        logger.info({ resourceType, resourceId }, 'Initiating ZK Audit');
        accessRequestsCounter.inc({ resource_type: resourceType, status: 'initiated' });

        if (!request.patientNullifier) {
            throw new Error("NO_ACTIVE_CONSENT"); // Trigger handshake if we don't have the key
        }

        // Generate Proof
        const proofResult = await zkProofService.generateAccessProof(request as AccessRequest);

        // Replay check. Reject if seen before.
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

            await replayProtection.confirmProof(proofResult.proofHash, txInfo.txHash);
            accessRequestsCounter.inc({ resource_type: resourceType, status: 'success' });

            // Emit Webhook: access.granted
            webhookService.emit(request.patientId, 'access.granted', {
                patientId: request.patientId,
                clinicianId: request.clinicianId,
                resourceType: request.resourceType,
                resourceId: request.resourceId,
                proofHash: proofResult.proofHash,
                txHash: txInfo.txHash,
                timestamp: new Date().toISOString()
            }).catch(e => logger.error({ error: e.message }, 'Webhook emit failed'));
        } catch (blockchainError: any) {
            // Mark proof as failed so it can be retried
            await replayProtection.markFailed(proofResult.proofHash, blockchainError.message);
            accessRequestsCounter.inc({ resource_type: resourceType, status: 'blockchain_error' });
            throw blockchainError;
        }

        // Attach receipt for the caller.
        req.zkAudit = {
            proofHash: proofResult.proofHash,
            txHash: txInfo.txHash,
            accessEventHash: proofResult.publicSignals[2]
        };

        // Record audit log + Trigger Alerts & Push Notifications
        await recordAccessEvent({
            patientId: request.patientId,
            clinicianId: request.clinicianId,
            clinicianName: smartContext.name || request.clinicianId, // Try to get name from token
            department: smartContext.department || 'Unknown',
            resourceType: request.resourceType,
            resourceId: request.resourceId,
            accessEventHash: proofResult.publicSignals[2],
            isBreakGlass: false,
            purpose: 'clinical-access'
        }).catch(err => logger.error({ err }, 'Failed to record audit log/triggers'));

        logger.info({ txHash: txInfo.txHash }, 'ZK Audit Success');
    };

    try {
        await performAudit(accessRequest);
        next();
    } catch (error: any) {
        if (error.message === 'PROOF_ALREADY_USED') {
            // Emit Webhook: access.denied (Replay)
            webhookService.emit(accessRequest.patientId, 'access.denied', {
                patientId: accessRequest.patientId,
                clinicianId: accessRequest.clinicianId,
                reason: 'REPLAY_ATTACK',
                proofHash: accessRequest.proofHash || 'unknown'
            }).catch(() => { });

            return res.status(400).json({
                error: 'PROOF_ALREADY_USED',
                message: 'Replay attack detected - this proof has already been submitted'
            });
        }
        if (error.message === 'NO_ACTIVE_CONSENT') {
            logger.info({ patientId: accessRequest.patientId }, 'No consent, triggering handshake');
            accessRequestsCounter.inc({ resource_type: resourceType, status: 'consent_needed' });

            try {
                const response = await consentHandshakeService.requestConsent(accessRequest.patientId, {
                    practitioner: accessRequest.clinicianId,
                    resourceType: accessRequest.resourceType,
                    resourceId: accessRequest.resourceId
                });

                if (response.approved) {
                    // Nullifier must come from mobile
                    const consentNullifier = response.nullifier;
                    if (!consentNullifier) {
                        logger.error({ patientId: accessRequest.patientId }, 'Consent approved but no nullifier provided');
                        consentDenialsCounter.inc({ reason: 'missing_nullifier' });
                        return res.status(403).json({
                            error: "CONSENT_INVALID",
                            message: "Consent approved but security credentials missing"
                        });
                    }

                    const sessionNonce = response.sessionNonce;
                    if (!sessionNonce) {
                        logger.error({ patientId: accessRequest.patientId }, 'Consent approved but no session nonce provided');
                        consentDenialsCounter.inc({ reason: 'missing_nonce' });
                        return res.status(403).json({
                            error: "CONSENT_INVALID",
                            message: "Consent approved but session credentials missing"
                        });
                    }

                    logger.info({ patientId: accessRequest.patientId }, 'Patient approved, creating JIT consent');

                    // Create JIT Consent FHIR resource
                    await createJitConsent(accessRequest);

                    // Cache the nullifier - 1 hour in production, 60 seconds in dev for easier testing
                    const ttlSeconds = env.NODE_ENV === 'production' ? 3600 : 60;
                    await redis.setex(nullifierKey, ttlSeconds, consentNullifier);

                    // Update request with secure credentials from mobile
                    accessRequest.patientNullifier = consentNullifier;
                    accessRequest.sessionNonce = sessionNonce;

                    // Retry Audit
                    await performAudit(accessRequest);
                    return next();
                } else {
                    consentDenialsCounter.inc({ reason: 'user_denied' });
                    return res.status(403).json({
                        error: "CONSENT_DENIED",
                        message: "Patient denied access request"
                    });

                    webhookService.emit(accessRequest.patientId, 'consent.denied', {
                        patientId: accessRequest.patientId,
                        clinicianId: accessRequest.clinicianId,
                        resourceType: accessRequest.resourceType
                    }).catch(() => { });
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
        } else if (error.message === 'CONSENT_REVOKED') {
            accessRequestsCounter.inc({ resource_type: resourceType, status: 'revoked' });
            return res.status(403).json({
                error: "CONSENT_REVOKED",
                message: "Access denied: Consent has been revoked"
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
