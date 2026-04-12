import { useState, useEffect, useCallback, useRef } from 'react';
import { consentClient } from '../services/ConsentHandshakeClient';
import { fhirClient, FHIRConsent } from '../services/fhirClient';
import { smartAuth } from '../services/SMARTAuthService';

/**
 * useConsent Hook
 * 
 * React hook for WebSocket consent flow integration.
 * 
 * IMPORTANT: connect/disconnect functions are stable (don't change between renders)
 * to prevent useEffect dependency issues in consumers.
 */

export interface ConsentRequest {
    type: 'CONSENT_REQUEST';
    requestId: string;
    details: {
        practitioner: string;
        resourceType: string;
        resourceId: string;
    };
    timestamp: number;
    clinicianName?: string;
    facility?: string;
    resourceTypes?: string[];
    purpose?: string;
    duration?: string;
}

export interface UseConsentState {
    isConnected: boolean;
    isConnecting: boolean;
    connectionState: 'disconnected' | 'connecting' | 'connected' | 'error';
    connectionError: string | null;
    activeConsents: FHIRConsent[];
    pendingRequests: ConsentRequest[];
    isLoadingConsents: boolean;
    connect: () => void;
    disconnect: () => void;
    approveRequest: (requestId: string, biometricVerified?: boolean) => Promise<boolean>;
    denyRequest: (requestId: string, reason?: string) => Promise<boolean>;
    refreshConsents: () => Promise<void>;
}

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

export function useConsent(): UseConsentState {
    // Connection state
    const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
    const [connectionError, setConnectionError] = useState<string | null>(null);

    // Consent data
    const [activeConsents, setActiveConsents] = useState<FHIRConsent[]>([]);
    const [pendingRequests, setPendingRequests] = useState<ConsentRequest[]>([]);
    const [isLoadingConsents, setIsLoadingConsents] = useState(false);

    // Refs to prevent multiple connections and track state
    const isConnectedRef = useRef(false);
    const isConnectingRef = useRef(false);
    const hasLoadedConsentsRef = useRef(false);

    // Derived state
    const isConnected = connectionState === 'connected';
    const isConnecting = connectionState === 'connecting';

    /**
     * Handle incoming consent request
     */
    const handleConsentRequest = useCallback((request: ConsentRequest) => {
        console.log('[useConsent] Received consent request:', request.requestId);
        setPendingRequests(prev => {
            if (prev.find(r => r.requestId === request.requestId)) {
                return prev;
            }
            return [...prev, request];
        });
    }, []);

    /**
     * Handle connection state changes
     */
    const handleStateChange = useCallback((state: ConnectionState) => {
        setConnectionState(state);
        isConnectedRef.current = state === 'connected';
        isConnectingRef.current = state === 'connecting';

        if (state === 'error') {
            setConnectionError('Connection failed');
        } else {
            setConnectionError(null);
        }
    }, []);

    const onRequestUnsubRef = useRef<null | (() => void)>(null);
    const onStateUnsubRef = useRef<null | (() => void)>(null);

    useEffect(() => {
        onRequestUnsubRef.current = consentClient.onConsentRequest(handleConsentRequest);
        onStateUnsubRef.current = consentClient.onStateChange(handleStateChange);

        return () => {
            onRequestUnsubRef.current?.();
            onStateUnsubRef.current?.();
        };
    }, [handleConsentRequest, handleStateChange]);

    // Ref to track if loading is in progress (for stable callback)
    const isLoadingRef = useRef(false);

    /**
     * Refresh active consents from FHIR server
     * Only runs once per mount to prevent rate limiting
     * STABLE function - uses refs instead of state for dependencies
     */
    const refreshConsents = useCallback(async () => {
        // Prevent multiple concurrent loads using refs for stability
        if (isLoadingRef.current || hasLoadedConsentsRef.current) {
            return;
        }

        isLoadingRef.current = true;
        setIsLoadingConsents(true);

        try {
            const patientId = await smartAuth.getPatientId();
            if (!patientId) {
                return;
            }

            const consents = await fhirClient.getPatientConsents(patientId);
            setActiveConsents(consents);
            hasLoadedConsentsRef.current = true;

        } catch (error) {
            console.error('[useConsent] Failed to load consents:', error);
        } finally {
            isLoadingRef.current = false;
            setIsLoadingConsents(false);
        }
    }, []); // Empty deps - function is now stable

    /**
     * Connect to WebSocket - STABLE function (uses refs, not state)
     */
    const connect = useCallback(() => {
        // Use refs to check state to keep this function stable
        if (isConnectingRef.current || isConnectedRef.current) {
            console.log('[useConsent] Already connected/connecting, skipping');
            return;
        }

        isConnectingRef.current = true;
        setConnectionError(null);

        const doConnect = async () => {
            try {
                const patientId = await smartAuth.getPatientId();
                if (!patientId) {
                    throw new Error('No patient ID available');
                }

                // Connect
                consentClient.connect(patientId);
                console.log('[useConsent] Connection initiated');

                // Load initial consents (only once)
                if (!hasLoadedConsentsRef.current) {
                    await refreshConsents();
                }

            } catch (error: any) {
                console.error('[useConsent] Connection failed:', error);
                setConnectionError(error.message || 'Connection failed');
                isConnectingRef.current = false;
            }
        };

        doConnect();
    }, [handleConsentRequest, handleStateChange, refreshConsents]);

    /**
     * Disconnect from WebSocket - STABLE function
     */
    const disconnect = useCallback(() => {
        if (!isConnectedRef.current && !isConnectingRef.current) {
            return;
        }

        consentClient.disconnect();
        setConnectionState('disconnected');
        isConnectedRef.current = false;
        isConnectingRef.current = false;
    }, []);

    /**
     * Approve a consent request
     */
    const approveRequest = useCallback(async (
        requestId: string,
        biometricVerified = false
    ): Promise<boolean> => {
        const request = pendingRequests.find(r => r.requestId === requestId);
        if (!request) {
            return false;
        }

        try {
            if (!biometricVerified) {
                const authResult = await consentClient.authenticateForConsent();
                if (!authResult) {
                    console.log('[useConsent] Biometric authentication failed');
                    return false;
                }
            }

            await consentClient.sendResponse(requestId, true);
            setPendingRequests(prev => prev.filter(r => r.requestId !== requestId));

            // Refresh consents after a delay using a ref to track the timeout
            hasLoadedConsentsRef.current = false;
            // Note: The timeout is acceptable here since refreshConsents is stable
            // and the component cleanup will prevent stale updates
            const timeoutId = setTimeout(() => refreshConsents(), 1000);
            
            // Store timeout for potential cleanup if needed
            return true;
        } catch (error) {
            console.error('[useConsent] Approve failed:', error);
            return false;
        }
    }, [pendingRequests, refreshConsents]);

    /**
     * Deny a consent request
     */
    const denyRequest = useCallback(async (
        requestId: string,
        _reason?: string
    ): Promise<boolean> => {
        try {
            await consentClient.sendResponse(requestId, false);
            setPendingRequests(prev => prev.filter(r => r.requestId !== requestId));
            return true;
        } catch (error) {
            console.error('[useConsent] Deny failed:', error);
            return false;
        }
    }, []);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            disconnect();
        };
    }, [disconnect]);

    return {
        isConnected,
        isConnecting,
        connectionState,
        connectionError,
        activeConsents,
        pendingRequests,
        isLoadingConsents,
        connect,
        disconnect,
        approveRequest,
        denyRequest,
        refreshConsents
    };
}

export default useConsent;
