import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { smartAuth } from '../services/SMARTAuthService';
import type { AuthRole } from '../services/SMARTAuthService';
import { consentClient } from '../services/ConsentHandshakeClient';

export interface AuthContextType {
    isAuthenticated: boolean;
    isLoading: boolean;
    patientId: string | null;
    practitionerId: string | null;
    accessToken: string | null;
    login: (role?: AuthRole) => Promise<boolean>;
    logout: () => Promise<void>;
    connectionState: 'disconnected' | 'connecting' | 'connected' | 'error';
    getAccessToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextType | null>(null);

interface AuthProviderProps {
    children: ReactNode;
}

/**
 * AuthProvider
 * 
 * Provides authentication state and methods to the app.
 * Handles session restoration on app startup and WebSocket connection
 * for real-time consent requests.
 */
export function AuthProvider({ children }: AuthProviderProps) {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [patientId, setPatientId] = useState<string | null>(null);
    const [practitionerId, setPractitionerId] = useState<string | null>(null);
    const [accessToken, setAccessToken] = useState<string | null>(null);
    const [connectionState, setConnectionState] = useState<AuthContextType['connectionState']>('disconnected');

    // Track if WebSocket is connected to prevent duplicate connections
    const wsConnectedRef = useRef(false);

    // Initialize auth on mount - restore existing session if available
    useEffect(() => {
        const init = async () => {
            try {
                const hasTokens = await smartAuth.initialize();

                if (hasTokens) {
                    // Restore session from stored tokens
                    setIsAuthenticated(true);
                    setPatientId(smartAuth.getPatientId());
                    setPractitionerId(smartAuth.getPractitionerId());

                    // Get current access token
                    const token = await smartAuth.getAccessToken();
                    setAccessToken(token);

                    console.log('[Auth] Session restored successfully');
                } else {
                    console.log('[Auth] No existing session found');
                }
            } catch (error) {
                console.error('[Auth] Failed to initialize:', error);
            } finally {
                setIsLoading(false);
            }
        };

        init();

        // Cleanup on unmount
        return () => {
            if (wsConnectedRef.current) {
                consentClient.disconnect();
                wsConnectedRef.current = false;
            }
        };
    }, []);

    // Track consent connection state for patient users
    // Connection lifecycle is managed by the ConsentProvider
    useEffect(() => {
        if (isLoading || !isAuthenticated || !patientId) {
            return;
        }

        const unsubscribe = consentClient.onStateChange((state) => {
            setConnectionState(state);
            wsConnectedRef.current = state === 'connected' || state === 'connecting';
        });

        return () => {
            unsubscribe();
        };
    }, [isLoading, isAuthenticated, patientId]);

    const login = async (role: AuthRole = 'patient'): Promise<boolean> => {
        setIsLoading(true);

        try {
            const success = await smartAuth.login(role);

            if (success) {
                setIsAuthenticated(true);
                const pid = smartAuth.getPatientId();
                const pracId = smartAuth.getPractitionerId();
                setPatientId(pid);
                setPractitionerId(pracId);

                // Get access token
                const token = await smartAuth.getAccessToken();
                setAccessToken(token);

                console.log('[Auth] Login successful', { patientId: pid, practitionerId: pracId });

                // Connect WebSocket for patients
                if (pid && !wsConnectedRef.current) {
                    wsConnectedRef.current = true;
                    consentClient.connect(pid);
                }
            }

            return success;
        } catch (error) {
            console.error('[Auth] Login failed:', error);
            return false;
        } finally {
            setIsLoading(false);
        }
    };

    const logout = async (): Promise<void> => {
        try {
            // Disconnect WebSocket first
            if (wsConnectedRef.current) {
                consentClient.disconnect();
                wsConnectedRef.current = false;
            }

            // Clear auth tokens
            await smartAuth.logout();

            // Reset state
            setIsAuthenticated(false);
            setPatientId(null);
            setPractitionerId(null);
            setAccessToken(null);
            setConnectionState('disconnected');

            console.log('[Auth] Logout successful');
        } catch (error) {
            console.error('[Auth] Logout failed:', error);
        }
    };

    const getAccessToken = async (): Promise<string | null> => {
        try {
            const token = await smartAuth.getAccessToken();
            setAccessToken(token);
            return token;
        } catch (error) {
            console.error('[Auth] Failed to get access token:', error);
            return null;
        }
    };

    return (
        <AuthContext.Provider
            value={{
                isAuthenticated,
                isLoading,
                patientId,
                practitionerId,
                accessToken,
                login,
                logout,
                connectionState,
                getAccessToken,
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
