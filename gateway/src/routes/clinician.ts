import { Router, Request, Response } from 'express';
import { prisma } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { validateParams } from '../middleware/validation.js';
import { PractitionerIdSchema } from '../schemas/validation.js';
import { z } from 'zod';

export const clinicianRouter: Router = Router();

// GET /api/clinician/:clinicianId/proofs

const ClinicianProofsQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
    status: z.enum(['pending', 'queued', 'verified', 'failed']).optional()
});

clinicianRouter.get(
    '/:clinicianId/proofs',
    // validateParams(z.object({ clinicianId: PractitionerIdSchema })), // Need to fix validation middleware to accept ad-hoc schema or create one
    async (req: Request, res: Response) => {
        try {
            const { clinicianId } = req.params;
            
            // Authorization check
            const smartContext = req.smartContext;
            if (smartContext?.practitioner && smartContext.practitioner !== clinicianId) {
                return res.status(403).json({
                    error: 'FORBIDDEN',
                    message: 'Cannot view proofs for another clinician'
                });
            }

            const query = ClinicianProofsQuerySchema.parse(req.query);

            const where: any = { clinicianId };
            // Note: 'status' is not directly on AuditLog, but we can infer it or use 'verified'
            // For now, we'll just return all logs as 'verified' (since they are audit logs)
            // or filter by 'verified' boolean if we had a status field.
            // The AuditLog model has 'verified' boolean.
            
            if (query.status === 'verified') {
                where.verified = true;
            } else if (query.status === 'failed') {
                where.verified = false;
            }
            // 'pending' and 'queued' might not be persisted in AuditLog until processed, 
            // or we might need a separate ProofQueue model if we want to show those.
            // For this implementation, we'll query the AuditLog.

            const [logs, total] = await Promise.all([
                prisma.auditLog.findMany({
                    where,
                    orderBy: { createdAt: 'desc' },
                    take: query.limit,
                    skip: query.offset
                }),
                prisma.auditLog.count({ where })
            ]);

            const proofs = logs.map(log => ({
                id: log.id,
                patientId: log.patientId,
                resourceType: log.resourceType,
                accessEventHash: log.accessEventHash,
                status: log.verified ? 'verified' : 'failed', // Simplified mapping
                createdAt: log.createdAt.toISOString(),
                blockchain: log.txHash ? {
                    txHash: log.txHash,
                    blockNumber: Number(log.blockNumber || 0),
                    gasUsed: 0 // Not stored currently
                } : undefined
            }));

            res.json({
                proofs,
                pagination: {
                    total,
                    limit: query.limit,
                    offset: query.offset,
                    hasMore: query.offset + proofs.length < total
                }
            });

        } catch (error: any) {
            logger.error({ error, clinicianId: req.params.clinicianId }, 'Failed to fetch clinician proofs');
            res.status(500).json({
                error: 'INTERNAL_ERROR',
                message: 'Failed to fetch proofs'
            });
        }
    }
);
