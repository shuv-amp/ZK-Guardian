import { AccessRecord, AccessAlert, AlertSeverity, AlertType } from '../types/audit.js';
import { prisma } from '../db/client.js';
import { logger } from '../lib/logger.js';

/**
 * Alert Service
 * 
 * Detects suspicious access patterns and generates alerts for patient review.
 * 
 * Alert Types:
 * - AFTER_HOURS: Access outside 7 AM - 7 PM
 * - UNUSUAL_VOLUME: >10 accesses in 1 hour from same clinician
 * - NEW_PROVIDER: First-time access by this clinician
 * - SENSITIVE_RESOURCE: Access to sensitive categories (psychiatry, HIV, substance)
 * - BREAK_GLASS: Emergency access bypass
 */

interface AlertRule {
    type: AlertType;
    severity: AlertSeverity;
    check: (record: AccessRecord, history: AccessRecord[]) => boolean;
    message: (record: AccessRecord) => string;
    suggestedAction: string;
}

// In-memory storage for clinician access history
const clinicianAccessHistory: Map<string, Map<string, number>> = new Map(); // patientId -> clinicianId -> count

// Sensitive resource categories
const SENSITIVE_CATEGORIES = ['psychiatry', 'mental-health', 'hiv', 'substance-abuse', 'reproductive'];

/**
 * Alert rules configuration
 */
const ALERT_RULES: AlertRule[] = [
    {
        type: 'AFTER_HOURS',
        severity: 'MEDIUM',
        check: (record) => {
            const hour = new Date(record.accessTimestamp).getHours();
            return hour < 7 || hour >= 19;
        },
        message: (record) => {
            const hour = new Date(record.accessTimestamp).getHours();
            return `Access occurred outside normal hours (${hour}:00)`;
        },
        suggestedAction: 'Review if this access was expected'
    },
    {
        type: 'UNUSUAL_VOLUME',
        severity: 'HIGH',
        check: (record, history) => {
            const oneHourAgo = Date.now() - 60 * 60 * 1000;
            const recentByClinic = history.filter(r =>
                r.clinician.id === record.clinician.id &&
                new Date(r.accessTimestamp).getTime() > oneHourAgo
            );
            return recentByClinic.length > 10;
        },
        message: (record) => `Unusual volume: ${record.clinician.displayName} accessed >10 records in the past hour`,
        suggestedAction: 'Verify this is part of normal care workflow'
    },
    {
        type: 'NEW_PROVIDER',
        severity: 'LOW',
        check: (record, history) => {
            return !history.some(r => r.clinician.id === record.clinician.id);
        },
        message: (record) => `First-time access by ${record.clinician.displayName}`,
        suggestedAction: 'Confirm you are receiving care from this provider'
    },
    {
        type: 'SENSITIVE_RESOURCE',
        severity: 'HIGH',
        check: (record) => {
            const resourceLower = record.resourceType.toLowerCase();
            return SENSITIVE_CATEGORIES.some(cat => resourceLower.includes(cat));
        },
        message: (record) => `Access to sensitive category: ${record.resourceType}`,
        suggestedAction: 'Verify this access was necessary for your care'
    },
    {
        type: 'BREAK_GLASS',
        severity: 'HIGH',
        check: (record) => record.isBreakGlass,
        message: (record) => `Emergency break-glass access was used by ${record.clinician.displayName}`,
        suggestedAction: 'Verify this was a legitimate emergency'
    }
];

class AlertService {
    // In-memory cache for recent history (hot path optimization)
    private recentHistoryCache: Map<string, AccessRecord[]> = new Map();
    private readonly CACHE_SIZE_LIMIT = 100; // Max records per patient in cache

