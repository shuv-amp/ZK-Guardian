import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { mapAccessErrorMessage, mapBreakGlassErrorMessage, parseGatewayError } from '../../services/gatewayError';
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
] as const;

type BreakGlassReason = typeof REASON_OPTIONS[number]['key'];

type ActiveSession = {
    sessionId: string;
    reason: string;
    expiresAt: string;
    remainingMinutes: number;
    txHash?: string;
};

export default function BreakGlassScreen() {
    const { practitionerId, logout } = useAuth();
    const [patientId, setPatientId] = useState('');
    const [selectedReason, setSelectedReason] = useState<BreakGlassReason | null>(null);
    const [justification, setJustification] = useState('');
    const [witnessId, setWitnessId] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isRefreshingStatus, setIsRefreshingStatus] = useState(false);
    const [activeSession, setActiveSession] = useState<ActiveSession | null>(null);

    const selectedReasonLabel = useMemo(() => {
        if (!selectedReason) return null;
        return REASON_OPTIONS.find((option) => option.key === selectedReason)?.label || selectedReason;
    }, [selectedReason]);

    const buildPayload = useCallback((reason: BreakGlassReason) => ({
        reason,
        justification,
        clinicianSignature: practitionerId || 'unknown-clinician',
        witnessId: witnessId || undefined,
        estimatedDuration: 60,
        emergencyCode: 3,
        emergencyThreshold: 2,
    }), [justification, practitionerId, witnessId]);

    const parseSession = (data: any): ActiveSession | null => {
        const first = Array.isArray(data?.sessions) ? data.sessions[0] : null;
        if (!first || !first.sessionId) {
            return null;
        }

        return {
            sessionId: String(first.sessionId),
            reason: String(first.reason || 'UNKNOWN'),
            expiresAt: String(first.expiresAt || new Date().toISOString()),
            remainingMinutes: Number(first.remainingMinutes || 0),
            txHash: typeof first.txHash === 'string' ? first.txHash : undefined,
        };
    };

    const fetchSessionStatus = useCallback(async (targetPatientId?: string, silent = true): Promise<void> => {
        const normalizedPatientId = (targetPatientId || patientId).trim();
        if (!normalizedPatientId) {
            setActiveSession(null);
            return;
        }

        if (!silent) {
            setIsRefreshingStatus(true);
        }

        try {
            const response = await authorizedFetch(
                `${config.GATEWAY_URL}/api/break-glass/${encodeURIComponent(normalizedPatientId)}/status`
            );

            if (!response.ok) {
                setActiveSession(null);
                const { code, message } = await parseGatewayError(response);
                const mapped = mapBreakGlassErrorMessage(code, message);
                if (!silent) {
                    Alert.alert('Status unavailable', mapped);
                }
                return;
            }

            const data = await response.json();
            setActiveSession(parseSession(data));
        } catch (error: any) {
            setActiveSession(null);
            if (error instanceof APIError && error.status === 401) {
                await logout();
                return;
            }

            if (!silent) {
                Alert.alert('Status unavailable', 'Unable to fetch active emergency session right now.');
            }
        } finally {
            if (!silent) {
                setIsRefreshingStatus(false);
            }
        }
    }, [logout, patientId]);

    useEffect(() => {
        const normalizedPatientId = patientId.trim();
        if (!normalizedPatientId) {
            setActiveSession(null);
            return;
        }

        const timer = setTimeout(() => {
            void fetchSessionStatus(normalizedPatientId, true);
        }, 500);

        return () => clearTimeout(timer);
    }, [patientId, fetchSessionStatus]);

    const validateForm = (): boolean => {
        if (!patientId.trim()) {
            Alert.alert('Error', 'Patient ID is required');
            return false;
        }
        if (!selectedReason) {
            Alert.alert('Error', 'Please select an emergency reason');
            return false;
        }
        if (justification.trim().length < 20) {
            Alert.alert('Error', 'Justification must be at least 20 characters');
            return false;
        }
        return true;
    };

    const initiateAndAccess = async (): Promise<void> => {
        if (!selectedReason) {
            return;
        }

        const normalizedPatientId = patientId.trim();
        const payload = buildPayload(selectedReason);

        const initiateResponse = await authorizedFetch(
            `${config.GATEWAY_URL}/api/break-glass/${encodeURIComponent(normalizedPatientId)}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
            }
        );

        if (!initiateResponse.ok) {
            const { code, message } = await parseGatewayError(initiateResponse);
            const mappedMessage = mapBreakGlassErrorMessage(code, message);

            if (code === 'BREAK_GLASS_ACTIVE') {
                await fetchSessionStatus(normalizedPatientId, true);
            }

            Alert.alert('Break-glass initiation failed', mappedMessage);
            return;
        }

        const initiateData = await initiateResponse.json();
        setActiveSession({
            sessionId: String(initiateData?.sessionId || ''),
            reason: selectedReason,
            expiresAt: String(initiateData?.expiresAt || new Date().toISOString()),
            remainingMinutes: Math.max(
                0,
                Math.floor((new Date(String(initiateData?.expiresAt || Date.now())).getTime() - Date.now()) / 60000)
            ),
            txHash: typeof initiateData?.txHash === 'string' ? initiateData.txHash : undefined,
        });

        const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64');
        const accessResponse = await authorizedFetch(
            `${config.GATEWAY_URL}/fhir/Observation?patient=Patient/${encodeURIComponent(normalizedPatientId)}&_count=1`,
            {
                headers: {
                    'X-Break-Glass': encodedPayload,
                },
            }
        );

        if (!accessResponse.ok) {
            const { code, message } = await parseGatewayError(accessResponse);
            const mappedMessage =
                code && code.startsWith('BREAK_')
                    ? mapBreakGlassErrorMessage(code, message)
                    : mapAccessErrorMessage(code, message);

            Alert.alert('Emergency access failed', mappedMessage);
            return;
        }

        const selectedReasonObj = REASON_OPTIONS.find((reason) => reason.key === selectedReason);
        Alert.alert(
            'Emergency Access Granted',
            `Break-glass session is active for patient ${normalizedPatientId}.\n\nReview SLA: ${selectedReasonObj?.reviewSLA || '24 hours'}\nSession: ${String(initiateData?.sessionId || '').slice(0, 8)}...`,
            [{ text: 'OK' }]
        );

        setSelectedReason(null);
        setJustification('');
        setWitnessId('');
        await fetchSessionStatus(normalizedPatientId, true);
    };

    const handleSubmit = async () => {
        if (!validateForm()) {
            return;
        }

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
                            await initiateAndAccess();
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

    const handleCloseSession = async () => {
        const normalizedPatientId = patientId.trim();
        if (!normalizedPatientId) {
            Alert.alert('Patient ID required', 'Enter patient ID to close emergency session.');
            return;
        }

        Alert.alert(
            'Close Break-Glass Session',
            'Close the active emergency session for this patient?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Close Session',
                    style: 'destructive',
                    onPress: async () => {
                        setIsSubmitting(true);
                        try {
                            const response = await authorizedFetch(
                                `${config.GATEWAY_URL}/api/break-glass/${encodeURIComponent(normalizedPatientId)}/close`,
                                {
                                    method: 'POST',
                                    headers: {
                                        'Content-Type': 'application/json',
                                    },
                                    body: JSON.stringify({ closureNotes: 'Closed from clinician mobile app' }),
                                }
                            );

                            if (!response.ok) {
                                const { code, message } = await parseGatewayError(response);
                                Alert.alert('Close failed', mapBreakGlassErrorMessage(code, message));
                                return;
                            }

                            setActiveSession(null);
                            Alert.alert('Session Closed', 'Emergency session has been closed successfully.');
                            await fetchSessionStatus(normalizedPatientId, true);
                        } catch (error: any) {
                            if (error instanceof APIError && error.status === 401) {
                                await logout();
                            } else {
                                Alert.alert('Close failed', 'Unable to close session right now.');
                            }
                        } finally {
                            setIsSubmitting(false);
                        }
                    }
                }
            ]
        );
    };

    return (
        <SafeAreaView style={styles.container}>
            <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />
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
                        <TouchableOpacity
                            style={styles.statusButton}
                            onPress={() => fetchSessionStatus(undefined, false)}
                            disabled={isRefreshingStatus || isSubmitting}
                        >
                            <Ionicons name="refresh" size={14} color={COLORS.primary} />
                            <Text style={styles.statusButtonText}>
                                {isRefreshingStatus ? 'Checking...' : 'Check Active Session'}
                            </Text>
                        </TouchableOpacity>
                    </View>

                    {activeSession && (
                        <View style={styles.activeSessionCard}>
                            <View style={styles.activeSessionHeader}>
                                <Ionicons name="shield-checkmark" size={18} color={COLORS.warning} />
                                <Text style={styles.activeSessionTitle}>Active Break-Glass Session</Text>
                            </View>
                            <Text style={styles.activeSessionText}>Session: {activeSession.sessionId}</Text>
                            <Text style={styles.activeSessionText}>Reason: {activeSession.reason}</Text>
                            <Text style={styles.activeSessionText}>
                                Expires: {new Date(activeSession.expiresAt).toLocaleString()}
                            </Text>
                            <Text style={styles.activeSessionText}>
                                Remaining: {Math.max(0, activeSession.remainingMinutes)} minute(s)
                            </Text>
                            {activeSession.txHash && activeSession.txHash !== 'pending' && (
                                <Text style={styles.activeSessionText}>Tx: {activeSession.txHash.slice(0, 12)}...</Text>
                            )}
                            <TouchableOpacity
                                style={styles.closeButton}
                                onPress={handleCloseSession}
                                disabled={isSubmitting}
                            >
                                <Ionicons name="close-circle-outline" size={18} color={COLORS.error} />
                                <Text style={styles.closeButtonText}>Close Emergency Session</Text>
                            </TouchableOpacity>
                        </View>
                    )}

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
                            {isSubmitting
                                ? 'Processing...'
                                : activeSession
                                    ? `Open New Emergency Session${selectedReasonLabel ? ` (${selectedReasonLabel})` : ''}`
                                    : 'Initiate Break-Glass'}
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
        color: '#7F1D1D',
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
    statusButton: {
        marginTop: SPACING.sm,
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: SPACING.sm,
        paddingVertical: 6,
        borderRadius: RADIUS.sm,
        backgroundColor: COLORS.primaryLight,
    },
    statusButtonText: {
        fontSize: FONTS.sizes.xs,
        color: COLORS.primary,
        fontWeight: FONTS.weights.medium,
    },
    activeSessionCard: {
        backgroundColor: COLORS.warningBg,
        borderWidth: 1,
        borderColor: COLORS.warning,
        borderRadius: RADIUS.md,
        padding: SPACING.md,
        marginBottom: SPACING.lg,
    },
    activeSessionHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: SPACING.xs,
        marginBottom: SPACING.sm,
    },
    activeSessionTitle: {
        fontSize: FONTS.sizes.sm,
        fontWeight: FONTS.weights.semibold,
        color: '#8A5A00',
    },
    activeSessionText: {
        fontSize: FONTS.sizes.xs,
        color: COLORS.textSecondary,
        marginTop: 2,
    },
    closeButton: {
        marginTop: SPACING.sm,
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: SPACING.xs,
        paddingHorizontal: SPACING.sm,
        paddingVertical: 6,
        borderRadius: RADIUS.sm,
        backgroundColor: COLORS.errorBg,
    },
    closeButtonText: {
        fontSize: FONTS.sizes.xs,
        color: COLORS.error,
        fontWeight: FONTS.weights.semibold,
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
