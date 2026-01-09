'use client';

/**
 * useConsent Hook
 * 
 * Manages consent state for a patient:
 * - Active consents
 * - Pending requests
 * - Approve/deny/revoke actions
 */

import { useState, useCallback, useEffect } from 'react';
import { useZKGuardian } from '../context/ZKGuardianProvider';
import type { ConsentState, ConsentSummary, UseConsentReturn } from '../types';

export function useConsent(): UseConsentReturn {
    const { client, config, pendingRequests, removePendingRequest } = useZKGuardian();

    const [state, setState] = useState<ConsentState>({
        status: 'loading',
        activeConsents: [],
        pendingRequests: [],
        error: null
    });

    // Sync pending requests from context
    useEffect(() => {
        setState(prev => ({
            ...prev,
            pendingRequests,
            status: pendingRequests.length > 0 ? 'pending' : prev.status
        }));
    }, [pendingRequests]);

    // Load active consents on mount
    useEffect(() => {
        if (!client || !config.patientId) return;
        refresh();
    }, [client, config.patientId]);

    const refresh = useCallback(async () => {
        if (!client || !config.patientId) return;

        setState(prev => ({ ...prev, status: 'loading', error: null }));

        try {
            const response = await fetch(
                `${config.gatewayUrl}/api/patient/${config.patientId}/consents`,
                {
                    headers: config.apiKey
                        ? { Authorization: `Bearer ${config.apiKey}` }
                        : {}
                }
            );

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            const consents: ConsentSummary[] = (data.consents || []).map((c: any) => ({
                id: c.id,
                practitionerId: c.practitionerId,
                practitionerName: c.practitionerName,
                allowedCategories: c.allowedCategories,
                validFrom: new Date(c.validFrom),
                validUntil: new Date(c.validUntil),
                status: c.status
            }));

            setState(prev => ({
                ...prev,
                status: prev.pendingRequests.length > 0 ? 'pending' : 'idle',
                activeConsents: consents,
                error: null
            }));
        } catch (err: any) {
            setState(prev => ({
                ...prev,
                status: 'idle',
                error: err.message
            }));
        }
    }, [client, config.gatewayUrl, config.patientId, config.apiKey]);

    const approve = useCallback(async (requestId: string) => {
        if (!client || !config.patientId) {
            throw new Error('Not initialized');
        }

        const response = await fetch(
            `${config.gatewayUrl}/api/patient/${config.patientId}/consents/approve`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {})
                },
                body: JSON.stringify({ requestId })
            }
        );

        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Failed to approve');
        }

        removePendingRequest(requestId);

        setState(prev => ({
            ...prev,
            status: prev.pendingRequests.length <= 1 ? 'approved' : 'pending'
        }));

        // Refresh consents
        await refresh();
    }, [client, config, removePendingRequest, refresh]);

    const deny = useCallback(async (requestId: string, reason?: string) => {
        if (!client || !config.patientId) {
            throw new Error('Not initialized');
        }

        const response = await fetch(
            `${config.gatewayUrl}/api/patient/${config.patientId}/consents/deny`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {})
                },
                body: JSON.stringify({ requestId, reason })
            }
        );

        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Failed to deny');
        }

        removePendingRequest(requestId);

        setState(prev => ({
            ...prev,
            status: prev.pendingRequests.length <= 1 ? 'denied' : 'pending'
        }));
    }, [client, config, removePendingRequest]);

    const revoke = useCallback(async (consentId: string) => {
        if (!client || !config.patientId) {
            throw new Error('Not initialized');
        }

        const response = await fetch(
            `${config.gatewayUrl}/api/patient/${config.patientId}/consents/${consentId}/revoke`,
            {
                method: 'POST',
                headers: config.apiKey
                    ? { Authorization: `Bearer ${config.apiKey}` }
                    : {}
            }
        );

        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Failed to revoke');
        }

        setState(prev => ({
            ...prev,
            activeConsents: prev.activeConsents.map(c =>
                c.id === consentId ? { ...c, status: 'revoked' as const } : c
            )
        }));
    }, [client, config]);

    return { state, approve, deny, revoke, refresh };
}

export default useConsent;
