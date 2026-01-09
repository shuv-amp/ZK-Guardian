/**
 * Compliance Report Service
 * 
 * Generates automated checking of HIPAA compliance metrics.
 * 
 * Requirements (SECURITY_AUDIT_CHECKLIST.md Section 5):
 * - H2: Audit trail maintained
 * - H3: Break-glass audit
 * - M2, M3: Monitoring metrics
 */

import { prisma } from '../db/client.js';
import { logger } from '../lib/logger.js';

export interface ComplianceReport {
    generatedAt: string;
    period: {
        start: string;
        end: string;
    };
    summary: {
        totalAccessRequests: number;
        granted: number; // Derived from AuditLog (successful access)
        denied: number;  // Currently tracked via SystemEvents or logs (placeholder 0)
        breakGlassCount: number;
    };
    breakGlassAnalysis: {
        total: number;
        verified: number;
        failedVerification: number;
        users: string[];
    };
    securityEvents: {
        failedProofs: number;
        revocationChecks: number; // Inferred from successful access
        policyViolations: number;
    };
    status: 'COMPLIANT' | 'NEEDS_REVIEW' | 'NON_COMPLIANT';
}

export class ComplianceReportService {

    /**
     * Generate a compliance report for a specific month
     * @param year 
     * @param month 1-12
     */
    async generateMonthlyReport(year: number, month: number): Promise<ComplianceReport> {
        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0, 23, 59, 59);

        logger.info({ year, month }, 'Generating compliance report');

        // AuditLog tracks successful (verified) accesses
        const [
            granted,
            breakGlass
        ] = await Promise.all([
            prisma.auditLog.count({ where: { createdAt: { gte: startDate, lte: endDate } } }),
            prisma.auditLog.findMany({
                where: {
                    createdAt: { gte: startDate, lte: endDate },
                    isBreakGlass: true
                }
            })
        ]);

        // Access denied would require querying SystemEvents or specific logs
        // For now, we assume AuditLog contains valid access
        const denied = 0;
        const totalAccess = granted + denied;

        // Break-glass analysis
        const breakGlassClinicians = new Set(breakGlass.map(bg => bg.clinicianId));

        // Security events
        const failedProofs = await prisma.systemEvent.count({
            where: {
                createdAt: { gte: startDate, lte: endDate },
                eventType: 'CIRCUIT_ERROR'
            }
        });

        const policyViolations = denied + failedProofs;

        let status: ComplianceReport['status'] = 'COMPLIANT';
        if (breakGlass.length > 50 || failedProofs > 100) status = 'NEEDS_REVIEW';
        if (failedProofs > 1000) status = 'NON_COMPLIANT';

        return {
            generatedAt: new Date().toISOString(),
            period: {
                start: startDate.toISOString(),
                end: endDate.toISOString()
            },
            summary: {
                totalAccessRequests: totalAccess,
                granted,
                denied,
                breakGlassCount: breakGlass.length
            },
            breakGlassAnalysis: {
                total: breakGlass.length,
                verified: breakGlass.filter(bg => bg.verified).length,
                failedVerification: breakGlass.filter(bg => !bg.verified).length,
                users: Array.from(breakGlassClinicians)
            },
            securityEvents: {
                failedProofs,
                revocationChecks: granted, // Every granted access implies a check
                policyViolations
            },
            status
        };
    }
}

export const complianceReportService = new ComplianceReportService();
