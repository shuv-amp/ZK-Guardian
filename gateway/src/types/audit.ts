/**
 * Patient Audit API Types
 * 
 * Defines all types for the Patient Audit Dashboard API endpoints.
 */

export interface AccessRecord {
    id: string;
    accessEventHash: string;
    resourceType: string;
    resourceId: string;
    accessTimestamp: string;
    clinician: {
        id: string;
        displayName: string;
        department: string;
        specialty: string;
    };
    purpose: string;
    isBreakGlass: boolean;
    blockchain: {
        txHash: string;
        blockNumber: number;
        verified: boolean;
        timestamp: string;
    };
}

export interface AccessHistoryResponse {
    patientId: string;
    period: {
        from: string;
        to: string;
    };
    pagination: {
        limit: number;
        offset: number;
        total: number;
        hasMore: boolean;
    };
    summary: {
        totalAccesses: number;
        byResourceType: Record<string, number>;
        byDepartment: Record<string, number>;
        emergencyAccesses: number;
        uniqueClinicians: number;
    };
    records: AccessRecord[];
}

export interface AccessHistoryQuery {
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
    resourceType?: string;
    department?: string;
    includeBreakGlass?: boolean;
}

export type AlertSeverity = 'LOW' | 'MEDIUM' | 'HIGH';
export type AlertType = 'AFTER_HOURS' | 'UNUSUAL_VOLUME' | 'NEW_PROVIDER' | 'SENSITIVE_RESOURCE' | 'BREAK_GLASS';

export interface AccessAlert {
    id: string;
    type: AlertType;
    severity: AlertSeverity;
    message: string;
    accessEventHash: string;
    createdAt: string;
    acknowledgedAt?: string;
    acknowledgedNotes?: string;
    relatedAccess: {
        clinician: string;
        resourceType: string;
    };
    suggestedAction: string;
}

export interface AccessAlertsResponse {
    unacknowledged: number;
    alerts: AccessAlert[];
}

export interface AcknowledgeAlertRequest {
    acknowledged: boolean;
    notes?: string;
}

export interface AcknowledgeAlertResponse {
    success: boolean;
    alertId: string;
    acknowledgedAt: string;
}
