import React, { useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TextInput,
    TouchableOpacity,
    Alert,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StatusBar
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../hooks/useAuth';
import { config } from '../../config/env';
import { authorizedFetch, APIError } from '../../services/API';
import { COLORS, FONTS, SPACING, RADIUS, SHADOWS } from '../../constants/Theme';
import { Buffer } from 'buffer';

// Ensure Buffer is available in React Native runtime
global.Buffer = global.Buffer || Buffer;

/**
 * Break-Glass Screen (Clinician)
 * 
 * Emergency access workflow that bypasses consent for life-threatening situations.
 * All break-glass access is logged for mandatory review.
 */

const REASON_OPTIONS = [
    {
        key: 'LIFE_THREATENING_EMERGENCY',
        label: 'Life-Threatening Emergency',
        description: 'Immediate life threat requiring urgent care',
        reviewSLA: '24 hours'
    },
    {
        key: 'UNCONSCIOUS_PATIENT',
        label: 'Unconscious Patient',
        description: 'Patient unable to provide consent',
        reviewSLA: '24 hours'
    },
    {
        key: 'PSYCHIATRIC_CRISIS',
        label: 'Psychiatric Crisis',
        description: 'Mental health emergency',
        reviewSLA: '48 hours'
    },
    {
        key: 'SUSPECTED_ABUSE_INVESTIGATION',
        label: 'Mandatory Reporting',
        description: 'Suspected abuse investigation',
        reviewSLA: '72 hours'
    },
];

export default function BreakGlassScreen() {
    const { practitionerId, logout } = useAuth();
    const [patientId, setPatientId] = useState('');
    const [selectedReason, setSelectedReason] = useState<string | null>(null);
    const [justification, setJustification] = useState('');
    const [witnessId, setWitnessId] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const validateForm = () => {
        if (!patientId.trim()) {
            Alert.alert('Error', 'Patient ID is required');
            return false;
        }
        if (!selectedReason) {
            Alert.alert('Error', 'Please select an emergency reason');
            return false;
        }
        if (justification.length < 20) {
            Alert.alert('Error', 'Justification must be at least 20 characters');
            return false;
        }
        return true;
    };

    const handleSubmit = async () => {
        if (!validateForm()) return;

        Alert.alert(
            'Confirm Break-Glass Access',
            'This emergency access will be logged and audited. Misuse of break-glass may result in disciplinary action.\n\nAre you sure this is a genuine emergency?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Confirm Emergency',
                    style: 'destructive',
                    onPress: async () => {
                        setIsSubmitting(true);
                        try {
                            // Create break-glass payload
                            const payload = {
                                reason: selectedReason,
                                justification,
                                clinicianSignature: practitionerId,
                                witnessId: witnessId || undefined,
                            };

                            const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64');

                            // Make request with break-glass header
                            const response = await authorizedFetch(
                                `${config.GATEWAY_URL}/fhir/Patient/${patientId}/$everything`,
                                {
                                    headers: {
                                        'X-Break-Glass': encodedPayload,
                                    },
                                }
                            );

                            if (response.ok) {
                                const selectedReasonObj = REASON_OPTIONS.find(r => r.key === selectedReason);
                                Alert.alert(
                                    'Emergency Access Granted',
                                    `Access to patient ${patientId} has been granted.\n\nThis access will be reviewed within ${selectedReasonObj?.reviewSLA || '24 hours'}.\n\nCompliance has been notified.`,
                                    [{ text: 'OK' }]
                                );
                                // Reset form
                                setPatientId('');
                                setSelectedReason(null);
                                setJustification('');
                                setWitnessId('');
                            } else {
                                Alert.alert('Error', 'Failed to grant emergency access');
                            }
                        } catch (error: any) {
                            if (error instanceof APIError && error.status === 401) {
                                await logout();
                                Alert.alert('Session Expired', 'Please sign in again.');
                            } else {
                                Alert.alert('Error', 'Network error. Please try again.');
                            }
                        } finally {
                            setIsSubmitting(false);
                        }
                    }
                },
            ]
        );
    };

    return (
        <SafeAreaView style={styles.container}>
            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                style={styles.keyboardView}
            >
                <ScrollView contentContainerStyle={styles.scrollContent}>
                    {/* Warning Banner */}
                    <View style={styles.warningBanner}>
                        <Ionicons name="flash" size={24} color={COLORS.error} />
                        <View style={styles.warningText}>
                            <Text style={styles.warningTitle}>Emergency Access Only</Text>
                            <Text style={styles.warningSubtext}>
                                Break-glass bypasses patient consent. Use only for genuine emergencies.
                                All access is logged and audited.
                            </Text>
                        </View>
                    </View>

                    {/* Patient ID */}
                    <View style={styles.section}>
                        <Text style={styles.sectionLabel}>Patient ID *</Text>
                        <TextInput
                            style={styles.input}
                            placeholder="Enter patient ID"
                            value={patientId}
                            onChangeText={setPatientId}
                            autoCapitalize="none"
                            placeholderTextColor={COLORS.textTertiary}
                        />
                    </View>

                    {/* Emergency Reason */}
                    <View style={styles.section}>
                        <Text style={styles.sectionLabel}>Emergency Reason *</Text>
                        {REASON_OPTIONS.map((option) => (
                            <TouchableOpacity
                                key={option.key}
                                style={[
                                    styles.reasonOption,
                                    selectedReason === option.key && styles.reasonSelected
                                ]}
                                onPress={() => setSelectedReason(option.key)}
                            >
                                <View style={styles.reasonContent}>
                                    <View style={styles.radioButton}>
                                        {selectedReason === option.key && (
                                            <View style={styles.radioDot} />
                                        )}
                                    </View>
                                    <View style={styles.reasonTextContent}>
                                        <Text style={styles.reasonLabel}>{option.label}</Text>
                                        <Text style={styles.reasonDescription}>{option.description}</Text>
                                    </View>
                                    <Text style={styles.reviewSLA}>{option.reviewSLA}</Text>
                                </View>
                            </TouchableOpacity>
                        ))}
                    </View>

                    {/* Justification */}
                    <View style={styles.section}>
                        <Text style={styles.sectionLabel}>
                            Clinical Justification * (min 20 chars)
                        </Text>
                        <TextInput
                            style={[styles.input, styles.textArea]}
                            placeholder="Explain the clinical necessity for this emergency access..."
                            value={justification}
                            onChangeText={setJustification}
                            multiline
                            numberOfLines={4}
                            textAlignVertical="top"
                            placeholderTextColor={COLORS.textTertiary}
                        />
                        <Text style={styles.charCount}>{justification.length}/20 min</Text>
                    </View>

                    {/* Witness (Optional) */}
                    <View style={styles.section}>
                        <Text style={styles.sectionLabel}>Witness ID (Optional)</Text>
                        <TextInput
                            style={styles.input}
                            placeholder="Enter witness practitioner ID"
                            value={witnessId}
                            onChangeText={setWitnessId}
                            autoCapitalize="none"
                            placeholderTextColor={COLORS.textTertiary}
                        />
                        <Text style={styles.helperText}>
                            Having a witness strengthens audit documentation
                        </Text>
                    </View>

                    {/* Submit Button */}
                    <TouchableOpacity
                        style={[styles.submitButton, isSubmitting && styles.submitDisabled]}
                        onPress={handleSubmit}
                        disabled={isSubmitting}
                    >
                        <Ionicons name="flash" size={20} color="#FFF" />
                        <Text style={styles.submitText}>
                            {isSubmitting ? 'Processing...' : 'Initiate Break-Glass'}
                        </Text>
                    </TouchableOpacity>

                    {/* Compliance Notice */}
                    <View style={styles.complianceNotice}>
                        <Ionicons name="shield-checkmark-outline" size={18} color={COLORS.primary} />
                        <Text style={styles.complianceText}>
                            Break-glass access is logged on-chain and triggers an automatic
                            compliance review. The patient will be notified of this emergency access.
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
        padding: SPACING.md,
        paddingBottom: 100,
    },
    warningBanner: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: SPACING.md,
        padding: SPACING.md,
        backgroundColor: COLORS.errorBg,
        borderRadius: RADIUS.lg,
        marginBottom: SPACING.xl,
    },
    warningText: {
        flex: 1,
    },
    warningTitle: {
        fontSize: FONTS.sizes.md,
        fontWeight: FONTS.weights.bold,
        color: COLORS.error,
    },
    warningSubtext: {
        fontSize: FONTS.sizes.sm,
        color: '#7F1D1D', // Keep specific dark red for contrast on error bg
        marginTop: 4,
        lineHeight: 18,
    },
    section: {
        marginBottom: SPACING.lg,
    },
    sectionLabel: {
        fontSize: FONTS.sizes.sm,
        fontWeight: FONTS.weights.semibold,
        color: COLORS.textSecondary,
        marginBottom: SPACING.sm,
    },
    input: {
        backgroundColor: COLORS.surface,
        borderWidth: 1,
        borderColor: COLORS.border,
        borderRadius: RADIUS.md,
        padding: SPACING.md,
        fontSize: FONTS.sizes.md,
        color: COLORS.text,
    },
    textArea: {
        height: 100,
        paddingTop: SPACING.md,
    },
    charCount: {
        fontSize: FONTS.sizes.xs,
        color: COLORS.textTertiary,
        textAlign: 'right',
        marginTop: 4,
    },
    helperText: {
        fontSize: FONTS.sizes.xs,
        color: COLORS.textSecondary,
        marginTop: 4,
        fontStyle: 'italic',
    },
    reasonOption: {
        backgroundColor: COLORS.surface,
        borderWidth: 1,
        borderColor: COLORS.border,
        borderRadius: RADIUS.md,
        padding: SPACING.md,
        marginBottom: SPACING.sm,
    },
    reasonSelected: {
        borderColor: COLORS.primary,
        backgroundColor: COLORS.primaryLight,
    },
    reasonContent: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    radioButton: {
        width: 20,
        height: 20,
        borderRadius: RADIUS.full,
        borderWidth: 2,
        borderColor: COLORS.primary,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: SPACING.md,
    },
    radioDot: {
        width: 10,
        height: 10,
        borderRadius: RADIUS.full,
        backgroundColor: COLORS.primary,
    },
    reasonTextContent: {
        flex: 1,
    },
    reasonLabel: {
        fontSize: FONTS.sizes.md,
        fontWeight: FONTS.weights.semibold,
        color: COLORS.text,
    },
    reasonDescription: {
        fontSize: FONTS.sizes.xs,
        color: COLORS.textSecondary,
        marginTop: 2,
    },
    reviewSLA: {
        fontSize: FONTS.sizes.xs,
        color: COLORS.primary,
        fontWeight: FONTS.weights.medium,
    },
    submitButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: COLORS.error,
        paddingVertical: SPACING.md,
        borderRadius: RADIUS.lg,
        marginTop: SPACING.sm,
        ...SHADOWS.md,
    },
    submitDisabled: {
        opacity: 0.6,
    },
    submitText: {
        fontSize: FONTS.sizes.md,
        fontWeight: FONTS.weights.bold,
        color: COLORS.surface,
    },
    complianceNotice: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 8,
        marginTop: SPACING.lg,
        padding: SPACING.md,
        backgroundColor: COLORS.primaryLight,
        borderRadius: RADIUS.md,
    },
    complianceText: {
        fontSize: FONTS.sizes.xs,
        color: COLORS.primary,
        flex: 1,
        lineHeight: 18,
    },
});
