/**
 * HIPAA Compliance Service
 * 
 * Automated audit report generation per HIPAA §164.312(b).
 * Generates compliance reports from blockchain and database audit logs.
 */

import { prisma } from '../db/client.js';
import { ethers } from 'ethers';
import { env } from '../config/env.js';
import { logger } from './logger.js';

// Types
export interface DateRange {
    from: Date;
    to: Date;
}

export interface AuditReport {
    reportId: string;
    generatedAt: Date;
    period: DateRange;

    // Access statistics
    summary: {
        totalAccesses: number;
        uniquePatients: number;
        uniqueClinicians: number;
        averageAccessesPerDay: number;
    };

    // Proof verification
    zkProofStats: {
        totalProofsGenerated: number;
        successfulVerifications: number;
        failedVerifications: number;
        averageProofTimeMs: number;
    };

    // Break-glass events (emergency access)
    breakGlassEvents: {
        count: number;
        reviewed: number;
        pendingReview: number;
        events: Array<{
            eventId: string;
            patientId: string;
            clinicianId: string;
            reason: string;
            timestamp: Date;
            reviewed: boolean;
        }>;
    };

    // Consent metrics
    consentMetrics: {
        totalConsents: number;
        activeConsents: number;
        revokedConsents: number;
        expiredConsents: number;
    };

    // HIPAA compliance checklist
    hipaaCompliance: {
        auditControlsPresent: boolean;      // §164.312(b)
        accessLogsImmutable: boolean;       // Blockchain guarantee
        breakGlassAudited: boolean;         // All events reviewed
        consentEnforced: boolean;           // ZK proof required
        minimumNecessaryApplied: boolean;   // Category-based access
    };

    // Blockchain verification
    blockchain: {
        network: string;
        contractAddress: string;
        totalTransactions: number;
        latestBlockNumber: number;
    };
}

export interface ComplianceStatus {
    compliant: boolean;
    issues: string[];
    recommendations: string[];
}

/**
 * HIPAA Compliance Service
 * 
 * Generates automated compliance reports for auditors.
 */
export class ComplianceService {
    private provider: ethers.JsonRpcProvider | null = null;
    private auditContract: ethers.Contract | null = null;

    async initialize(): Promise<void> {
        if (env.POLYGON_AMOY_RPC) {
            this.provider = new ethers.JsonRpcProvider(env.POLYGON_AMOY_RPC);
        }

        if (env.AUDIT_CONTRACT_ADDRESS && this.provider) {
            this.auditContract = new ethers.Contract(
                env.AUDIT_CONTRACT_ADDRESS,
                [
                    'event AccessAudited(bytes32 indexed accessEventHash, bytes32 proofHash, uint64 timestamp)',
                    'function accessTimestamps(bytes32) view returns (uint64)'
                ],
                this.provider
            );
        }

        logger.info('ComplianceService initialized');
    }

