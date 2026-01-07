import { Router, Request, Response } from 'express';
import { prisma } from '../db/client.js';
import { logger, logAccessEvent } from '../lib/logger.js';
import {
    AccessHistoryQuerySchema,
    AccessAlertsQuerySchema,
    AcknowledgeAlertSchema,
    AccessHistoryQuery,
    AccessAlertsQuery
} from '../schemas/validation.js';
import { ValidationError, ResourceNotFoundError } from '../lib/errors.js';
import { validateQuery, validateParams, validateBody, PatientParamsSchema, PatientAlertParamsSchema } from '../middleware/validation.js';

export const patientAuditRouter: Router = Router();

// Types

interface AccessRecord {
    id: string;
    clinician: {
        id: string;
        displayName: string;
        department: string;
    };
    resourceType: string;
    accessEventHash: string;
    txHash?: string;
    accessTimestamp: string;
    isBreakGlass: boolean;
    isVerifiedOnChain: boolean;
}

// GET /api/patient/:patientId/access-history

patientAuditRouter.get(
    '/:patientId/access-history',
    validateParams(PatientParamsSchema),
    validateQuery(AccessHistoryQuerySchema),
    async (req: Request, res: Response) => {
        try {
            const { patientId } = req.params;
            const query = (req as any).validatedQuery as AccessHistoryQuery;

            const where: any = { patientId };

            if (query.from || query.to) {
            where.createdAt = {};
            if (query.from) where.createdAt.gte = new Date(query.from);
            if (query.to) where.createdAt.lte = new Date(query.to);
        }
        if (query.resourceType) where.resourceType = query.resourceType;
        if (query.department) where.department = query.department;
        if (!query.includeBreakGlass) where.isBreakGlass = false;

        const [records, total] = await Promise.all([
            prisma.auditLog.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                take: query.limit,
                skip: query.offset
            }),
            prisma.auditLog.count({ where })
        ]);

        // Transform to API format
        const accessRecords: AccessRecord[] = records.map(r => ({
            id: r.id,
            clinician: {
                id: r.clinicianId,
                displayName: r.clinicianName || 'Unknown',
                department: r.department || 'Unknown'
            },
            resourceType: r.resourceType,
            accessEventHash: r.accessEventHash,
            txHash: r.txHash || undefined,
            accessTimestamp: r.createdAt.toISOString(),
            isBreakGlass: r.isBreakGlass,
            isVerifiedOnChain: r.verified
        }));

        // Get summary stats
        const [uniqueClinicians, breakGlassCount] = await Promise.all([
            prisma.auditLog.groupBy({
                by: ['clinicianId'],
                where: { patientId },
                _count: true
            }),
            prisma.auditLog.count({ where: { patientId, isBreakGlass: true } })
        ]);

        res.json({
            records: accessRecords,
            pagination: {
                total,
                limit: query.limit,
                offset: query.offset,
                hasMore: (query.offset ?? 0) + records.length < total
            },
            summary: {
                totalAccesses: total,
                uniqueClinicians: uniqueClinicians.length,
                breakGlassCount
            }
        });

    } catch (error) {
        if (error instanceof ValidationError) {
            return res.status(400).json(error.toJSON());
        }
        logger.error({ error, patientId: req.params.patientId }, 'Failed to fetch access history');
        res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to fetch access history' });
    }
});

// GET /api/patient/:patientId/access-alerts

patientAuditRouter.get(
    '/:patientId/access-alerts',
    validateParams(PatientParamsSchema),
    validateQuery(AccessAlertsQuerySchema),
    async (req: Request, res: Response) => {
        try {
            const { patientId } = req.params;
            const query = (req as any).validatedQuery as AccessAlertsQuery;
            
            const acknowledged = query.acknowledged;
            const severity = query.severity;

            const where: any = { patientId };
            if (acknowledged) {
                where.acknowledgedAt = { not: null };
            } else {
                where.acknowledgedAt = null;
            }
            if (severity) where.severity = severity;

            const [alerts, unacknowledged] = await Promise.all([
            prisma.accessAlert.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                take: 50,
                include: {
                    auditLog: {
                        select: { accessEventHash: true }
                    }
                }
            }),
            prisma.accessAlert.count({
                where: { patientId, acknowledgedAt: null }
            })
        ]);

        res.json({
            alerts: alerts.map(a => ({
                id: a.id,
                type: a.type,
                severity: a.severity,
                message: a.message,
                accessEventHash: a.auditLog?.accessEventHash || '',
                createdAt: a.createdAt.toISOString(),
                acknowledgedAt: a.acknowledgedAt?.toISOString(),
                relatedAccess: {
                    clinician: a.relatedClinician || 'Unknown',
                    resourceType: a.relatedResourceType || 'Unknown'
                },
                suggestedAction: a.suggestedAction
            })),
            unacknowledged
        });

    } catch (error) {
        logger.error({ error, patientId: req.params.patientId }, 'Failed to fetch alerts');
        res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to fetch alerts' });
    }
});

