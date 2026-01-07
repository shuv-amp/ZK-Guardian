import React, { useState, useCallback, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    Modal,
    TouchableOpacity,
    ActivityIndicator,
    Animated,
    Platform
} from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { Ionicons } from '@expo/vector-icons';

/**
 * BiometricPrompt Component
 * 
 * Secure consent approval using device biometrics.
 * Per Development Guide §1.
 * 
 * Features:
 * - Face ID / Touch ID / Fingerprint
 * - Fallback to device passcode
 * - Animated feedback
 * - Accessibility support
 */

export interface BiometricPromptProps {
    visible: boolean;
    title?: string;
    description?: string;
    onSuccess: () => void;
    onCancel: () => void;
    onFallback?: () => void;
    requireConfirmation?: boolean;
}

export type BiometricType = 'fingerprint' | 'faceId' | 'iris' | 'none';

export function BiometricPrompt({
    visible,
    title = 'Verify Identity',
    description = 'Use biometrics to approve this action',
    onSuccess,
    onCancel,
    onFallback,
    requireConfirmation = false
}: BiometricPromptProps) {
    const [isAuthenticating, setIsAuthenticating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [biometricType, setBiometricType] = useState<BiometricType>('none');
    const [canUseBiometrics, setCanUseBiometrics] = useState(false);

    const pulseAnim = new Animated.Value(1);

    // Check biometric availability
    useEffect(() => {
        checkBiometricAvailability();
    }, []);

    // Start authentication when modal opens
    useEffect(() => {
        if (visible && canUseBiometrics) {
            authenticate();
        }
    }, [visible, canUseBiometrics]);

    // Pulse animation
    useEffect(() => {
        if (isAuthenticating) {
            Animated.loop(
                Animated.sequence([
                    Animated.timing(pulseAnim, {
                        toValue: 1.2,
                        duration: 800,
                        useNativeDriver: true
                    }),
                    Animated.timing(pulseAnim, {
                        toValue: 1,
                        duration: 800,
                        useNativeDriver: true
                    })
                ])
            ).start();
        } else {
            pulseAnim.setValue(1);
        }
    }, [isAuthenticating]);

    const checkBiometricAvailability = async () => {
        try {
            const hasHardware = await LocalAuthentication.hasHardwareAsync();
            const isEnrolled = await LocalAuthentication.isEnrolledAsync();
            const supportedTypes = await LocalAuthentication.supportedAuthenticationTypesAsync();

            setCanUseBiometrics(hasHardware && isEnrolled);

            // Determine biometric type
            if (supportedTypes.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
                setBiometricType('faceId');
            } else if (supportedTypes.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
                setBiometricType('fingerprint');
            } else if (supportedTypes.includes(LocalAuthentication.AuthenticationType.IRIS)) {
                setBiometricType('iris');
            } else {
                setBiometricType('none');
            }
        } catch (error) {
            console.error('[BiometricPrompt] Availability check failed:', error);
            setCanUseBiometrics(false);
        }
    };

    const authenticate = useCallback(async () => {
        if (isAuthenticating) return;

        setIsAuthenticating(true);
        setError(null);

        try {
            const result = await LocalAuthentication.authenticateAsync({
                promptMessage: title,
                cancelLabel: 'Cancel',
                fallbackLabel: 'Use Passcode',
                disableDeviceFallback: false,
                requireConfirmation
            });

            if (result.success) {
                console.log('[BiometricPrompt] Authentication successful');
                onSuccess();
            } else {
                // result.success is false, so we can access error
                const errorCode = 'error' in result ? result.error : undefined;

                if (errorCode === 'user_cancel') {
                    console.log('[BiometricPrompt] User cancelled');
                    onCancel();
                } else if (errorCode === 'user_fallback') {
                    console.log('[BiometricPrompt] User requested fallback');
                    if (onFallback) {
                        onFallback();
                    } else {
                        // Try passcode
                        await authenticateWithPasscode();
                    }
                } else {
                    setError(getErrorMessage(errorCode));
                }
            }
        } catch (error: any) {
            console.error('[BiometricPrompt] Authentication error:', error);
            setError('Authentication failed. Please try again.');
        } finally {
            setIsAuthenticating(false);
        }
    }, [isAuthenticating, title, onSuccess, onCancel, onFallback, requireConfirmation]);

    const authenticateWithPasscode = async () => {
        // This is handled by the OS when disableDeviceFallback is false
        // This function is for custom fallback handling if needed
        console.log('[BiometricPrompt] Attempting passcode authentication');
    };

    const getErrorMessage = (error: string | undefined): string => {
        switch (error) {
            case 'lockout':
                return 'Too many attempts. Please try again later.';
            case 'lockout_permanent':
                return 'Biometrics are disabled. Please use your device passcode to enable.';
            case 'not_enrolled':
                return 'No biometrics enrolled. Please set up in device settings.';
            case 'passcode_not_set':
                return 'Device passcode not set. Please set up in device settings.';
            case 'system_cancel':
                return 'Authentication was cancelled by the system.';
            default:
                return 'Authentication failed. Please try again.';
        }
    };

    const getBiometricIcon = (): keyof typeof Ionicons.glyphMap => {
        switch (biometricType) {
            case 'faceId':
                return Platform.OS === 'ios' ? 'scan-outline' : 'happy-outline';
            case 'fingerprint':
                return 'finger-print-outline';
            case 'iris':
                return 'eye-outline';
            default:
                return 'lock-closed-outline';
        }
    };

    const getBiometricLabel = (): string => {
        switch (biometricType) {
            case 'faceId':
                return Platform.OS === 'ios' ? 'Face ID' : 'Face Recognition';
            case 'fingerprint':
                return Platform.OS === 'ios' ? 'Touch ID' : 'Fingerprint';
            case 'iris':
                return 'Iris Scan';
            default:
                return 'Passcode';
        }
    };

    if (!visible) return null;

    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={onCancel}
            accessibilityViewIsModal
        >
            <View style={styles.overlay}>
                <View style={styles.container}>
                    {/* Header */}
                    <View style={styles.header}>
                        <Text style={styles.title}>{title}</Text>
                        <Text style={styles.description}>{description}</Text>
                    </View>

                    {/* Biometric Icon */}
                    <Animated.View
                        style={[
                            styles.iconContainer,
                            { transform: [{ scale: pulseAnim }] }
                        ]}
                    >
                        {isAuthenticating ? (
                            <ActivityIndicator size="large" color="#007AFF" />
                        ) : (
                            <Ionicons
                                name={getBiometricIcon()}
                                size={64}
                                color={error ? '#FF3B30' : '#007AFF'}
                            />
                        )}
                    </Animated.View>

                    {/* Status */}
                    <View style={styles.statusContainer}>
                        {error ? (
                            <Text style={styles.errorText}>{error}</Text>
                        ) : isAuthenticating ? (
                            <Text style={styles.statusText}>
                                Waiting for {getBiometricLabel()}...
                            </Text>
                        ) : canUseBiometrics ? (
                            <Text style={styles.statusText}>
                                Tap to use {getBiometricLabel()}
                            </Text>
                        ) : (
                            <Text style={styles.statusText}>
                                Biometrics not available
                            </Text>
                        )}
                    </View>

                    {/* Actions */}
                    <View style={styles.actions}>
                        {!isAuthenticating && error && (
                            <TouchableOpacity
                                style={styles.retryButton}
                                onPress={authenticate}
                                accessibilityLabel="Try again"
                                accessibilityRole="button"
                            >
                                <Ionicons name="refresh-outline" size={20} color="#FFF" />
                                <Text style={styles.retryButtonText}>Try Again</Text>
                            </TouchableOpacity>
                        )}

                        {!isAuthenticating && !canUseBiometrics && onFallback && (
                            <TouchableOpacity
                                style={styles.fallbackButton}
                                onPress={onFallback}
                                accessibilityLabel="Use alternative method"
                                accessibilityRole="button"
                            >
                                <Text style={styles.fallbackButtonText}>
                                    Use Alternative Method
                                </Text>
                            </TouchableOpacity>
                        )}

                        <TouchableOpacity
                            style={styles.cancelButton}
                            onPress={onCancel}
                            accessibilityLabel="Cancel"
                            accessibilityRole="button"
                        >
                            <Text style={styles.cancelButtonText}>Cancel</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24
    },
    container: {
        backgroundColor: '#FFF',
        borderRadius: 20,
        padding: 24,
        width: '100%',
        maxWidth: 340,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 12,
        elevation: 8
    },
    header: {
        alignItems: 'center',
        marginBottom: 24
    },
    title: {
        fontSize: 20,
        fontWeight: '600',
        color: '#1A1A1A',
        marginBottom: 8,
        textAlign: 'center'
    },
    description: {
        fontSize: 14,
        color: '#666',
        textAlign: 'center',
        lineHeight: 20
    },
    iconContainer: {
        width: 100,
        height: 100,
        borderRadius: 50,
        backgroundColor: '#F0F7FF',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 24
    },
    statusContainer: {
        minHeight: 40,
        justifyContent: 'center',
        marginBottom: 24
    },
    statusText: {
        fontSize: 14,
        color: '#666',
        textAlign: 'center'
    },
    errorText: {
        fontSize: 14,
        color: '#FF3B30',
        textAlign: 'center'
    },
    actions: {
        width: '100%',
        gap: 12
    },
    retryButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#007AFF',
        paddingVertical: 14,
        paddingHorizontal: 24,
        borderRadius: 12,
        gap: 8
    },
    retryButtonText: {
        color: '#FFF',
        fontSize: 16,
        fontWeight: '600'
    },
    fallbackButton: {
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#F0F0F0',
        paddingVertical: 14,
        paddingHorizontal: 24,
        borderRadius: 12
    },
    fallbackButtonText: {
        color: '#007AFF',
        fontSize: 16,
        fontWeight: '500'
    },
    cancelButton: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 14
    },
    cancelButtonText: {
        color: '#666',
        fontSize: 16
    }
});

export default BiometricPrompt;
