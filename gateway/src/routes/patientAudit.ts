import { Router, Request, Response, NextFunction } from 'express';
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
import { pushNotificationService } from '../modules/notification/pushNotificationService.js';
import { pdfService } from '../modules/audit/pdfService.js';

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

// GET /api/patient/:patientId/audit-report
patientAuditRouter.get(
    '/:patientId/audit-report',
    validateParams(PatientParamsSchema),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { patientId } = req.params;

            // Generate report stream
            const doc = await pdfService.generateAuditReport(patientId);

            // Set headers for PDF download
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename=audit-report-${patientId}-${Date.now()}.pdf`);

            // Send buffer
            res.send(doc);

        } catch (error) {
            next(error);
        }
    }
);

// GET /api/patient/:patientId/access-history

patientAuditRouter.get(
    '/:patientId/access-history',
    validateParams(PatientParamsSchema),
    validateQuery(AccessHistoryQuerySchema),
    async (req: Request, res: Response) => {
        try {
            const { patientId } = req.params;

            // Dev-only: Synthetic Access History for "Riley"
            if (process.env.NODE_ENV !== 'production' && process.env.ENABLE_SYNTHETIC_CONSENT) {
                if (patientId.toLowerCase().includes('riley')) {
                    const now = new Date();
                    const syntheticRecords: AccessRecord[] = [
                        {
                            id: 'acc-1',
                            clinician: { id: 'dr-demo-456', displayName: 'Dr. Jordan Lee', department: 'General Practice' },
                            resourceType: 'Encounter',
                            accessEventHash: '0x7f83b1657ff1...9a3b',
                            txHash: '0x3a1b...8c9d',
                            accessTimestamp: now.toISOString(),
                            isBreakGlass: false,
                            isVerifiedOnChain: true
                        },
                        {
                            id: 'acc-2',
                            clinician: { id: 'dr-demo-456', displayName: 'Dr. Jordan Lee', department: 'General Practice' },
                            resourceType: 'Observation',
                            accessEventHash: '0x2c4d...e5f6',
                            txHash: '0x9e8f...1a2b',
                            accessTimestamp: new Date(now.getTime() - 5000).toISOString(),
                            isBreakGlass: false,
                            isVerifiedOnChain: true
                        },
                        {
                            id: 'acc-3',
                            clinician: { id: 'dr-demo-456', displayName: 'Dr. Jordan Lee', department: 'General Practice' },
                            resourceType: 'MedicationRequest',
                            accessEventHash: '0x5b6a...7c8d',
                            accessTimestamp: new Date(now.getTime() - 15000).toISOString(),
                            isBreakGlass: false,
                            isVerifiedOnChain: false // Queued
                        },
                        {
                            id: 'acc-4',
                            clinician: { id: 'emergency-doc', displayName: 'Dr. Sarah Smith', department: 'Emergency' },
                            resourceType: 'AllergyIntolerance',
                            accessEventHash: '0x9999...8888',
                            accessTimestamp: new Date(now.getTime() - 86400000).toISOString(),
                            isBreakGlass: true,
                            isVerifiedOnChain: true
                        }
                    ];

                    return res.json({
                        records: syntheticRecords,
                        pagination: {
                            total: 4,
                            limit: 50,
                            offset: 0,
                            hasMore: false
                        },
                        summary: {
                            totalAccesses: 4,
                            uniqueClinicians: 2,
                            breakGlassCount: 1
                        }
                    });
                }
            }

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

// GET /api/patient/:patientId/audit-logs/export
patientAuditRouter.get(
    '/:patientId/audit-logs/export',
    validateParams(PatientParamsSchema),
    async (req: Request, res: Response) => {
        try {
            const { patientId } = req.params;

            // Generate PDF
            const pdfBuffer = await pdfService.generateAuditReport(patientId);

            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="audit-report-${patientId}.pdf"`);
            res.send(pdfBuffer);

        } catch (error) {
            logger.error({ error, patientId: req.params.patientId }, 'Failed to export audit log');
            res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to generate report' });
        }
    }
);

// GET /api/patient/:patientId/audit-logs
patientAuditRouter.get(
    '/:patientId/audit-logs',
    validateParams(PatientParamsSchema),
    validateQuery(AccessHistoryQuerySchema), // Assuming this is the correct schema for listing audit logs
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
            logger.error({ error, patientId: req.params.patientId }, 'Failed to fetch audit logs');
            res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to fetch audit logs' });
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

// Helper: Create Alerts (respects patient preferences)

async function checkAndCreateAlerts(auditLogId: string, data: {
    patientId: string;
    clinicianId: string;
    clinicianName?: string;
    resourceType: string;
    isBreakGlass?: boolean;
}) {
    const alerts: any[] = [];
    const hour = new Date().getHours();

    // Get patient preferences to check what alerts they want
    let prefs: any = null;
    try {
        prefs = await prisma.patientPreferences.findUnique({
            where: { patientId: data.patientId }
        });
    } catch (e) {
        // Continue with default (create all alerts)
    }

    // After-hours check (only if patient wants these alerts)
    const wantsAfterHoursAlerts = prefs?.alertsForAfterHours ?? true;
    if ((hour < 7 || hour >= 19) && wantsAfterHoursAlerts) {
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

        // Send Push Notification
        await pushNotificationService.notifyAfterHoursAccess(
            data.patientId,
            data.clinicianName || data.clinicianId,
            hour
        ).catch(e => logger.warn({ err: e }, 'Failed to send after-hours push'));
    }

    // Break-glass alert (only if patient wants these alerts)
    const wantsBreakGlassAlerts = prefs?.alertsForBreakGlass ?? true;
    if (data.isBreakGlass && wantsBreakGlassAlerts) {
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

        // Send Push Notification
        await pushNotificationService.notifyBreakGlassAccess(
            data.patientId,
            data.clinicianName || data.clinicianId,
            'Medical Emergency' // Default fallback, specific reason should be passed if available
        ).catch(e => logger.warn({ err: e }, 'Failed to send break-glass push'));
    }

    // New provider check (only if patient wants these alerts)
    const wantsNewProviderAlerts = prefs?.alertsForNewProvider ?? true;
    if (wantsNewProviderAlerts) {
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

            // Send Push Notification
            await pushNotificationService.notifyNewProviderAccess(
                data.patientId,
                data.clinicianName || data.clinicianId,
                'Unknown Dept' // Dept not currently passed in data object
            ).catch(e => logger.warn({ err: e }, 'Failed to send new provider push'));
        }
    }

    if (alerts.length > 0) {
        await prisma.accessAlert.createMany({ data: alerts });
        logger.info({ patientId: data.patientId, alertCount: alerts.length }, 'Created access alerts');
    }
}
