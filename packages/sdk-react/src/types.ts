/**
 * Type definitions for @zk-guardian/react
 */

import type { ZKGuardianConfig as CoreZKGuardianConfig } from '@zk-guardian/sdk';

export interface ZKGuardianConfig extends Partial<CoreZKGuardianConfig> {
    /** Gateway API URL */
    gatewayUrl: string;
    /** WebSocket URL (defaults to ws://gatewayUrl/ws/consent) */
    wsUrl?: string;
    /** API key for machine-to-machine auth (optional) */
    apiKey?: string;
    /** Patient ID (for patient-facing apps) */
    patientId?: string;
    /** Enable debug logging */
    debug?: boolean;
}

export interface ConsentState {
    status: 'loading' | 'idle' | 'pending' | 'approved' | 'denied' | 'expired' | 'revoked';
    activeConsents: ConsentSummary[];
    pendingRequests: ConsentRequest[];
    error: string | null;
}

export interface ConsentSummary {
    id: string;
    practitionerId: string;
    practitionerName: string;
    allowedCategories: string[];
    validFrom: Date;
    validUntil: Date;
    status: 'active' | 'revoked';
}

export interface ConsentRequest {
    requestId: string;
    clinicianId: string;
    clinicianName: string;
    department: string;
    resourceType: string;
    purpose: string;
    expiresAt: Date;
    status: 'pending' | 'approved' | 'denied' | 'expired';
}

export interface AuditLogEntry {
    id: string;
    clinicianId: string;
    clinicianName: string | null;
    department: string | null;
    resourceType: string;
    accessEventHash: string;
    txHash: string | null;
    isBreakGlass: boolean;
    purpose: string | null;
    verified: boolean;
    createdAt: Date;
}

export interface BreakGlassSession {
    id: string;
    clinicianId: string;
    clinicianName: string;
    department: string | null;
    reason: string;
    status: 'active' | 'closed' | 'expired';
    expiresAt: Date;
    accessedResources: string[];
}

export interface UseConsentReturn {
    state: ConsentState;
    approve: (requestId: string) => Promise<void>;
    deny: (requestId: string, reason?: string) => Promise<void>;
    revoke: (consentId: string) => Promise<void>;
    refresh: () => Promise<void>;
}

export interface UseAuditLogReturn {
    entries: AuditLogEntry[];
    loading: boolean;
    error: string | null;
    hasMore: boolean;
    loadMore: () => Promise<void>;
    refresh: () => Promise<void>;
}

export interface UseBreakGlassReturn {
    activeSessions: BreakGlassSession[];
    loading: boolean;
    error: string | null;
    refresh: () => Promise<void>;
}
