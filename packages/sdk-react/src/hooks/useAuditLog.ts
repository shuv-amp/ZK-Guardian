'use client';

/**
 * useAuditLog Hook
 * 
 * Fetches and manages patient audit log entries with pagination.
 */

import { useState, useCallback, useEffect } from 'react';
import { useZKGuardian } from '../context/ZKGuardianProvider';
import type { AuditLogEntry, UseAuditLogReturn } from '../types';

const PAGE_SIZE = 20;

export function useAuditLog(): UseAuditLogReturn {
    const { config } = useZKGuardian();

    const [entries, setEntries] = useState<AuditLogEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [hasMore, setHasMore] = useState(true);
    const [offset, setOffset] = useState(0);

    const fetchEntries = useCallback(async (reset = false) => {
        if (!config.patientId) {
            setError('Patient ID required');
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const currentOffset = reset ? 0 : offset;
            const response = await fetch(
                `${config.gatewayUrl}/api/patient/${config.patientId}/audit?limit=${PAGE_SIZE}&offset=${currentOffset}`,
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
            const newEntries: AuditLogEntry[] = (data.entries || []).map((e: any) => ({
                id: e.id,
                clinicianId: e.clinicianId,
                clinicianName: e.clinicianName,
                department: e.department,
                resourceType: e.resourceType,
                accessEventHash: e.accessEventHash,
                txHash: e.txHash,
                isBreakGlass: e.isBreakGlass,
                purpose: e.purpose,
                verified: e.verified,
                createdAt: new Date(e.createdAt)
            }));

            if (reset) {
                setEntries(newEntries);
                setOffset(PAGE_SIZE);
            } else {
                setEntries(prev => [...prev, ...newEntries]);
                setOffset(prev => prev + PAGE_SIZE);
            }

            setHasMore(newEntries.length === PAGE_SIZE);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [config.gatewayUrl, config.patientId, config.apiKey, offset]);

    // Initial load
    useEffect(() => {
        if (config.patientId) {
            fetchEntries(true);
        }
    }, [config.patientId]);

    const loadMore = useCallback(async () => {
        if (!loading && hasMore) {
            await fetchEntries(false);
        }
    }, [loading, hasMore, fetchEntries]);

    const refresh = useCallback(async () => {
        await fetchEntries(true);
    }, [fetchEntries]);

    return { entries, loading, error, hasMore, loadMore, refresh };
}

export default useAuditLog;
