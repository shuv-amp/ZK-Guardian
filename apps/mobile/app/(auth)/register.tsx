/**
 * Register Screen
 * New user registration with role selection + SMART on FHIR
 */

import { useState } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    StyleSheet,
    SafeAreaView,
    ActivityIndicator,
    StatusBar,
    ScrollView,
    Alert,
    KeyboardAvoidingView,
    Platform
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, SHADOWS, SPACING, RADIUS } from '../../constants/Theme';
import { useAuth } from '../../hooks/useAuth';
import { smartAuth } from '../../services/SMARTAuthService';
import { IdentityManager, ClinicianIdentityManager } from '../../services/IdentityManager';

type UserRole = 'patient' | 'clinician';

export default function RegisterScreen() {
    const router = useRouter();
    const { login, getAccessToken } = useAuth();
    const [selectedRole, setSelectedRole] = useState<UserRole>('patient');
    const [loading, setLoading] = useState(false);
    const [formData, setFormData] = useState({
        email: '',
        fullName: '',
        organizationId: '', // For clinicians
        licenseNumber: '', // For clinicians
    });
    const [errors, setErrors] = useState<{ [key: string]: string }>({});

    const validateForm = (): boolean => {
        const newErrors: { [key: string]: string } = {};

        // Email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!formData.email.trim()) {
            newErrors.email = 'Email is required';
        } else if (!emailRegex.test(formData.email)) {
            newErrors.email = 'Please enter a valid email';
        }

        // Full name validation
        if (!formData.fullName.trim()) {
            newErrors.fullName = 'Full name is required';
        } else if (formData.fullName.trim().length < 2) {
            newErrors.fullName = 'Name must be at least 2 characters';
        }

        // Organization ID for clinicians
        if (selectedRole === 'clinician' && !formData.organizationId.trim()) {
            newErrors.organizationId = 'Facility ID is required for clinicians';
        }

        if (selectedRole === 'clinician' && !formData.licenseNumber.trim()) {
            newErrors.licenseNumber = 'License number is required for clinicians';
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleRegister = async () => {
        if (loading) return;
        if (!validateForm()) return;

        setLoading(true);

        try {
            const authSuccess = await login(selectedRole);
            if (!authSuccess) {
                throw new Error('SMART_AUTH_FAILED');
            }

            const accessToken = await getAccessToken();
            if (!accessToken) {
                throw new Error('ACCESS_TOKEN_MISSING');
            }

            if (selectedRole === 'patient') {
                const patientId = smartAuth.getPatientId();
                if (!patientId) {
                    throw new Error('PATIENT_ID_MISSING');
                }

                await IdentityManager.initializeIdentity(patientId, accessToken);
                Alert.alert('Registration Successful', 'Your patient identity is now linked.', [
                    { text: 'Continue', onPress: () => router.replace('/(patient)/dashboard') }
                ]);
            } else {
                const practitionerId = smartAuth.getPractitionerId();
                if (!practitionerId) {
                    throw new Error('PRACTITIONER_ID_MISSING');
                }

                await ClinicianIdentityManager.registerCredentials(
                    practitionerId,
                    formData.licenseNumber.trim(),
                    formData.organizationId.trim(),
                    accessToken
                );

                Alert.alert('Registration Successful', 'Clinician credentials registered.', [
                    { text: 'Continue', onPress: () => router.replace('/(clinician)/dashboard') }
                ]);
            }
        } catch (error) {
            console.error('[RegisterScreen] Registration error:', error);
            Alert.alert(
                'Registration Failed',
                'Unable to complete registration. Please try again.',
                [{ text: 'OK' }]
            );
        } finally {
            setLoading(false);
        }
    };

    const navigateToLogin = () => {
        router.replace('/(auth)/login');
    };

    return (
        <SafeAreaView style={styles.container}>
            <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />
            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                style={styles.keyboardView}
            >
                <ScrollView
                    contentContainerStyle={styles.scrollContent}
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}
                >
                    {/* Header */}
                    <View style={styles.header}>
                        <View style={styles.iconContainer}>
                            <Ionicons name="shield-checkmark" size={40} color={COLORS.primary} />
                        </View>
                        <Text style={styles.title}>Create Account</Text>
                        <Text style={styles.subtitle}>Join ZK Guardian for privacy-preserving healthcare</Text>
                    </View>

                    {/* Role Selection */}
                    <View style={styles.roleContainer}>
                        <Text style={styles.sectionLabel}>I am a</Text>
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
                                <Ionicons
                                    name="person"
                                    size={24}
                                    color={selectedRole === 'patient' ? COLORS.primary : COLORS.textSecondary}
                                />
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
                                <Ionicons
                                    name="medkit"
                                    size={24}
                                    color={selectedRole === 'clinician' ? COLORS.primary : COLORS.textSecondary}
                                />
                                <Text style={[
                                    styles.roleText,
                                    selectedRole === 'clinician' && styles.roleTextActive,
                                ]}>
                                    Clinician
                                </Text>
                            </TouchableOpacity>
                        </View>
                    </View>

                    {/* Form Fields */}
                    <View style={styles.formContainer}>
                        {/* Full Name */}
                        <View style={styles.inputGroup}>
                            <Text style={styles.inputLabel}>Full Name</Text>
                            <View style={[styles.inputWrapper, errors.fullName && styles.inputError]}>
                                <Ionicons name="person-outline" size={20} color={COLORS.textSecondary} />
                                <TextInput
                                    style={styles.input}
                                    placeholder="Enter your full name"
                                    placeholderTextColor={COLORS.textLight}
                                    value={formData.fullName}
                                    onChangeText={(text) => setFormData({ ...formData, fullName: text })}
                                    autoCapitalize="words"
                                    editable={!loading}
                                />
                            </View>
                            {errors.fullName && <Text style={styles.errorText}>{errors.fullName}</Text>}
                        </View>

                        {/* Email */}
                        <View style={styles.inputGroup}>
                            <Text style={styles.inputLabel}>Email Address</Text>
                            <View style={[styles.inputWrapper, errors.email && styles.inputError]}>
                                <Ionicons name="mail-outline" size={20} color={COLORS.textSecondary} />
                                <TextInput
                                    style={styles.input}
                                    placeholder="you@example.com"
                                    placeholderTextColor={COLORS.textLight}
                                    value={formData.email}
                                    onChangeText={(text) => setFormData({ ...formData, email: text })}
                                    keyboardType="email-address"
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    editable={!loading}
                                />
                            </View>
                            {errors.email && <Text style={styles.errorText}>{errors.email}</Text>}
                        </View>

                        {/* Facility ID (Clinicians only) */}
                        {selectedRole === 'clinician' && (
                            <View style={styles.inputGroup}>
                                <Text style={styles.inputLabel}>Facility ID</Text>
                                <View style={[styles.inputWrapper, errors.organizationId && styles.inputError]}>
                                    <Ionicons name="business-outline" size={20} color={COLORS.textSecondary} />
                                    <TextInput
                                        style={styles.input}
                                        placeholder="Enter your facility ID"
                                        placeholderTextColor={COLORS.textLight}
                                        value={formData.organizationId}
                                        onChangeText={(text) => setFormData({ ...formData, organizationId: text })}
                                        autoCapitalize="none"
                                        editable={!loading}
                                    />
                                </View>
                                {errors.organizationId && <Text style={styles.errorText}>{errors.organizationId}</Text>}
                            </View>
                        )}

                        {/* License Number (Clinicians only) */}
                        {selectedRole === 'clinician' && (
                            <View style={styles.inputGroup}>
                                <Text style={styles.inputLabel}>License Number</Text>
                                <View style={[styles.inputWrapper, errors.licenseNumber && styles.inputError]}>
                                    <Ionicons name="document-text-outline" size={20} color={COLORS.textSecondary} />
                                    <TextInput
                                        style={styles.input}
                                        placeholder="Enter your license number"
                                        placeholderTextColor={COLORS.textLight}
                                        value={formData.licenseNumber}
                                        onChangeText={(text) => setFormData({ ...formData, licenseNumber: text })}
                                        autoCapitalize="characters"
                                        editable={!loading}
                                    />
                                </View>
                                {errors.licenseNumber && <Text style={styles.errorText}>{errors.licenseNumber}</Text>}
                            </View>
                        )}

                        {/* Patient Privacy Notice */}
                        {selectedRole === 'patient' && (
                            <View style={styles.privacyNotice}>
                                <Ionicons name="shield-checkmark-outline" size={20} color={COLORS.success} />
                                <Text style={styles.privacyText}>
                                    A secure nullifier will be generated to protect your privacy. Your identity will never be exposed on-chain.
                                </Text>
                            </View>
                        )}
                    </View>

                    {/* Register Button */}
                    <TouchableOpacity
                        style={[styles.registerButton, loading && styles.registerButtonDisabled]}
                        onPress={handleRegister}
                        disabled={loading}
                        activeOpacity={0.8}
                    >
                        {loading ? (
                            <ActivityIndicator color="#fff" />
                        ) : (
                            <View style={styles.registerButtonContent}>
                                <Ionicons name="person-add-outline" size={22} color="#fff" style={{ marginRight: 8 }} />
                                <Text style={styles.registerButtonText}>Create Account</Text>
                            </View>
                        )}
                    </TouchableOpacity>

                    {/* Login Link */}
                    <View style={styles.loginLinkContainer}>
                        <Text style={styles.loginLinkText}>Already have an account?</Text>
                        <TouchableOpacity onPress={navigateToLogin} disabled={loading}>
                            <Text style={styles.loginLink}> Sign In</Text>
                        </TouchableOpacity>
                    </View>

                    {/* Footer */}
                    <View style={styles.footerContainer}>
                        <Ionicons name="lock-closed-outline" size={14} color={COLORS.textLight} style={{ marginRight: 4 }} />
                        <Text style={styles.footer}>
                            Protected by Zero-Knowledge Proofs
                        </Text>
                    </View>
                </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: COLORS.background,
    },
    keyboardView: {
        flex: 1,
    },
    scrollContent: {
        flexGrow: 1,
        paddingHorizontal: SPACING.l,
        paddingVertical: SPACING.xl,
    },
    header: {
        alignItems: 'center',
        marginBottom: SPACING.xl,
    },
    iconContainer: {
        width: 72,
        height: 72,
        borderRadius: RADIUS.xl,
        backgroundColor: COLORS.primaryLight,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: SPACING.m,
        ...SHADOWS.small,
    },
    title: {
        fontSize: 28,
        ...FONTS.bold,
        color: COLORS.text,
        marginBottom: SPACING.xs,
    },
    subtitle: {
        fontSize: 14,
        ...FONTS.regular,
        color: COLORS.textSecondary,
        textAlign: 'center',
    },
    sectionLabel: {
        fontSize: 14,
        ...FONTS.semibold,
        color: COLORS.textSecondary,
        marginBottom: SPACING.s,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    roleContainer: {
        marginBottom: SPACING.l,
    },
    roleButtons: {
        flexDirection: 'row',
        gap: SPACING.m,
    },
    roleButton: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: COLORS.surface,
        borderRadius: RADIUS.m,
        padding: SPACING.m,
        gap: SPACING.s,
        borderWidth: 2,
        borderColor: COLORS.border,
    },
    roleButtonActive: {
        borderColor: COLORS.primary,
        backgroundColor: COLORS.infoBg,
    },
    roleText: {
        fontSize: 15,
        ...FONTS.medium,
        color: COLORS.textSecondary,
    },
    roleTextActive: {
        color: COLORS.primaryDark,
        ...FONTS.semibold,
    },
    formContainer: {
        marginBottom: SPACING.l,
    },
    inputGroup: {
        marginBottom: SPACING.m,
    },
    inputLabel: {
        fontSize: 14,
        ...FONTS.medium,
        color: COLORS.text,
        marginBottom: SPACING.xs,
    },
    inputWrapper: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: COLORS.surface,
        borderRadius: RADIUS.m,
        paddingHorizontal: SPACING.m,
        borderWidth: 1,
        borderColor: COLORS.border,
    },
    inputError: {
        borderColor: COLORS.error,
    },
    input: {
        flex: 1,
        height: 48,
        marginLeft: SPACING.s,
        fontSize: 15,
        ...FONTS.regular,
        color: COLORS.text,
    },
    errorText: {
        fontSize: 12,
        ...FONTS.regular,
        color: COLORS.error,
        marginTop: SPACING.xs,
    },
    privacyNotice: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        backgroundColor: COLORS.successBg,
        borderRadius: RADIUS.m,
        padding: SPACING.m,
        gap: SPACING.s,
        marginTop: SPACING.s,
    },
    privacyText: {
        flex: 1,
        fontSize: 13,
        ...FONTS.regular,
        color: COLORS.success,
        lineHeight: 18,
    },
    registerButton: {
        backgroundColor: COLORS.primary,
        borderRadius: RADIUS.m,
        padding: SPACING.m,
        alignItems: 'center',
        marginBottom: SPACING.m,
        ...SHADOWS.medium,
    },
    registerButtonContent: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    registerButtonDisabled: {
        backgroundColor: COLORS.textLight,
        ...SHADOWS.small,
    },
    registerButtonText: {
        color: COLORS.surface,
        fontSize: 16,
        ...FONTS.semibold,
    },
    loginLinkContainer: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: SPACING.xl,
    },
    loginLinkText: {
        fontSize: 14,
        ...FONTS.regular,
        color: COLORS.textSecondary,
    },
    loginLink: {
        fontSize: 14,
        ...FONTS.semibold,
        color: COLORS.primary,
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
