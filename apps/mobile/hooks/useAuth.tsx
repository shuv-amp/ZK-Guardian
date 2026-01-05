import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { smartAuth, SMARTAuthService } from '../services/SMARTAuthService';
import { consentClient, ConsentHandshakeClient } from '../services/ConsentHandshakeClient';

interface AuthContextType {
    isAuthenticated: boolean;
    isLoading: boolean;
    patientId: string | null;
    practitionerId: string | null;
    login: () => Promise<boolean>;
    logout: () => Promise<void>;
    connectionState: 'disconnected' | 'connecting' | 'connected' | 'error';
}

const AuthContext = createContext<AuthContextType | null>(null);

interface AuthProviderProps {
    children: ReactNode;
}

/**
 * AuthProvider
 * 
 * Provides authentication state and methods to the app.
 * Automatically connects to WebSocket after successful login.
 */
export function AuthProvider({ children }: AuthProviderProps) {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [patientId, setPatientId] = useState<string | null>(null);
    const [practitionerId, setPractitionerId] = useState<string | null>(null);
    const [connectionState, setConnectionState] = useState<AuthContextType['connectionState']>('disconnected');

    // Initialize auth on mount
    useEffect(() => {
        const init = async () => {
            const hasTokens = await smartAuth.initialize();
            if (hasTokens) {
                setIsAuthenticated(true);
                setPatientId(smartAuth.getPatientId());
                setPractitionerId(smartAuth.getPractitionerId());

                // Connect to WebSocket if patient
                const pid = smartAuth.getPatientId();
                if (pid) {
                    consentClient.connect(pid);
                }
            }
            setIsLoading(false);
        };

        init();

        // Listen to connection state changes
        consentClient.onStateChange(setConnectionState);

        return () => {
            consentClient.disconnect();
        };
    }, []);

    const login = async (): Promise<boolean> => {
        setIsLoading(true);
        const success = await smartAuth.login();

        if (success) {
            setIsAuthenticated(true);
            const pid = smartAuth.getPatientId();
            const pracId = smartAuth.getPractitionerId();
            setPatientId(pid);
            setPractitionerId(pracId);

            // Connect WebSocket for patients
            if (pid) {
                consentClient.connect(pid);
            }
        }

        setIsLoading(false);
        return success;
    };

    const logout = async (): Promise<void> => {
        consentClient.disconnect();
        await smartAuth.logout();
        setIsAuthenticated(false);
        setPatientId(null);
        setPractitionerId(null);
    };

    return (
        <AuthContext.Provider
            value={{
                isAuthenticated,
                isLoading,
                patientId,
                practitionerId,
                login,
                logout,
                connectionState,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
}

/**
 * Hook to access auth context.
 * Must be used within an AuthProvider.
 */
export function useAuth(): AuthContextType {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}
