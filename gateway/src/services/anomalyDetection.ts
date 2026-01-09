/**
 * Anomaly Detection Service
 * Sherlock Holmes for access logs. Spots weird spikes and clusters.
 */

import { prisma } from '../db/client.js';
import { logger } from '../lib/logger.js';

export interface Anomaly {
    type: 'HIGH_VOLUME' | 'OFF_HOURS_SPIKE' | 'BREAK_GLASS_CLUSTER';
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    description: string;
    detectedAt: Date;
    metadata: Record<string, any>;
}

export class AnomalyDetectionService {

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
     * Run all checks
     */
    async runAllChecks(): Promise<Anomaly[]> {
        try {
            const [volume, clusters] = await Promise.all([
                this.detectVolumeAnomalies(),
                this.detectBreakGlassClusters()
            ]);

            const allAnomalies = [...volume, ...clusters];

            if (allAnomalies.length > 0) {
                logger.warn({ count: allAnomalies.length }, 'Anomalies detected');
            }

            return allAnomalies;
        } catch (error) {
            logger.error({ error }, 'Failed to run anomaly checks');
            return [];
        }
    }
}

export const anomalyDetectionService = new AnomalyDetectionService();
