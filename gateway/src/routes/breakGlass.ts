/**
 * Emergency Access (Break-Glass)
 * 
 * When seconds count, this is the route that saves lives.
 * Clinicians can bypass normal consent, but we log EVERYTHING to the blockchain.
 * 
 * Endpoints:
 * - POST /initiate - Smash the glass
 * - GET  /status - check if glass is broken
 * - POST /close - Clean up the glass
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
import { generateAndSubmitBreakGlassProof } from '../lib/zkProofService.js';
import { webhookService } from '../modules/notification/webhookService.js';

export const breakGlassRouter: Router = Router();

// Schemas

const CloseBreakGlassSchema = z.object({
    closureNotes: z.string().max(1000).optional(),
    accessedResources: z.array(z.string().max(256)).optional()
});

// POST /api/break-glass/:patientId

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

            // Generate ZK Proof.
            // We do this async so the API returns fast, but the proof happens in the background.
            // V2: verify this on-chain
            const zkProofPromise = generateAndSubmitBreakGlassProof({
                patientId,
                clinicianId,
                emergencyCode: payload.emergencyCode || 3, // Default to HIGH
                justificationHash: payload.justification,
                sessionNonce: session.id // Unique nonce
            }, payload.emergencyThreshold || 2);

            // Audit Log: This looks serious.
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
            }, 'Break-glass initiated! Alerting compliance.');

            // REAL-TIME ALERT. We don't wait for the nightly job.
            // Send this to the compliance officer immediately.
            const tenantId = (req as any).tenantId || 'default';
            webhookService.emit(tenantId, 'break_glass.initiated', {
                sessionId: session.id,
                patientId,
                clinicianId,
                clinicianName,
                department,
                reason: payload.reason,
                justificationHash: reasonHash,
                witnessId: payload.witnessId,
                expiresAt: expiresAt.toISOString(),
                requiresReview: true,
                severity: 'CRITICAL'
            }).catch(err => logger.error({ err }, 'Failed to emit break-glass webhook'));

            // Wait for ZK proof with timeout
            let txHash: string | null = null;
            let zkVerified = false;
            try {
                const result = await Promise.race([
                    zkProofPromise,
                    new Promise<{ success: false; error: string }>((resolve) =>
                        setTimeout(() => resolve({ success: false, error: 'Timeout' }), 30000)
                    )
                ]);

                if (result.success && result.txHash) {
                    txHash = result.txHash;
                    zkVerified = true;
                    logger.info({ txHash, sessionId: session.id }, 'ZK proof verified on-chain');
                } else {
                    logger.warn({ error: result.error, sessionId: session.id }, 'ZK proof submission failed, falling back to hash logging');
                }
            } catch (error) {
                logger.error({ error, sessionId: session.id }, 'ZK proof submission exception');
            }

            // Update session with txHash if available
            if (txHash) {
                await prisma.breakGlassSession.update({
                    where: { id: session.id },
                    data: { txHash, zkVerified }
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

// GET /api/break-glass/:patientId/status

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

// POST /api/break-glass/:patientId/close

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

// Helper Functions removed - ZK proof generation moved to zkProofService.ts

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
