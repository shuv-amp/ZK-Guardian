/**
 * Compliance Dashboard Routes
 * 
 * Endpoints for compliance officers to view audits and break-glass events.
 * Protected by strict admin scopes.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { complianceReportService } from '../../modules/audit/complianceReportService.js';
import { requireScopes } from '../../middleware/apiKeyAuth.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../db/client.js';
import { z } from 'zod';

export const complianceRouter: Router = Router();

/**
 * GET /api/admin/compliance/summary?year=2024&month=1
 * Get compliance summary report for a specific month
 */
complianceRouter.get('/summary', requireScopes('admin:read'), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const query = z.object({
            year: z.coerce.number().min(2023).max(2030).default(new Date().getFullYear()),
            month: z.coerce.number().min(1).max(12).default(new Date().getMonth() + 1)
        }).parse(req.query);

        logger.info({ user: (req as any).apiKey?.name, ...query }, 'Compliance report requested');

        const report = await complianceReportService.generateMonthlyReport(query.year, query.month);

        res.json({
            success: true,
            report
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/admin/compliance/break-glass
 * Get detailed break-glass event logs
 */
complianceRouter.get('/break-glass', requireScopes('admin:read'), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const query = z.object({
            limit: z.coerce.number().min(1).max(100).default(20),
            offset: z.coerce.number().min(0).default(0)
        }).parse(req.query);

        const events = await prisma.breakGlassEvent.findMany({
            take: query.limit,
            skip: query.offset,
            orderBy: { createdAt: 'desc' },
            include: {
                auditLog: {
                    select: {
                        resourceType: true,
                        resourceId: true,
                        clinicianName: true
                    }
                }
            }
        });

        const total = await prisma.breakGlassEvent.count();

        res.json({
            success: true,
            data: events,
            pagination: {
                total,
                limit: query.limit,
                offset: query.offset
            }
        });
    } catch (error) {
        next(error);
    }
});