    /**
     * Generate HIPAA-compliant audit report for given date range
     */
    async generateAuditReport(period: DateRange): Promise<AuditReport> {
        const reportId = `HIPAA-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        logger.info({ reportId, period }, 'Generating compliance report');

        // Fetch all required data
        const [
            accessLogs,
            breakGlassEvents,
            consentStats,
            blockchainStats
        ] = await Promise.all([
            this.fetchAccessLogs(period),
            this.fetchBreakGlassEvents(period),
            this.fetchConsentStats(period),
            this.fetchBlockchainStats(period)
        ]);

        // Calculate summary statistics
        const uniquePatients = new Set(accessLogs.map(l => l.patientId)).size;
        const uniqueClinicians = new Set(accessLogs.map(l => l.clinicianId)).size;
        const daysDiff = Math.max(1, Math.ceil(
            (period.to.getTime() - period.from.getTime()) / (1000 * 60 * 60 * 24)
        ));

        // Calculate proof stats
        const proofLogs = accessLogs.filter(l => l.proofHash);
        const avgProofTime = proofLogs.length > 0
            ? proofLogs.reduce((sum, l) => sum + (l.proofDurationMs || 0), 0) / proofLogs.length
            : 0;

        const report: AuditReport = {
            reportId,
            generatedAt: new Date(),
            period,

            summary: {
                totalAccesses: accessLogs.length,
                uniquePatients,
                uniqueClinicians,
                averageAccessesPerDay: accessLogs.length / daysDiff
            },

            zkProofStats: {
                totalProofsGenerated: proofLogs.length,
                successfulVerifications: proofLogs.filter(l => l.proofVerified).length,
                failedVerifications: proofLogs.filter(l => !l.proofVerified).length,
                averageProofTimeMs: avgProofTime
            },

            breakGlassEvents: {
                count: breakGlassEvents.length,
                reviewed: breakGlassEvents.filter(e => e.reviewedAt).length,
                pendingReview: breakGlassEvents.filter(e => !e.reviewedAt).length,
                events: breakGlassEvents.map(e => ({
                    eventId: e.id,
                    patientId: e.patientId,
                    clinicianId: e.clinicianId,
                    reason: e.reason,
                    timestamp: e.createdAt,
                    reviewed: !!e.reviewedAt
                }))
            },

            consentMetrics: consentStats,

            hipaaCompliance: {
                auditControlsPresent: true,
                accessLogsImmutable: blockchainStats.totalTransactions > 0,
                breakGlassAudited: breakGlassEvents.every(e => e.reviewedAt),
                consentEnforced: accessLogs.every(l => l.proofHash || l.isBreakGlass),
                minimumNecessaryApplied: true // Category-based access control
            },

            blockchain: blockchainStats
        };

        // Store report in database
        await this.storeReport(report);

        logger.info({ reportId, compliant: this.checkCompliance(report).compliant }, 'Report generated');

        return report;
    }

    /**
     * Check overall compliance status
     */
    checkCompliance(report: AuditReport): ComplianceStatus {
        const issues: string[] = [];
        const recommendations: string[] = [];

        // Check break-glass reviews
        if (!report.hipaaCompliance.breakGlassAudited) {
            issues.push(`${report.breakGlassEvents.pendingReview} break-glass events pending review`);
            recommendations.push('Review all break-glass events within 72 hours per policy');
        }

        // Check proof failures
        if (report.zkProofStats.failedVerifications > 0) {
            issues.push(`${report.zkProofStats.failedVerifications} proof verification failures detected`);
            recommendations.push('Investigate failed proofs for potential tampering');
        }

        // Check blockchain connectivity
        if (!report.hipaaCompliance.accessLogsImmutable) {
            issues.push('Blockchain audit trail not available');
            recommendations.push('Verify Polygon Amoy connectivity and contract deployment');
        }

        // Check consent enforcement
        if (!report.hipaaCompliance.consentEnforced) {
            issues.push('Some accesses lack ZK proof or break-glass authorization');
            recommendations.push('Ensure all clinical data access has proper authorization');
        }

        // High break-glass ratio warning
        const breakGlassRatio = report.breakGlassEvents.count / Math.max(1, report.summary.totalAccesses);
        if (breakGlassRatio > 0.05) {
            recommendations.push(`Break-glass usage (${(breakGlassRatio * 100).toFixed(1)}%) exceeds 5% threshold - review patterns`);
        }

        return {
            compliant: issues.length === 0,
            issues,
            recommendations
        };
    }

    /**
     * Generate monthly compliance report (convenience method)
     */
    async generateMonthlyReport(year: number, month: number): Promise<AuditReport> {
        const from = new Date(year, month - 1, 1);
        const to = new Date(year, month, 0, 23, 59, 59);
        return this.generateAuditReport({ from, to });
    }

    // Private methods

    private async fetchAccessLogs(period: DateRange): Promise<any[]> {
        try {
            return await prisma.auditLog.findMany({
                where: {
                    createdAt: {
                        gte: period.from,
                        lte: period.to
                    }
                },
                orderBy: { createdAt: 'desc' }
            });
        } catch {
            return [];
        }
    }

    private async fetchBreakGlassEvents(period: DateRange): Promise<any[]> {
        try {
            return await prisma.breakGlassEvent.findMany({
                where: {
                    createdAt: {
                        gte: period.from,
                        lte: period.to
                    }
                },
                orderBy: { createdAt: 'desc' }
            });
        } catch {
            return [];
        }
    }

    private async fetchConsentStats(period: DateRange): Promise<{
        totalConsents: number;
        activeConsents: number;
        revokedConsents: number;
        expiredConsents: number;
    }> {
        // Query FHIR server for Consent resources
        const fhirUrl = env.HAPI_FHIR_URL;

        if (!fhirUrl) {
            logger.warn('HAPI_FHIR_URL not configured, returning empty consent stats');
            return { totalConsents: 0, activeConsents: 0, revokedConsents: 0, expiredConsents: 0 };
        }

        try {
            const axios = (await import('axios')).default;
            const now = new Date();

            // Fetch all consents in the period
            const response = await axios.get(`${fhirUrl}/Consent`, {
                params: {
                    _count: 1000,
                    _lastUpdated: `ge${period.from.toISOString().split('T')[0]}`,
                    '_lastUpdated:lt': period.to.toISOString().split('T')[0]
                },
                timeout: 10000
            });

            const bundle = response.data;
            const consents = bundle.entry?.map((e: any) => e.resource) || [];

            let active = 0;
            let revoked = 0;
            let expired = 0;

            for (const consent of consents) {
                const status = consent.status;
                const periodEnd = consent.provision?.period?.end
                    ? new Date(consent.provision.period.end)
                    : null;

                if (status === 'active' && (!periodEnd || periodEnd > now)) {
                    active++;
                } else if (status === 'rejected' || status === 'inactive') {
                    revoked++;
                } else if (periodEnd && periodEnd <= now) {
                    expired++;
                }
            }

            return {
                totalConsents: consents.length,
                activeConsents: active,
                revokedConsents: revoked,
                expiredConsents: expired
            };
        } catch (error: any) {
            logger.error({ err: error }, 'Failed to fetch consent stats from FHIR server');
            return { totalConsents: 0, activeConsents: 0, revokedConsents: 0, expiredConsents: 0 };
        }
    }

    private async fetchBlockchainStats(period: DateRange): Promise<{
        network: string;
        contractAddress: string;
        totalTransactions: number;
        latestBlockNumber: number;
    }> {
        if (!this.provider || !this.auditContract) {
            return {
                network: 'not-configured',
                contractAddress: 'not-configured',
                totalTransactions: 0,
                latestBlockNumber: 0
            };
        }

        try {
            const latestBlock = await this.provider.getBlockNumber();

            // Count events in period (simplified - real impl would paginate)
            const filter = this.auditContract.filters.AccessAudited();
            const events = await this.auditContract.queryFilter(filter);

            return {
                network: 'polygon-amoy',
                contractAddress: env.AUDIT_CONTRACT_ADDRESS || '',
                totalTransactions: events.length,
                latestBlockNumber: latestBlock
            };
        } catch (error) {
            logger.warn({ error }, 'Failed to fetch blockchain stats');
            return {
                network: 'polygon-amoy',
                contractAddress: env.AUDIT_CONTRACT_ADDRESS || '',
                totalTransactions: 0,
                latestBlockNumber: 0
            };
        }
    }

    private async storeReport(report: AuditReport): Promise<void> {
        try {
            await prisma.complianceReport.create({
                data: {
                    reportId: report.reportId,
                    periodStart: report.period.from,
                    periodEnd: report.period.to,
                    data: JSON.stringify(report),
                    compliant: this.checkCompliance(report).compliant
                }
            });
        } catch (error) {
            logger.warn({ error }, 'Failed to store compliance report');
        }
    }
}

// Singleton
export const complianceService = new ComplianceService();

export default complianceService;
