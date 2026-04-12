'use client';

/**
 * useConsentRequest Hook
 * 
 * For clinician-side apps: Request consent from a patient.
 */

import { useState, useCallback } from 'react';
import { useZKGuardian } from '../context/ZKGuardianProvider';

interface ConsentRequestState {
    status: 'idle' | 'pending' | 'approved' | 'denied' | 'timeout' | 'error';
    requestId: string | null;
    proofHash: string | null;
    error: string | null;
}

interface UseConsentRequestReturn {
    state: ConsentRequestState;
    requestAccess: (params: {
        patientId: string;
        resourceType: string;
        purpose: string;
    }) => Promise<void>;
    reset: () => void;
}

export function useConsentRequest(): UseConsentRequestReturn {
    const { config } = useZKGuardian();

    const [state, setState] = useState<ConsentRequestState>({
        status: 'idle',
        requestId: null,
        proofHash: null,
        error: null
    });

    const requestAccess = useCallback(async (params: {
        patientId: string;
        resourceType: string;
        purpose: string;
    }) => {
        setState({
            status: 'pending',
            requestId: null,
            proofHash: null,
            error: null
        });

        try {
            const response = await fetch(
                `${config.gatewayUrl}/api/clinician/request-access`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {})
                    },
                    body: JSON.stringify(params)
                }
            );

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Request failed');
            }

            // Wait for WebSocket response or poll for result
            setState(prev => ({
                ...prev,
                requestId: data.requestId
            }));

            // Poll for result
            const result = await pollForResult(data.requestId, config.gatewayUrl, config.apiKey);

            if (result.status === 'approved') {
                setState({
                    status: 'approved',
                    requestId: data.requestId,
                    proofHash: result.proofHash ?? null,
                    error: null
                });
            } else if (result.status === 'denied') {
                setState({
                    status: 'denied',
                    requestId: data.requestId,
                    proofHash: null,
                    error: result.reason || 'Patient denied access'
                });
            } else {
                setState({
                    status: 'timeout',
                    requestId: data.requestId,
                    proofHash: null,
                    error: 'Consent request timed out'
                });
            }
        } catch (err: any) {
            setState({
                status: 'error',
                requestId: null,
                proofHash: null,
                error: err.message
            });
        }
    }, [config.gatewayUrl, config.apiKey]);

    const reset = useCallback(() => {
        setState({
            status: 'idle',
            requestId: null,
            proofHash: null,
            error: null
        });
    }, []);

    return { state, requestAccess, reset };
}

async function pollForResult(
    requestId: string,
    gatewayUrl: string,
    apiKey?: string
): Promise<{ status: string; proofHash?: string; reason?: string }> {
    const maxAttempts = 60; // 60 seconds
    const pollInterval = 1000; // 1 second

    for (let i = 0; i < maxAttempts; i++) {
        await new Promise(resolve => setTimeout(resolve, pollInterval));

        try {
            const response = await fetch(
                `${gatewayUrl}/api/clinician/consent-status/${requestId}`,
                {
                    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
                }
            );

            if (!response.ok) continue;

            const data = await response.json();

            if (data.status !== 'pending') {
                return data;
            }
        } catch {
            // Continue polling
        }
    }

    return { status: 'timeout' };
}

export default useConsentRequest;