    /**
     * Analyze an access record and generate any applicable alerts.
     * Stores alerts in PostgreSQL for durability.
     */
    async analyzeAccess(patientId: string, record: AccessRecord): Promise<AccessAlert[]> {
        // Get recent history for pattern matching (from cache or DB)
        const history = await this.getRecentHistory(patientId);
        const newAlerts: AccessAlert[] = [];

        for (const rule of ALERT_RULES) {
            if (rule.check(record, history)) {
                const alert: AccessAlert = {
                    id: `alert-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                    type: rule.type,
                    severity: rule.severity,
                    message: rule.message(record),
                    accessEventHash: record.accessEventHash,
                    createdAt: new Date().toISOString(),
                    relatedAccess: {
                        clinician: record.clinician.displayName,
                        resourceType: record.resourceType
                    },
                    suggestedAction: rule.suggestedAction
                };

                newAlerts.push(alert);
            }
        }

        // Store in PostgreSQL
        if (newAlerts.length > 0) {
            try {
                await prisma.accessAlert.createMany({
                    data: newAlerts.map(alert => ({
                        id: alert.id,
                        patientId,
                        type: alert.type,
                        severity: alert.severity,
                        message: alert.message,
                        suggestedAction: alert.suggestedAction,
                        relatedClinician: alert.relatedAccess.clinician,
                        relatedResourceType: alert.relatedAccess.resourceType
                    }))
                });

                logger.info({
                    patientId,
                    alertCount: newAlerts.length,
                    types: newAlerts.map(a => a.type)
                }, 'Access alerts created');
            } catch (error) {
                logger.error({ error, patientId }, 'Failed to store alerts');
            }
        }

        // Update cache
        this.updateCache(patientId, record);

        return newAlerts;
    }

    /**
     * Get all alerts for a patient from database
     */
    async getAlertsForPatient(patientId: string, options?: {
        acknowledged?: boolean;
        severity?: AlertSeverity;
        limit?: number;
    }): Promise<AccessAlert[]> {
        const where: any = { patientId };

        if (options?.acknowledged !== undefined) {
            where.acknowledgedAt = options.acknowledged ? { not: null } : null;
        }
        if (options?.severity) {
            where.severity = options.severity;
        }

        const dbAlerts = await prisma.accessAlert.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: options?.limit || 100
        });

        return dbAlerts.map(a => ({
            id: a.id,
            type: a.type as AlertType,
            severity: a.severity as AlertSeverity,
            message: a.message,
            accessEventHash: '',
            createdAt: a.createdAt.toISOString(),
            relatedAccess: {
                clinician: a.relatedClinician || '',
                resourceType: a.relatedResourceType || ''
            },
            suggestedAction: a.suggestedAction || '',
            acknowledgedAt: a.acknowledgedAt?.toISOString(),
            acknowledgedNotes: a.acknowledgedNotes || undefined
        }));
    }

    /**
     * Get unacknowledged alert count
     */
    async getUnacknowledgedCount(patientId: string): Promise<number> {
        return prisma.accessAlert.count({
            where: { patientId, acknowledgedAt: null }
        });
    }

    /**
     * Acknowledge an alert
     */
    async acknowledgeAlert(patientId: string, alertId: string, notes?: string): Promise<boolean> {
        try {
            await prisma.accessAlert.update({
                where: { id: alertId },
                data: {
                    acknowledgedAt: new Date(),
                    acknowledgedNotes: notes
                }
            });

            logger.info({ patientId, alertId }, 'Alert acknowledged');
            return true;
        } catch (error) {
            logger.error({ error, alertId }, 'Failed to acknowledge alert');
            return false;
        }
    }

    /**
     * Get access statistics for a patient
     */
    async getAccessStats(patientId: string): Promise<{
        totalAccesses: number;
        uniqueClinicians: number;
        alertsByType: Record<AlertType, number>;
    }> {
        const [totalAccesses, clinicianGroups, alertCounts] = await Promise.all([
            prisma.auditLog.count({ where: { patientId } }),
            prisma.auditLog.groupBy({
                by: ['clinicianId'],
                where: { patientId }
            }),
            prisma.accessAlert.groupBy({
                by: ['type'],
                where: { patientId },
                _count: true
            })
        ]);

        const alertsByType: Record<AlertType, number> = {
            'AFTER_HOURS': 0,
            'UNUSUAL_VOLUME': 0,
            'NEW_PROVIDER': 0,
            'SENSITIVE_RESOURCE': 0,
            'BREAK_GLASS': 0
        };

        alertCounts.forEach(a => {
            if (a.type in alertsByType) {
                alertsByType[a.type as AlertType] = a._count;
            }
        });

        return {
            totalAccesses,
            uniqueClinicians: clinicianGroups.length,
            alertsByType
        };
    }

    /**
     * Get recent access history for pattern matching
     */
    private async getRecentHistory(patientId: string): Promise<AccessRecord[]> {
        // Check cache first
        const cached = this.recentHistoryCache.get(patientId);
        if (cached && cached.length > 0) {
            return cached;
        }

        // Fetch from database
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        const records = await prisma.auditLog.findMany({
            where: {
                patientId,
                createdAt: { gte: oneHourAgo }
            },
            orderBy: { createdAt: 'desc' },
            take: 100
        });

        const history: AccessRecord[] = records.map(r => ({
            id: r.id,
            accessEventHash: r.accessEventHash,
            resourceId: r.resourceId || '',
            resourceType: r.resourceType,
            accessTimestamp: r.createdAt.toISOString(),
            clinician: {
                id: r.clinicianId,
                displayName: r.clinicianName || 'Unknown',
                department: r.department || 'Unknown',
                specialty: ''
            },
            purpose: r.purpose || 'Treatment',
            isBreakGlass: r.isBreakGlass,
            blockchain: {
                txHash: r.txHash || '',
                blockNumber: Number(r.blockNumber) || 0,
                verified: r.verified,
                timestamp: r.createdAt.toISOString()
            }
        }));

        this.recentHistoryCache.set(patientId, history);
        return history;
    }

    /**
     * Update cache with new record
     */
    private updateCache(patientId: string, record: AccessRecord): void {
        const existing = this.recentHistoryCache.get(patientId) || [];
        existing.unshift(record);

        // Limit cache size
        if (existing.length > this.CACHE_SIZE_LIMIT) {
            existing.pop();
        }

        this.recentHistoryCache.set(patientId, existing);
    }

    /**
     * Clear cache (for testing or memory management)
     */
    clearCache(): void {
        this.recentHistoryCache.clear();
    }
}

// Singleton export
export const alertService = new AlertService();
export { AlertService, ALERT_RULES, SENSITIVE_CATEGORIES };
