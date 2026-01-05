/**
 * Break-Glass Emergency Access Routes
 * 
 * Per ZK_Guardian_Technical_Blueprint.md - Emergency Access Protocol
 * 
 * Break-glass allows clinicians to bypass normal consent requirements
 * in life-threatening emergencies, with full audit trail.
 * 
 * Endpoints:
 * - POST /api/break-glass/:patientId - Initiate emergency access
 * - GET  /api/break-glass/:patientId/status - Check active break-glass status
 * - POST /api/break-glass/:patientId/close - Close break-glass session
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { ethers } from 'ethers';
import crypto from 'crypto';
import { prisma } from '../db/client.js';
import { logger, auditLogger } from '../lib/logger.js';
import { env } from '../config/env.js';
import { validateOrThrow, BreakGlassPayloadSchema } from '../schemas/validation.js';
import { validateBody, validateParams, PatientParamsSchema } from '../middleware/validation.js';

export const breakGlassRouter: Router = Router();

// ConsentRevocationRegistry contract ABI (break-glass event)
const REVOCATION_REGISTRY_ABI = [
    'function logBreakGlassAccess(bytes32 patientHash, bytes32 clinicianHash, bytes32 reasonHash, uint256 timestamp) external',
    'event BreakGlassAccess(bytes32 indexed patientHash, bytes32 indexed clinicianHash, bytes32 reasonHash, uint256 timestamp)'
];

// ============================================
// Schemas
// ============================================

const CloseBreakGlassSchema = z.object({
    closureNotes: z.string().max(1000).optional(),
    accessedResources: z.array(z.string().max(256)).optional()
});

// ============================================
// POST /api/break-glass/:patientId
// ============================================

breakGlassRouter.post(
    '/:patientId',
    validateParams(PatientParamsSchema),
    validateBody(BreakGlassPayloadSchema),
    async (req: Request, res: Response) => {
        const startTime = Date.now();
        const requestId = crypto.randomUUID();
        
        try {
            const { patientId } = req.params;
            const payload = req.body;

            // Get clinician from SMART context
            const smartContext = req.smartContext;
            if (!smartContext?.practitioner) {
                return res.status(403).json({
                    error: 'FORBIDDEN',
                    message: 'Break-glass requires authenticated practitioner'
                });
            }

            const clinicianId = smartContext.practitioner;
            const clinicianName = smartContext.practitionerName || 'Unknown';
            const department = smartContext.department || 'Unknown';

            // Check for existing active break-glass session
            const existingSession = await prisma.breakGlassSession.findFirst({
                where: {
                    patientId,
                    clinicianId,
                    status: 'ACTIVE'
                }
            });

            if (existingSession) {
                return res.status(409).json({
                    error: 'BREAK_GLASS_ACTIVE',
                    message: 'Break-glass session already active for this patient',
                    sessionId: existingSession.id,
                    expiresAt: existingSession.expiresAt.toISOString()
                });
            }

            // Calculate session duration (default 4 hours, max 24 hours)
            const durationMinutes = Math.min(payload.estimatedDuration || 240, 1440);
            const expiresAt = new Date(Date.now() + durationMinutes * 60 * 1000);

            // Generate hashes for blockchain
            const patientHash = ethers.keccak256(ethers.toUtf8Bytes(patientId));
            const clinicianHash = ethers.keccak256(ethers.toUtf8Bytes(clinicianId));
            const reasonHash = ethers.keccak256(ethers.toUtf8Bytes(payload.reason));

            // Create database record
            const session = await prisma.breakGlassSession.create({
                data: {
                    patientId,
                    clinicianId,
                    clinicianName,
                    department,
                    reason: payload.reason,
                    justification: payload.justification,
                    clinicianSignature: payload.clinicianSignature,
                    witnessId: payload.witnessId || null,
                    status: 'ACTIVE',
                    expiresAt,
                    patientHash,
                    clinicianHash,
                    reasonHash,
                    requestId
                }
            });

            // Log to blockchain (async, don't block response)
            const txPromise = logBreakGlassToBlockchain(
                patientHash,
                clinicianHash,
                reasonHash,
                session.id
            );

            // Critical audit log
            auditLogger.warn({
                event: 'BREAK_GLASS_INITIATED',
                sessionId: session.id,
                patientId,
                clinicianId,
                clinicianName,
                department,
                reason: payload.reason,
                justification: payload.justification,
                witnessId: payload.witnessId,
                expiresAt: expiresAt.toISOString(),
                requestId
            }, 'Break-glass emergency access initiated');

            // Wait for blockchain with timeout
            let txHash: string | null = null;
            try {
                txHash = await Promise.race([
                    txPromise,
                    new Promise<null>((resolve) => setTimeout(() => resolve(null), 10000))
                ]);
            } catch (error) {
                logger.error({ error, sessionId: session.id }, 'Blockchain logging failed for break-glass');
            }

            // Update session with txHash if available
            if (txHash) {
                await prisma.breakGlassSession.update({
                    where: { id: session.id },
                    data: { txHash }
                });
            }

            const duration = Date.now() - startTime;
            
            res.status(201).json({
                sessionId: session.id,
                status: 'ACTIVE',
                patientId,
                clinicianId,
                reason: payload.reason,
                expiresAt: expiresAt.toISOString(),
                txHash: txHash || 'pending',
                processingTimeMs: duration,
                warning: 'This access is logged and will be audited. Patient will be notified.'
            });

        } catch (error: any) {
            logger.error({ error, requestId }, 'Break-glass initiation failed');
            
            if (error.code === 'P2002') {
                return res.status(409).json({
                    error: 'DUPLICATE_SESSION',
                    message: 'Break-glass session already exists'
                });
            }

            res.status(500).json({
                error: 'BREAK_GLASS_FAILED',
                message: 'Failed to initiate break-glass access'
            });
        }
    }
);

// ============================================
// GET /api/break-glass/:patientId/status
// ============================================

breakGlassRouter.get(
    '/:patientId/status',
    validateParams(PatientParamsSchema),
    async (req: Request, res: Response) => {
        try {
            const { patientId } = req.params;
            const smartContext = req.smartContext;

            // Patients can check their own break-glass status
            // Practitioners can check any patient
            const isPatient = smartContext?.patient === patientId;
            const isPractitioner = !!smartContext?.practitioner;

            if (!isPatient && !isPractitioner) {
                return res.status(403).json({
                    error: 'FORBIDDEN',
                    message: 'Not authorized to view break-glass status'
                });
            }

            // Find active sessions for this patient
            const sessions = await prisma.breakGlassSession.findMany({
                where: {
                    patientId,
                    status: 'ACTIVE',
                    expiresAt: { gt: new Date() }
                },
                orderBy: { createdAt: 'desc' }
            });

            // If practitioner, only show their own session
            const filteredSessions = isPractitioner && !isPatient
                ? sessions.filter(s => s.clinicianId === smartContext!.practitioner)
                : sessions;

            res.json({
                hasActiveSession: filteredSessions.length > 0,
                sessions: filteredSessions.map(s => ({
                    sessionId: s.id,
                    clinicianId: s.clinicianId,
                    clinicianName: s.clinicianName,
                    department: s.department,
                    reason: s.reason,
                    createdAt: s.createdAt.toISOString(),
                    expiresAt: s.expiresAt.toISOString(),
                    remainingMinutes: Math.max(0, Math.floor((s.expiresAt.getTime() - Date.now()) / 60000)),
                    txHash: s.txHash
                }))
            });

        } catch (error: any) {
            logger.error({ error }, 'Break-glass status check failed');
            res.status(500).json({
                error: 'STATUS_CHECK_FAILED',
                message: 'Failed to retrieve break-glass status'
            });
        }
    }
);

// ============================================
// POST /api/break-glass/:patientId/close
// ============================================

breakGlassRouter.post(
    '/:patientId/close',
    validateParams(PatientParamsSchema),
    validateBody(CloseBreakGlassSchema),
    async (req: Request, res: Response) => {
        try {
            const { patientId } = req.params;
            const { closureNotes, accessedResources } = req.body;
            const smartContext = req.smartContext;

            if (!smartContext?.practitioner) {
                return res.status(403).json({
                    error: 'FORBIDDEN',
                    message: 'Only authenticated practitioners can close break-glass sessions'
                });
            }

            const clinicianId = smartContext.practitioner;

            // Find the active session for this clinician/patient
            const session = await prisma.breakGlassSession.findFirst({
                where: {
                    patientId,
                    clinicianId,
                    status: 'ACTIVE'
                }
            });

            if (!session) {
                return res.status(404).json({
                    error: 'NO_ACTIVE_SESSION',
                    message: 'No active break-glass session found'
                });
            }

            // Close the session
            const closedSession = await prisma.breakGlassSession.update({
                where: { id: session.id },
                data: {
                    status: 'CLOSED',
                    closedAt: new Date(),
                    closureNotes,
                    accessedResources: accessedResources || []
                }
            });

            // Audit log
            auditLogger.info({
                event: 'BREAK_GLASS_CLOSED',
                sessionId: session.id,
                patientId,
                clinicianId,
                duration: Math.floor((Date.now() - session.createdAt.getTime()) / 60000),
                accessedResources: accessedResources?.length || 0,
                closureNotes: closureNotes ? '[REDACTED]' : null
            }, 'Break-glass session closed');

            res.json({
                sessionId: closedSession.id,
                status: 'CLOSED',
                closedAt: closedSession.closedAt?.toISOString(),
                durationMinutes: Math.floor((Date.now() - session.createdAt.getTime()) / 60000)
            });

        } catch (error: any) {
            logger.error({ error }, 'Break-glass closure failed');
            res.status(500).json({
                error: 'CLOSURE_FAILED',
                message: 'Failed to close break-glass session'
            });
        }
    }
);

// ============================================
// Helper Functions
// ============================================

async function logBreakGlassToBlockchain(
    patientHash: string,
    clinicianHash: string,
    reasonHash: string,
    sessionId: string
): Promise<string> {
    try {
        const privateKey = env.GATEWAY_PRIVATE_KEY;
        const rpcUrl = env.POLYGON_AMOY_RPC;
        const registryAddress = env.CONSENT_REVOCATION_REGISTRY_ADDRESS;

        if (!privateKey || !rpcUrl || !registryAddress) {
            logger.warn({ sessionId }, 'Blockchain config missing for break-glass logging');
            throw new Error('Blockchain not configured');
        }

        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const wallet = new ethers.Wallet(privateKey, provider);
        const contract = new ethers.Contract(registryAddress, REVOCATION_REGISTRY_ABI, wallet);

        const timestamp = Math.floor(Date.now() / 1000);
        const tx = await contract.logBreakGlassAccess(
            patientHash,
            clinicianHash,
            reasonHash,
            timestamp,
            { gasLimit: 200000 }
        );

        const receipt = await tx.wait();
        
        logger.info({
            sessionId,
            txHash: receipt.hash,
            blockNumber: receipt.blockNumber
        }, 'Break-glass logged to blockchain');

        return receipt.hash;
    } catch (error: any) {
        logger.error({ error, sessionId }, 'Failed to log break-glass to blockchain');
        throw error;
    }
}

// Middleware to check break-glass authorization
export async function checkBreakGlassAccess(
    patientId: string,
    clinicianId: string
): Promise<{ hasAccess: boolean; session?: any }> {
    try {
        const session = await prisma.breakGlassSession.findFirst({
            where: {
                patientId,
                clinicianId,
                status: 'ACTIVE',
                expiresAt: { gt: new Date() }
            }
        });

        return {
            hasAccess: !!session,
            session
        };
    } catch (error) {
        logger.error({ error }, 'Break-glass access check failed');
        return { hasAccess: false };
    }
}
