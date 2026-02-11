import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './useAuth';
import { useConsent, ConsentRequest } from './useConsent';
import { ConsentApprovalModal } from '../components/patient/ConsentApprovalModal';

type ConsentContextValue = {
    pendingRequests: ConsentRequest[];
    connectionState: 'disconnected' | 'connecting' | 'connected' | 'error';
    openConsentRequest: (requestId: string) => void;
    approveRequest: (requestId: string, biometricVerified?: boolean) => Promise<boolean>;
    denyRequest: (requestId: string, reason?: string) => Promise<boolean>;
};

const ConsentContext = createContext<ConsentContextValue | null>(null);

interface ConsentProviderProps {
    children: React.ReactNode;
}

export function ConsentProvider({ children }: ConsentProviderProps) {
    const { patientId, isAuthenticated } = useAuth();
    const { pendingRequests, approveRequest, denyRequest, connect, connectionState } = useConsent();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
    const seenRequestIdsRef = useRef<Set<string>>(new Set());

    useEffect(() => {
        if (isAuthenticated && patientId) {
            connect();
        }
    }, [isAuthenticated, patientId, connect]);

    useEffect(() => {
        if (!pendingRequests.length) {
            setIsModalOpen(false);
            setSelectedRequestId(null);
            seenRequestIdsRef.current.clear();
            return;
        }

        const nextRequest = pendingRequests.find(request => !seenRequestIdsRef.current.has(request.requestId));
        if (nextRequest && !isModalOpen) {
            seenRequestIdsRef.current.add(nextRequest.requestId);
            setSelectedRequestId(nextRequest.requestId);
            setIsModalOpen(true);
        }
    }, [pendingRequests, isModalOpen]);

    const activeRequest = useMemo(() => {
        if (!pendingRequests.length) return null;
        if (selectedRequestId) {
            return pendingRequests.find(r => r.requestId === selectedRequestId) || pendingRequests[0];
        }
        return pendingRequests[0];
    }, [pendingRequests, selectedRequestId]);

    const openConsentRequest = (requestId: string) => {
        setSelectedRequestId(requestId);
        setIsModalOpen(true);
    };

    return (
        <ConsentContext.Provider
            value={{
                pendingRequests,
                connectionState,
                openConsentRequest,
                approveRequest,
                denyRequest,
            }}
        >
            {children}
            {patientId ? (
                <ConsentApprovalModal
                    visible={isModalOpen}
                    request={activeRequest}
                    onApprove={approveRequest}
                    onDeny={denyRequest}
                    onClose={() => {
                        setIsModalOpen(false);
                        setSelectedRequestId(null);
                    }}
                />
            ) : null}
        </ConsentContext.Provider>
    );
}

export function useConsentContext(): ConsentContextValue {
    const context = useContext(ConsentContext);
    if (!context) {
        throw new Error('useConsentContext must be used within a ConsentProvider');
    }
    return context;
}
