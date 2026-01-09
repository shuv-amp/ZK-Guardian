/**
 * Enhanced Biometric Authentication Utility
 * 
 * Secure biometric authentication for sensitive operations.
 * Required by SECURITY_AUDIT_CHECKLIST MS3 and CF1.
 * 
 * Features:
 * - Biometric auth with fallback to device PIN
 * - Session timeout (re-auth after inactivity)
 * - Audit logging for security events
 */

import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { Platform, AppState, AppStateStatus } from 'react-native';

// Constants
const AUTH_SESSION_KEY = 'biometric_session';
const AUTH_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const MAX_ATTEMPTS = 3;

// Types
export interface BiometricAuthResult {
    success: boolean;
    method: 'biometric' | 'pin' | 'none';
    timestamp: number;
    error?: string;
}

interface AuthSession {
    authenticatedAt: number;
    method: 'biometric' | 'pin';
    expiresAt: number;
}

// State
let currentSession: AuthSession | null = null;
let failedAttempts = 0;
let appStateSubscription: any = null;

/**
 * Check if biometrics are available on this device
 */
export async function checkBiometricAvailability(): Promise<{
    available: boolean;
    type: LocalAuthentication.AuthenticationType[];
    enrolled: boolean;
}> {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const isEnrolled = await LocalAuthentication.isEnrolledAsync();
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();

    return {
        available: hasHardware,
        type: types,
        enrolled: isEnrolled
    };
}

/**
 * Authenticate user with biometrics or device PIN
 * 
 * Required for:
 * - Consent approvals (CF1)
 * - Nullifier access
 * - Wallet signing operations
 */
export async function authenticateWithBiometrics(options: {
    message: string;
    cancelLabel?: string;
    fallbackLabel?: string;
    disableDeviceFallback?: boolean;
}): Promise<BiometricAuthResult> {
    const now = Date.now();

    // Check for too many failed attempts
    if (failedAttempts >= MAX_ATTEMPTS) {
        return {
            success: false,
            method: 'none',
            timestamp: now,
            error: 'Too many failed attempts. Please try again later.'
        };
    }

    // Check if we have a valid session
    if (currentSession && currentSession.expiresAt > now) {
        return {
            success: true,
            method: currentSession.method,
            timestamp: currentSession.authenticatedAt
        };
    }

    try {
        const result = await LocalAuthentication.authenticateAsync({
            promptMessage: options.message,
            cancelLabel: options.cancelLabel || 'Cancel',
            fallbackLabel: options.fallbackLabel || 'Use PIN',
            disableDeviceFallback: options.disableDeviceFallback || false
        });

        if (result.success) {
            // Reset failed attempts
            failedAttempts = 0;

            // Create session
            currentSession = {
                authenticatedAt: now,
                method: 'biometric',
                expiresAt: now + AUTH_TIMEOUT_MS
            };

            // Store session info securely
            await SecureStore.setItemAsync(AUTH_SESSION_KEY, JSON.stringify(currentSession));

            return {
                success: true,
                method: 'biometric',
                timestamp: now
            };
        } else {
            failedAttempts++;
            // When success is false, the result has a 'warning' or no additional info
            return {
                success: false,
                method: 'none',
                timestamp: now,
                error: 'warning' in result ? String((result as any).warning) : 'Authentication failed'
            };
        }
    } catch (error: any) {
        failedAttempts++;
        return {
            success: false,
            method: 'none',
            timestamp: now,
            error: error.message || 'Biometric authentication error'
        };
    }
}

/**
 * Require biometric auth for sensitive operations
 * 
 * Wrapper that ensures biometric auth before proceeding
 */
export async function requireBiometricAuth<T>(
    operation: () => Promise<T>,
    authMessage: string = 'Authenticate to continue'
): Promise<T> {
    const result = await authenticateWithBiometrics({ message: authMessage });

    if (!result.success) {
        throw new BiometricAuthRequiredError(result.error || 'Authentication required');
    }

    return operation();
}

/**
 * Check if current session is valid
 */
export function isSessionValid(): boolean {
    if (!currentSession) return false;
    return currentSession.expiresAt > Date.now();
}

/**
 * Extend current session if valid
 */
export function extendSession(): void {
    if (currentSession && isSessionValid()) {
        currentSession.expiresAt = Date.now() + AUTH_TIMEOUT_MS;
    }
}

/**
 * Invalidate current session (e.g., on logout)
 */
export async function invalidateSession(): Promise<void> {
    currentSession = null;
    await SecureStore.deleteItemAsync(AUTH_SESSION_KEY);
}

/**
 * Get time until session expires
 */
export function getSessionTimeRemaining(): number | null {
    if (!currentSession || !isSessionValid()) return null;
    return Math.max(0, currentSession.expiresAt - Date.now());
}

/**
 * Initialize session monitoring
 * 
 * Invalidates session when app goes to background
 */
export function initSessionMonitoring(): void {
    if (appStateSubscription) return;

    appStateSubscription = AppState.addEventListener(
        'change',
        (nextState: AppStateStatus) => {
            if (nextState === 'background' || nextState === 'inactive') {
                // Clear session when app goes to background
                currentSession = null;
                console.log('[BiometricAuth] Session cleared - app backgrounded');
            }
        }
    );
}

/**
 * Cleanup session monitoring
 */
export function cleanupSessionMonitoring(): void {
    if (appStateSubscription) {
        appStateSubscription.remove();
        appStateSubscription = null;
    }
}

/**
 * Load any persisted session (for app resume)
 */
export async function loadPersistedSession(): Promise<boolean> {
    try {
        const sessionData = await SecureStore.getItemAsync(AUTH_SESSION_KEY);
        if (sessionData) {
            const session = JSON.parse(sessionData) as AuthSession;
            if (session.expiresAt > Date.now()) {
                currentSession = session;
                return true;
            }
        }
    } catch (error) {
        console.warn('[BiometricAuth] Failed to load persisted session:', error);
    }
    return false;
}

/**
 * Custom error for biometric auth requirements
 */
export class BiometricAuthRequiredError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'BiometricAuthRequiredError';
    }
}

export default {
    checkBiometricAvailability,
    authenticateWithBiometrics,
    requireBiometricAuth,
    isSessionValid,
    extendSession,
    invalidateSession,
    getSessionTimeRemaining,
    initSessionMonitoring,
    cleanupSessionMonitoring,
    loadPersistedSession,
    BiometricAuthRequiredError
};
