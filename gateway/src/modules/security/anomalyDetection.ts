/**
 * Anomaly Detection Service
 * Sherlock Holmes for access logs. Spots weird spikes and clusters.
 */

import { prisma } from '../../db/client.js';
import { logger } from '../../lib/logger.js';
import { webhookService } from '../notification/webhookService.js';

export interface Anomaly {
    type: 'HIGH_VOLUME' | 'OFF_HOURS_SPIKE' | 'BREAK_GLASS_CLUSTER';
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    description: string;
    detectedAt: Date;
    metadata: Record<string, any>;
}

export class AnomalyDetectionService {
    private checkInterval: NodeJS.Timeout | null = null;
    private isRunning = false;

    /**
     * Start periodic anomaly checks (every 10 minutes)
     */
    start() {
        if (this.isRunning) return;
        this.isRunning = true;

        // Run immediately
        this.runAllChecks().catch(err => logger.error({ err }, 'Initial anomaly check failed'));

        // Schedule
        this.checkInterval = setInterval(() => {
            this.runAllChecks().catch(err => logger.error({ err }, 'Scheduled anomaly check failed'));
        }, 10 * 60 * 1000); // 10 minutes

        logger.info('Anomaly Detection Service started');
    }

    /**
     * Stop periodic checks
     */
    stop() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
        this.isRunning = false;
        logger.info('Anomaly Detection Service stopped');
    }

    /**
     * Volume spike check. > 50 accesses in 1h by one person is sus.
     */
    async detectVolumeAnomalies(windowHours = 1): Promise<Anomaly[]> {
        const anomalies: Anomaly[] = [];
        const windowStart = new Date(Date.now() - windowHours * 60 * 60 * 1000);

        // Group by clinician
        const accessCounts = await prisma.auditLog.groupBy({
            by: ['clinicianId'],
            where: {
                createdAt: { gte: windowStart }
            },
            _count: {
                id: true
            }
        });

        for (const entry of accessCounts) {
            if (entry._count.id > 50) {
                anomalies.push({
                    type: 'HIGH_VOLUME',
                    severity: 'CRITICAL',
                    description: `Clinician ${entry.clinicianId} accessed ${entry._count.id} records in the last ${windowHours} hour(s)`,
                    detectedAt: new Date(),
                    metadata: {
                        clinicianId: entry.clinicianId,
                        count: entry._count.id,
                        threshold: 50
                    }
                });
            }
        }

        return anomalies;
    }

    /**
     * Break-Glass cluster check. > 3 emergencies in 24h? unlikely.
     */
    async detectBreakGlassClusters(): Promise<Anomaly[]> {
        const anomalies: Anomaly[] = [];
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

        const count = await prisma.breakGlassEvent.count({
            where: {
                createdAt: { gte: oneDayAgo }
            }
        });

        if (count > 3) {
            anomalies.push({
                type: 'BREAK_GLASS_CLUSTER',
                severity: 'HIGH',
                description: `Unusual spike in emergency access: ${count} events in 24h`,
                detectedAt: new Date(),
                metadata: {
                    count,
                    threshold: 3
                }
            });
        }

        return anomalies;
    }

    /**
     * Run all checks and persist findings
     */
    async runAllChecks(): Promise<Anomaly[]> {
        try {
            logger.debug('Running anomaly checks...');
            const [volume, clusters] = await Promise.all([
                this.detectVolumeAnomalies(),
                this.detectBreakGlassClusters()
            ]);

            const allAnomalies = [...volume, ...clusters];

            if (allAnomalies.length > 0) {
                logger.warn({ count: allAnomalies.length }, 'Anomalies detected');

                // Persist to SystemEvent and Trigger Webhooks
                for (const anomaly of allAnomalies) {
                    // 1. Log to DB
                    await prisma.systemEvent.create({
                        data: {
                            eventType: 'ANOMALY_DETECTED',
                            severity: anomaly.severity,
                            component: 'AnomalyDetection',
                            details: anomaly.description,
                            metadata: JSON.stringify({ ...anomaly.metadata, type: anomaly.type })
                        }
                    });

                    // 2. Emit Webhook
                    // For system-wide alerts, we use a special 'system' tenant identifier or broadcast to an admin channel
                    webhookService.emit('system', 'alert.created', {
                        alertType: 'ANOMALY_DETECTED',
                        severity: anomaly.severity,
                        anomalyType: anomaly.type,
                        details: anomaly.description,
                        detectedAt: anomaly.detectedAt.toISOString(),
                        metadata: anomaly.metadata
                    }).catch((err: any) => logger.error({ err }, 'Failed to emit anomaly webhook'));
                }
            }

            return allAnomalies;
        } catch (error) {
            logger.error({ error }, 'Failed to run anomaly checks');
            return [];
        }
    }
}

export const anomalyDetectionService = new AnomalyDetectionService();
