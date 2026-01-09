'use client';

/**
 * useBreakGlass Hook
 * 
 * Monitor break-glass emergency access sessions for a patient.
 */

import { useState, useCallback, useEffect } from 'react';
import { useZKGuardian } from '../context/ZKGuardianProvider';
import type { BreakGlassSession, UseBreakGlassReturn } from '../types';

export function useBreakGlass(): UseBreakGlassReturn {
    const { config } = useZKGuardian();

    const [activeSessions, setActiveSessions] = useState<BreakGlassSession[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        if (!config.patientId) {
            setError('Patient ID required');
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const response = await fetch(
                `${config.gatewayUrl}/api/patient/${config.patientId}/break-glass`,
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
            const sessions: BreakGlassSession[] = (data.sessions || []).map((s: any) => ({
                id: s.id,
                clinicianId: s.clinicianId,
                clinicianName: s.clinicianName,
                department: s.department,
                reason: s.reason,
                status: s.status,
                expiresAt: new Date(s.expiresAt),
                accessedResources: s.accessedResources || []
            }));

            setActiveSessions(sessions.filter(s => s.status === 'active'));
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [config.gatewayUrl, config.patientId, config.apiKey]);

    // Initial load
    useEffect(() => {
        if (config.patientId) {
            refresh();
        }
    }, [config.patientId]);

    // Poll for updates every 30 seconds when there are active sessions
    useEffect(() => {
        if (activeSessions.length === 0) return;

        const interval = setInterval(refresh, 30000);
        return () => clearInterval(interval);
    }, [activeSessions.length, refresh]);

    return { activeSessions, loading, error, refresh };
}

export default useBreakGlass;
