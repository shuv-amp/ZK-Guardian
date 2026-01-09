/**
 * Login Screen
 * Pick a role, tap the button, get redirected. Simple.
 */

import { useState } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    SafeAreaView,
    ActivityIndicator,
    StatusBar
} from 'react-native';
import { useAuth } from '../../hooks/useAuth';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, SHADOWS, SPACING, RADIUS } from '../../constants/Theme';

WebBrowser.maybeCompleteAuthSession();

type UserRole = 'patient' | 'clinician';

export default function LoginScreen() {
    const { login, patientId, practitionerId } = useAuth();
    const router = useRouter();
    const [selectedRole, setSelectedRole] = useState<UserRole>('patient');
    const [loading, setLoading] = useState(false);

    const handleLogin = async () => {
        if (loading) return;
        setLoading(true);

        try {
            // Kick off the SMART Auth flow.
            // This will open the browser modal.
            const success = await login();

            if (success) {
                // Navigate based on role after successful login
                // Small delay to ensure auth state is fully updated
                setTimeout(() => {
                    if (selectedRole === 'patient') {
                        router.replace('/(patient)/dashboard');
                    } else {
                        router.replace('/(clinician)/dashboard');
                    }
                }, 200);
            } else {
                // Stay on login screen if failed
                console.log('[LoginScreen] Login failed or cancelled');
            }
        } catch (error) {
            console.error('[LoginScreen] Error during login:', error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <SafeAreaView style={styles.container}>
            <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />
            <View style={styles.content}>
                {/* Header */}
                <View style={styles.header}>
                    <View style={styles.iconContainer}>
                        <Ionicons name="shield-checkmark" size={48} color={COLORS.primary} />
                    </View>
                    <Text style={styles.title}>ZK Guardian</Text>
                    <Text style={styles.subtitle}>Privacy-Preserving Healthcare</Text>
                </View>

                {/* Role Selection */}
                <View style={styles.roleContainer}>
                    <Text style={styles.roleLabel}>Select your role</Text>

                    <View style={styles.roleButtons}>
                        <TouchableOpacity
                            style={[
                                styles.roleButton,
                                selectedRole === 'patient' && styles.roleButtonActive,
                            ]}
                            onPress={() => setSelectedRole('patient')}
                            disabled={loading}
                            activeOpacity={0.7}
                        >
                            <View style={[
                                styles.roleIconContainer,
                                selectedRole === 'patient' && styles.roleIconContainerActive
                            ]}>
                                <Ionicons
                                    name="person"
                                    size={24}
                                    color={selectedRole === 'patient' ? COLORS.primary : COLORS.textSecondary}
                                />
                            </View>
                            <Text style={[
                                styles.roleText,
                                selectedRole === 'patient' && styles.roleTextActive,
                            ]}>
                                Patient
                            </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[
                                styles.roleButton,
                                selectedRole === 'clinician' && styles.roleButtonActive,
                            ]}
                            onPress={() => setSelectedRole('clinician')}
                            disabled={loading}
                            activeOpacity={0.7}
                        >
                            <View style={[
                                styles.roleIconContainer,
                                selectedRole === 'clinician' && styles.roleIconContainerActive
                            ]}>
                                <Ionicons
                                    name="medkit"
                                    size={24}
                                    color={selectedRole === 'clinician' ? COLORS.primary : COLORS.textSecondary}
                                />
                            </View>
                            <Text style={[
                                styles.roleText,
                                selectedRole === 'clinician' && styles.roleTextActive,
                            ]}>
                                Clinician
                            </Text>
                        </TouchableOpacity>
                    </View>
                </View>

                {/* Login Button */}
                <TouchableOpacity
                    style={[styles.loginButton, loading && styles.loginButtonDisabled]}
                    onPress={handleLogin}
                    disabled={loading}
                    activeOpacity={0.8}
                >
                    {loading ? (
                        <ActivityIndicator color="#fff" />
                    ) : (
                        <View style={styles.loginButtonContent}>
                            <Ionicons name="log-in-outline" size={24} color="#fff" style={{ marginRight: 8 }} />
                            <Text style={styles.loginButtonText}>
                                Sign in with SMART on FHIR
                            </Text>
                        </View>
                    )}
                </TouchableOpacity>

                {/* Footer */}
                <View style={styles.footerContainer}>
                    <Ionicons name="lock-closed-outline" size={14} color={COLORS.textLight} style={{ marginRight: 4 }} />
                    <Text style={styles.footer}>
                        Secure • Private • HIPAA Compliant
                    </Text>
                </View>
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: COLORS.background,
    },
    content: {
        flex: 1,
        justifyContent: 'center',
        paddingHorizontal: SPACING.l,
    },
    header: {
        alignItems: 'center',
        marginBottom: SPACING.xxl,
    },
    iconContainer: {
        width: 80,
        height: 80,
        borderRadius: RADIUS.xl,
        backgroundColor: COLORS.primaryLight,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: SPACING.m,
        ...SHADOWS.small,
    },
    title: {
        fontSize: 32,
        ...FONTS.bold,
        color: COLORS.text,
        marginBottom: SPACING.xs,
        letterSpacing: -0.5,
    },
    subtitle: {
        fontSize: 16,
        ...FONTS.regular,
        color: COLORS.textSecondary,
    },
    roleContainer: {
        marginBottom: SPACING.xl,
    },
    roleLabel: {
        fontSize: 14,
        ...FONTS.semibold,
        color: COLORS.textSecondary,
        marginBottom: SPACING.m,
        textAlign: 'center',
        textTransform: 'uppercase',
        letterSpacing: 1,
    },
    roleButtons: {
        flexDirection: 'row',
        gap: SPACING.m,
    },
    roleButton: {
        flex: 1,
        backgroundColor: COLORS.surface,
        borderRadius: RADIUS.l,
        padding: SPACING.l,
        alignItems: 'center',
        borderWidth: 2,
        borderColor: COLORS.border,
        ...SHADOWS.small,
    },
    roleButtonActive: {
        borderColor: COLORS.primary,
        backgroundColor: COLORS.infoBg,
        ...SHADOWS.medium,
    },
    roleIconContainer: {
        width: 48,
        height: 48,
        borderRadius: RADIUS.full,
        backgroundColor: COLORS.background,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: SPACING.s,
    },
    roleIconContainerActive: {
        backgroundColor: COLORS.surface,
    },
    roleText: {
        fontSize: 16,
        ...FONTS.medium,
        color: COLORS.textSecondary,
    },
    roleTextActive: {
        color: COLORS.primaryDark,
        ...FONTS.semibold,
    },
    loginButton: {
        backgroundColor: COLORS.primary,
        borderRadius: RADIUS.m,
        padding: SPACING.m,
        alignItems: 'center',
        marginBottom: SPACING.xl,
        ...SHADOWS.medium,
    },
    loginButtonContent: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    loginButtonDisabled: {
        backgroundColor: COLORS.textLight,
        ...SHADOWS.small,
    },
    loginButtonText: {
        color: COLORS.surface,
        fontSize: 16,
        ...FONTS.semibold,
    },
    footerContainer: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
    },
    footer: {
        textAlign: 'center',
        color: COLORS.textLight,
        fontSize: 12,
        ...FONTS.medium,
    },
});
