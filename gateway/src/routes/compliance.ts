/**
 * Compliance API Routes
 * 
 * Endpoints for HIPAA compliance reporting and audit.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { complianceService } from '../lib/complianceService.js';
import { anomalyDetectionService } from '../services/anomalyDetection.js';
import { logger } from '../lib/logger.js';
import { AuthorizationError } from '../lib/errors.js';

export const complianceRouter = Router();

// Schema for date range
const DateRangeSchema = z.object({
    from: z.string().datetime(),
    to: z.string().datetime()
});

const MonthSchema = z.object({
    year: z.coerce.number().min(2020).max(2100),
    month: z.coerce.number().min(1).max(12)
});

/**
 * Middleware: Require compliance officer role
 */
function requireComplianceRole(req: Request, res: Response, next: NextFunction) {
    const smartContext = (req as any).smartContext;

    // Check for compliance role in SMART scopes
    const hasComplianceScope = smartContext?.scope?.includes('compliance/read') ||
        smartContext?.scope?.includes('admin/*');

    // Or check practitioner role
    const isComplianceOfficer = smartContext?.profile?.role === 'compliance_officer' ||
        smartContext?.profile?.role === 'admin';

    if (!hasComplianceScope && !isComplianceOfficer) {
        throw new AuthorizationError('Compliance officer role required');
    }

    next();
}

/**
 * POST /api/compliance/reports
 * 
 * Generate a new compliance report for a date range
 */
complianceRouter.post('/reports', requireComplianceRole, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { from, to } = DateRangeSchema.parse(req.body);

        const report = await complianceService.generateAuditReport({
            from: new Date(from),
            to: new Date(to)
        });

        const status = complianceService.checkCompliance(report);

        res.status(201).json({
            report,
            status
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/compliance/reports/monthly
 * 
 * Generate monthly compliance report
 */
complianceRouter.post('/reports/monthly', requireComplianceRole, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { year, month } = MonthSchema.parse(req.body);

        const report = await complianceService.generateMonthlyReport(year, month);
        const status = complianceService.checkCompliance(report);

        res.status(201).json({
            report,
            status
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/compliance/reports
 * 
 * List all compliance reports
 */
complianceRouter.get('/reports', requireComplianceRole, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { prisma } = await import('../db/client.js');

        const reports = await prisma.complianceReport.findMany({
            orderBy: { createdAt: 'desc' },
            take: 50,
            select: {
                id: true,
                reportId: true,
                periodStart: true,
                periodEnd: true,
                compliant: true,
                createdAt: true
            }
        });

        res.json({ reports });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/compliance/reports/:reportId
 * 
 * Get a specific compliance report
 */
complianceRouter.get('/reports/:reportId', requireComplianceRole, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { prisma } = await import('../db/client.js');
        const { reportId } = req.params;

        const report = await prisma.complianceReport.findUnique({
            where: { reportId }
        });

        if (!report) {
            return res.status(404).json({ error: 'Report not found' });
        }

        res.json({
            ...report,
            data: JSON.parse(report.data)
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/compliance/break-glass/pending
 * 
 * Get break-glass events pending review
 */
complianceRouter.get('/break-glass/pending', requireComplianceRole, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { prisma } = await import('../db/client.js');

        const pendingEvents = await prisma.breakGlassEvent.findMany({
            where: {
                reviewedAt: null
            },
            orderBy: { reviewDeadline: 'asc' },
            include: {
                auditLog: true
            }
        });

        res.json({
            pendingCount: pendingEvents.length,
            events: pendingEvents
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/compliance/break-glass/:eventId/review
 * 
 * Mark a break-glass event as reviewed
 */
complianceRouter.post('/break-glass/:eventId/review', requireComplianceRole, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { prisma } = await import('../db/client.js');
        const { eventId } = req.params;
        const { notes, approved } = req.body;
        const smartContext = (req as any).smartContext;

        const event = await prisma.breakGlassEvent.update({
            where: { id: eventId },
            data: {
                reviewedAt: new Date(),
                reviewedBy: smartContext?.practitioner || 'unknown'
            }
        });

        logger.info({ eventId, reviewedBy: smartContext?.practitioner }, 'Break-glass event reviewed');

        res.json({
            success: true,
            event
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/compliance/status
 * 
 * Get current compliance status summary
 */
complianceRouter.get('/status', requireComplianceRole, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { prisma } = await import('../db/client.js');

        const now = new Date();
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

        const [
            totalAccesses,
            breakGlassEvents,
            pendingReviews,
            recentReports
        ] = await Promise.all([
            prisma.auditLog.count({
                where: { createdAt: { gte: thirtyDaysAgo } }
            }),
            prisma.breakGlassEvent.count({
                where: { createdAt: { gte: thirtyDaysAgo } }
            }),
            prisma.breakGlassEvent.count({
                where: { reviewedAt: null }
            }),
            prisma.complianceReport.findFirst({
                where: { compliant: true },
                orderBy: { createdAt: 'desc' }
            })
        ]);

        res.json({
            period: 'last_30_days',
            metrics: {
                totalAccesses,
                breakGlassEvents,
                pendingReviews
            },
            lastCompliantReport: recentReports?.createdAt || null,
            overallStatus: pendingReviews === 0 ? 'COMPLIANT' : 'ATTENTION_REQUIRED'
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/compliance/anomalies
 * 
 * Get detected security anomalies (volume spikes, etc)
 */
complianceRouter.get('/anomalies', requireComplianceRole, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const anomalies = await anomalyDetectionService.runAllChecks();
        res.json({
            count: anomalies.length,
            anomalies
        });
    } catch (error) {
        next(error);
    }
});

export default complianceRouter;