// POST /api/patient/:patientId/access-alerts/:alertId/acknowledge

patientAuditRouter.post(
    '/:patientId/access-alerts/:alertId/acknowledge',
    validateParams(PatientAlertParamsSchema),
    validateBody(AcknowledgeAlertSchema),
    async (req: Request, res: Response) => {
        try {
            const { patientId, alertId } = req.params;
            const body = req.body; // Already validated

            const alert = await prisma.accessAlert.findFirst({
                where: { id: alertId, patientId }
            });

        if (!alert) {
            throw new ResourceNotFoundError('AccessAlert', alertId);
        }

        const updated = await prisma.accessAlert.update({
            where: { id: alertId },
            data: {
                acknowledgedAt: body.acknowledged ? new Date() : null,
                acknowledgedNotes: body.notes
            }
        });

        res.json({
            success: true,
            alert: {
                id: updated.id,
                acknowledgedAt: updated.acknowledgedAt?.toISOString()
            }
        });

    } catch (error) {
        if (error instanceof ValidationError || error instanceof ResourceNotFoundError) {
            return res.status((error as any).statusCode).json((error as any).toJSON());
        }
        logger.error({ error, alertId: req.params.alertId }, 'Failed to acknowledge alert');
        res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to acknowledge alert' });
    }
});

// Helper: Record Access Event

export async function recordAccessEvent(data: {
    patientId: string;
    clinicianId: string;
    clinicianName?: string;
    department?: string;
    resourceType: string;
    resourceId?: string;
    accessEventHash: string;
    isBreakGlass?: boolean;
    purpose?: string;
}): Promise<string> {
    const record = await prisma.auditLog.create({
        data: {
            patientId: data.patientId,
            clinicianId: data.clinicianId,
            clinicianName: data.clinicianName,
            department: data.department,
            resourceType: data.resourceType,
            resourceId: data.resourceId,
            accessEventHash: data.accessEventHash,
            isBreakGlass: data.isBreakGlass || false,
            purpose: data.purpose
        }
    });

    logAccessEvent({
        patientId: data.patientId,
        clinicianId: data.clinicianId,
        resourceType: data.resourceType,
        action: data.isBreakGlass ? 'BREAK_GLASS' : 'ACCESS_GRANTED',
        proofHash: data.accessEventHash
    });

    // Check for alerts
    await checkAndCreateAlerts(record.id, data);

    return record.id;
}

// Helper: Create Alerts

async function checkAndCreateAlerts(auditLogId: string, data: {
    patientId: string;
    clinicianId: string;
    clinicianName?: string;
    resourceType: string;
    isBreakGlass?: boolean;
}) {
    const alerts: any[] = [];
    const hour = new Date().getHours();

    // After-hours check
    if (hour < 7 || hour >= 19) {
        alerts.push({
            patientId: data.patientId,
            auditLogId,
            type: 'AFTER_HOURS',
            severity: 'MEDIUM',
            message: `Access occurred outside normal hours (${hour}:00)`,
            relatedClinician: data.clinicianName || data.clinicianId,
            relatedResourceType: data.resourceType,
            suggestedAction: 'Review if this access was expected'
        });
    }

    // Break-glass alert
    if (data.isBreakGlass) {
        alerts.push({
            patientId: data.patientId,
            auditLogId,
            type: 'BREAK_GLASS',
            severity: 'HIGH',
            message: `Emergency break-glass access by ${data.clinicianName || data.clinicianId}`,
            relatedClinician: data.clinicianName || data.clinicianId,
            relatedResourceType: data.resourceType,
            suggestedAction: 'Verify this was a legitimate emergency'
        });
    }

    // New provider check
    const previousAccess = await prisma.auditLog.count({
        where: {
            patientId: data.patientId,
            clinicianId: data.clinicianId,
            id: { not: auditLogId }
        }
    });

    if (previousAccess === 0) {
        alerts.push({
            patientId: data.patientId,
            auditLogId,
            type: 'NEW_PROVIDER',
            severity: 'LOW',
            message: `First-time access by ${data.clinicianName || data.clinicianId}`,
            relatedClinician: data.clinicianName || data.clinicianId,
            relatedResourceType: data.resourceType,
            suggestedAction: 'Confirm you are receiving care from this provider'
        });
    }

    if (alerts.length > 0) {
        await prisma.accessAlert.createMany({ data: alerts });
    }
}
