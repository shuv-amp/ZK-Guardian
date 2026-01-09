'use client';

/**
 * ZK Guardian React Context Provider
 * 
 * Provides SDK instance and WebSocket connection to all child components.
 */

import React, { createContext, useContext, useEffect, useState, useCallback, useMemo, ReactNode } from 'react';
import { ZKGuardianClient } from '@zk-guardian/sdk';
import type { ZKGuardianConfig, ConsentRequest } from '../types';

interface ZKGuardianContextValue {
    client: ZKGuardianClient | null;
    config: ZKGuardianConfig;
    connected: boolean;
    error: string | null;
    pendingRequests: ConsentRequest[];
    addPendingRequest: (request: ConsentRequest) => void;
    removePendingRequest: (requestId: string) => void;
}

const ZKGuardianContext = createContext<ZKGuardianContextValue | null>(null);

interface ZKGuardianProviderProps {
    config: ZKGuardianConfig;
    children: ReactNode;
}

export function ZKGuardianProvider({ config, children }: ZKGuardianProviderProps) {
    const [client, setClient] = useState<ZKGuardianClient | null>(null);
    const [connected, setConnected] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [pendingRequests, setPendingRequests] = useState<ConsentRequest[]>([]);
    const wsRef = React.useRef<WebSocket | null>(null);

    // Initialize SDK client
    useEffect(() => {
        try {
            const sdkClient = new ZKGuardianClient({
                gatewayUrl: config.gatewayUrl,
                apiKey: config.apiKey
            });
            setClient(sdkClient);
            setError(null);

            if (config.debug) {
                console.log('[ZKGuardian] SDK initialized', { gatewayUrl: config.gatewayUrl });
            }
        } catch (err: any) {
            setError(err.message);
            console.error('[ZKGuardian] SDK initialization failed:', err);
        }
    }, [config.gatewayUrl, config.apiKey, config.debug]);

    // WebSocket connection for real-time updates
    useEffect(() => {
        if (!config.patientId) return;

        const wsUrl = config.wsUrl || config.gatewayUrl.replace(/^http/, 'ws') + '/ws/consent';

        const connect = () => {
            const socket = new WebSocket(wsUrl);

            socket.onopen = () => {
                setConnected(true);
                setError(null);

                // Authenticate
                socket.send(JSON.stringify({
                    type: 'auth',
                    patientId: config.patientId
                }));

                if (config.debug) {
                    console.log('[ZKGuardian] WebSocket connected');
                }
            };

            socket.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    handleWebSocketMessage(message);
                } catch (err) {
                    console.error('[ZKGuardian] Failed to parse WebSocket message:', err);
                }
            };

            socket.onerror = (err) => {
                console.error('[ZKGuardian] WebSocket error:', err);
                setError('WebSocket connection error');
            };

            socket.onclose = () => {
                setConnected(false);
                if (config.debug) {
                    console.log('[ZKGuardian] WebSocket disconnected, reconnecting...');
                }
                // Reconnect after 3 seconds
                setTimeout(connect, 3000);
            };

            wsRef.current = socket;
        };

        connect();

        return () => {
            wsRef.current?.close();
        };
    }, [config.patientId, config.wsUrl, config.gatewayUrl, config.debug]);

    const handleWebSocketMessage = useCallback((message: any) => {
        switch (message.type) {
            case 'consent_request':
                setPendingRequests(prev => [...prev, {
                    requestId: message.requestId,
                    clinicianId: message.clinicianId,
                    clinicianName: message.clinicianName,
                    department: message.department,
                    resourceType: message.resourceType,
                    purpose: message.purpose,
                    expiresAt: new Date(message.expiresAt),
                    status: 'pending'
                }]);
                break;

            case 'consent_timeout':
                setPendingRequests(prev =>
                    prev.map(r => r.requestId === message.requestId
                        ? { ...r, status: 'expired' as const }
                        : r
                    )
                );
                break;

            case 'access_granted':
                if (config.debug) {
                    console.log('[ZKGuardian] Access granted:', message);
                }
                break;
        }
    }, [config.debug]);

    const addPendingRequest = useCallback((request: ConsentRequest) => {
        setPendingRequests(prev => [...prev, request]);
    }, []);

    const removePendingRequest = useCallback((requestId: string) => {
        setPendingRequests(prev => prev.filter(r => r.requestId !== requestId));
    }, []);

    const value = useMemo<ZKGuardianContextValue>(() => ({
        client,
        config,
        connected,
        error,
        pendingRequests,
        addPendingRequest,
        removePendingRequest
    }), [client, config, connected, error, pendingRequests, addPendingRequest, removePendingRequest]);

    return (
        <ZKGuardianContext.Provider value={value}>
            {children}
        </ZKGuardianContext.Provider>
    );
}

export function useZKGuardian(): ZKGuardianContextValue {
    const context = useContext(ZKGuardianContext);
    if (!context) {
        throw new Error('useZKGuardian must be used within a ZKGuardianProvider');
    }
    return context;
}

export default ZKGuardianProvider;
