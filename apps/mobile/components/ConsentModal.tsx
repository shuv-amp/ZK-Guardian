import React, { useState, useEffect } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { consentClient } from '../services/ConsentHandshakeClient';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, SPACING, RADIUS, SHADOWS } from '../constants/Theme';

interface ConsentRequest {
    requestId: string;
    details: {
        practitioner: string;
        resourceType: string;
        resourceId: string;
    };
    timestamp: number;
}

/**
 * ConsentModal
 * 
 * Displays real-time consent requests from clinicians.
 * Requires biometric authentication before approval.
 */
export function ConsentModal() {
    const [request, setRequest] = useState<ConsentRequest | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);

    useEffect(() => {
        // Store callback reference for cleanup
        const handleRequest = (req: ConsentRequest) => {
            setRequest(req);
        };
        
        // Register consent request handler
        const unsubscribe = consentClient.onConsentRequest(handleRequest);
        
        // Cleanup: clear the handler on unmount
        return () => {
            unsubscribe();
        };
    }, []);

    const handleApprove = async () => {
        if (!request) return;

        setIsProcessing(true);
        try {
            // Require biometric authentication
            const authenticated = await consentClient.authenticateForConsent();
            if (!authenticated) {
                // User cancelled biometric
                setIsProcessing(false);
                return;
            }

            await consentClient.sendResponse(request.requestId, true);
            setRequest(null);
        } catch (error) {
            console.error('Failed to approve consent:', error);
        }
        setIsProcessing(false);
    };

    const handleDeny = async () => {
        if (!request) return;

        setIsProcessing(true);
        try {
            await consentClient.sendResponse(request.requestId, false);
            setRequest(null);
        } catch (error) {
            console.error('Failed to deny consent:', error);
        }
        setIsProcessing(false);
    };

    // Calculate time remaining (requests expire after 30s)
    const [timeRemaining, setTimeRemaining] = useState(30);
    useEffect(() => {
        if (!request) return;

        const expiresAt = request.timestamp + 30000;
        const interval = setInterval(() => {
            const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
            setTimeRemaining(remaining);

            if (remaining === 0) {
                setRequest(null); // Auto-expire
            }
        }, 1000);

        return () => clearInterval(interval);
    }, [request]);

    if (!request) return null;

    // Map resource types to user-friendly names
    const resourceLabels: Record<string, string> = {
        Observation: 'Lab Results',
        DiagnosticReport: 'Imaging/Radiology',
        MedicationRequest: 'Medications',
        Condition: 'Diagnoses',
        Procedure: 'Procedures',
        Encounter: 'Visit History',
    };

    const resourceLabel = resourceLabels[request.details.resourceType] || request.details.resourceType;

    return (
        <Modal visible={true} transparent animationType="fade">
            <View style={styles.overlay}>
                <View style={styles.modal}>
                    {/* Header */}
                    <View style={styles.header}>
                        <View style={styles.iconContainer}>
                            <Ionicons name="shield-checkmark" size={32} color={COLORS.success} />
                        </View>
                        <Text style={styles.title}>Access Request</Text>
                    </View>

                    {/* Content */}
                    <View style={styles.content}>
                        <Text style={styles.practitioner}>
                            {request.details.practitioner}
                        </Text>
                        <Text style={styles.description}>
                            is requesting access to your
                        </Text>
                        <Text style={styles.resource}>
                            {resourceLabel}
                        </Text>
                    </View>

                    {/* Timer */}
                    <View style={styles.timerContainer}>
                        <Ionicons name="time-outline" size={16} color={COLORS.warning} style={{ marginRight: 4 }} />
                        <Text style={styles.timer}>
                            Expires in {timeRemaining}s
                        </Text>
                    </View>

                    {/* Actions */}
                    {isProcessing ? (
                        <ActivityIndicator size="large" color={COLORS.primary} />
                    ) : (
                        <View style={styles.actions}>
                            <TouchableOpacity
                                style={[styles.button, styles.denyButton]}
                                onPress={handleDeny}
                                activeOpacity={0.8}
                            >
                                <Ionicons name="close" size={20} color={COLORS.surface} />
                                <Text style={styles.buttonText}>Deny</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={[styles.button, styles.approveButton]}
                                onPress={handleApprove}
                                activeOpacity={0.8}
                            >
                                <Ionicons name="checkmark" size={20} color={COLORS.surface} />
                                <Text style={styles.buttonText}>Approve</Text>
                            </TouchableOpacity>
                        </View>
                    )}

                    {/* Security Note */}
                    <View style={styles.securityNoteContainer}>
                        <Ionicons name="finger-print-outline" size={12} color={COLORS.textLight} style={{ marginRight: 4 }} />
                        <Text style={styles.securityNote}>
                            Biometric authentication required
                        </Text>
                    </View>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(15, 23, 42, 0.6)', // Slate-900 with opacity
        justifyContent: 'center',
        alignItems: 'center',
        padding: SPACING.l,
    },
    modal: {
        backgroundColor: COLORS.surface,
        borderRadius: RADIUS.xl,
        padding: SPACING.xl,
        width: '100%',
        maxWidth: 360,
        alignItems: 'center',
        ...SHADOWS.large,
    },
    header: {
        alignItems: 'center',
        marginBottom: SPACING.l,
    },
    iconContainer: {
        width: 64,
        height: 64,
        borderRadius: RADIUS.full,
        backgroundColor: COLORS.successBg,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: SPACING.m,
    },
    title: {
        fontSize: 20,
        ...FONTS.bold,
        color: COLORS.text,
    },
    content: {
        alignItems: 'center',
        marginBottom: SPACING.l,
    },
    practitioner: {
        fontSize: 18,
        ...FONTS.semibold,
        color: COLORS.primary,
        textAlign: 'center',
        marginBottom: SPACING.xs,
    },
    description: {
        fontSize: 14,
        ...FONTS.regular,
        color: COLORS.textSecondary,
        marginBottom: SPACING.xs,
    },
    resource: {
        fontSize: 18,
        ...FONTS.bold,
        color: COLORS.text,
    },
    timerContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: COLORS.warningBg,
        paddingHorizontal: SPACING.m,
        paddingVertical: SPACING.xs,
        borderRadius: RADIUS.full,
        marginBottom: SPACING.xl,
    },
    timer: {
        fontSize: 12,
        color: COLORS.warning,
        ...FONTS.medium,
    },
    actions: {
        flexDirection: 'row',
        gap: SPACING.m,
        marginBottom: SPACING.l,
        width: '100%',
    },
    button: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: SPACING.m,
        borderRadius: RADIUS.m,
        gap: SPACING.xs,
        ...SHADOWS.small,
    },
    approveButton: {
        backgroundColor: COLORS.success,
    },
    denyButton: {
        backgroundColor: COLORS.error,
    },
    buttonText: {
        color: COLORS.surface,
        fontSize: 14,
        ...FONTS.semibold,
    },
    securityNoteContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    securityNote: {
        fontSize: 12,
        color: COLORS.textLight,
        ...FONTS.regular,
    },
});
