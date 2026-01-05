/**
 * Authentication Hook
 * Manages auth state, role, and secure token storage
 */

import { useState, useEffect, useCallback } from 'react';
import * as SecureStore from 'expo-secure-store';

type UserRole = 'patient' | 'clinician' | null;

interface AuthState {
    isLoading: boolean;
    isAuthenticated: boolean;
    userRole: UserRole;
    userId: string | null;
    accessToken: string | null;
}

interface UseAuthReturn extends AuthState {
    login: (token: string, role: UserRole, userId: string) => Promise<void>;
    logout: () => Promise<void>;
    refreshAuth: () => Promise<void>;
}

const AUTH_TOKEN_KEY = 'zk_guardian_auth_token';
const USER_ROLE_KEY = 'zk_guardian_user_role';
const USER_ID_KEY = 'zk_guardian_user_id';

export function useAuth(): UseAuthReturn {
    const [state, setState] = useState<AuthState>({
        isLoading: true,
        isAuthenticated: false,
        userRole: null,
        userId: null,
        accessToken: null,
    });

    // Load auth state from secure storage on mount
    useEffect(() => {
        loadAuthState();
    }, []);

    const loadAuthState = async () => {
        try {
            const [token, role, userId] = await Promise.all([
                SecureStore.getItemAsync(AUTH_TOKEN_KEY),
                SecureStore.getItemAsync(USER_ROLE_KEY),
                SecureStore.getItemAsync(USER_ID_KEY),
            ]);

            setState({
                isLoading: false,
                isAuthenticated: !!token,
                userRole: (role as UserRole) || null,
                userId: userId || null,
                accessToken: token,
            });
        } catch (error) {
            console.error('Failed to load auth state:', error);
            setState(prev => ({ ...prev, isLoading: false }));
        }
    };

    const login = useCallback(async (token: string, role: UserRole, userId: string) => {
        try {
            await Promise.all([
                SecureStore.setItemAsync(AUTH_TOKEN_KEY, token),
                SecureStore.setItemAsync(USER_ROLE_KEY, role || ''),
                SecureStore.setItemAsync(USER_ID_KEY, userId),
            ]);

            setState({
                isLoading: false,
                isAuthenticated: true,
                userRole: role,
                userId,
                accessToken: token,
            });
        } catch (error) {
            console.error('Failed to store auth state:', error);
            throw error;
        }
    }, []);

    const logout = useCallback(async () => {
        try {
            await Promise.all([
                SecureStore.deleteItemAsync(AUTH_TOKEN_KEY),
                SecureStore.deleteItemAsync(USER_ROLE_KEY),
                SecureStore.deleteItemAsync(USER_ID_KEY),
            ]);

            setState({
                isLoading: false,
                isAuthenticated: false,
                userRole: null,
                userId: null,
                accessToken: null,
            });
        } catch (error) {
            console.error('Failed to clear auth state:', error);
            throw error;
        }
    }, []);

    const refreshAuth = useCallback(async () => {
        setState(prev => ({ ...prev, isLoading: true }));
        await loadAuthState();
    }, []);

    return {
        ...state,
        login,
        logout,
        refreshAuth,
    };
}
