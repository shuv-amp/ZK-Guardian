import React, { useState, useCallback } from 'react';
import {
    View,
    Text,
    StyleSheet,
    Modal,
    TouchableOpacity,
    ScrollView,
    ActivityIndicator
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BiometricPrompt } from '../shared/BiometricPrompt';
import { ConsentRequest } from '../../hooks/useConsent';

/**
 * ConsentApprovalModal Component
 * 
 * Modal for approving or denying consent requests.
 * Per Development Guide §1.
 */

export interface ConsentApprovalModalProps {
    visible: boolean;
    request: ConsentRequest | null;
    onApprove: (requestId: string, biometricVerified: boolean) => Promise<boolean>;
    onDeny: (requestId: string, reason?: string) => Promise<boolean>;
    onClose: () => void;
}

export function ConsentApprovalModal({
    visible,
    request,
    onApprove,
    onDeny,
    onClose
}: ConsentApprovalModalProps) {
    const [isProcessing, setIsProcessing] = useState(false);
    const [showBiometric, setShowBiometric] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleApprove = useCallback(async () => {
        // First require biometric verification
        setShowBiometric(true);
    }, []);

    const handleBiometricSuccess = useCallback(async () => {
        if (!request) return;

        setShowBiometric(false);
        setIsProcessing(true);
        setError(null);

        try {
            const success = await onApprove(request.requestId, true);
            if (success) {
                onClose();
            } else {
                setError('Failed to approve consent. Please try again.');
            }
        } catch (err: any) {
            setError(err.message || 'An error occurred');
        } finally {
            setIsProcessing(false);
        }
    }, [request, onApprove, onClose]);

    const handleDeny = useCallback(async () => {
        if (!request) return;

        setIsProcessing(true);
        setError(null);

        try {
            const success = await onDeny(request.requestId, 'Patient denied request');
            if (success) {
                onClose();
            } else {
                setError('Failed to deny consent. Please try again.');
            }
        } catch (err: any) {
            setError(err.message || 'An error occurred');
        } finally {
            setIsProcessing(false);
        }
    }, [request, onDeny, onClose]);

    if (!request) return null;

    return (
        <>
            <Modal
                visible={visible && !showBiometric}
                transparent
                animationType="slide"
                onRequestClose={onClose}
            >
                <View style={styles.overlay}>
                    <View style={styles.container}>
                        {/* Header */}
                        <View style={styles.header}>
                            <View style={styles.iconContainer}>
                                <Ionicons name="medical-outline" size={32} color="#007AFF" />
                            </View>
                            <Text style={styles.title}>Consent Request</Text>
                            <TouchableOpacity
                                style={styles.closeButton}
                                onPress={onClose}
                                disabled={isProcessing}
                            >
                                <Ionicons name="close" size={24} color="#666" />
                            </TouchableOpacity>
                        </View>

                        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
                            {/* Clinician Info */}
                            <View style={styles.section}>
                                <Text style={styles.sectionLabel}>Healthcare Provider</Text>
                                <View style={styles.infoCard}>
                                    <Ionicons name="person-outline" size={20} color="#007AFF" />
                                    <View style={styles.infoText}>
                                        <Text style={styles.infoTitle}>
                                            {request.clinicianName || 'Healthcare Provider'}
                                        </Text>
                                        <Text style={styles.infoSubtitle}>
                                            {request.facility || 'Medical Facility'}
                                        </Text>
                                    </View>
                                </View>
                            </View>

                            {/* Access Details */}
                            <View style={styles.section}>
                                <Text style={styles.sectionLabel}>Requesting Access To</Text>
                                <View style={styles.accessList}>
                                    {(request.resourceTypes || ['Medical Records']).map((type, index) => (
                                        <View key={index} style={styles.accessItem}>
                                            <Ionicons name="document-text-outline" size={16} color="#666" />
                                            <Text style={styles.accessText}>{type}</Text>
                                        </View>
                                    ))}
                                </View>
                            </View>

                            {/* Purpose */}
                            {request.purpose && (
                                <View style={styles.section}>
                                    <Text style={styles.sectionLabel}>Purpose</Text>
                                    <Text style={styles.purposeText}>{request.purpose}</Text>
                                </View>
                            )}

                            {/* Duration */}
                            <View style={styles.section}>
                                <Text style={styles.sectionLabel}>Access Duration</Text>
                                <View style={styles.durationContainer}>
                                    <Ionicons name="time-outline" size={20} color="#666" />
                                    <Text style={styles.durationText}>
                                        {request.duration || 'Single access'}
                                    </Text>
                                </View>
                            </View>

                            {/* Warning */}
                            <View style={styles.warningContainer}>
                                <Ionicons name="shield-checkmark-outline" size={20} color="#34C759" />
                                <Text style={styles.warningText}>
                                    This access will be recorded on the blockchain audit trail.
                                    You can revoke this consent at any time.
                                </Text>
                            </View>

                            {/* Error */}
                            {error && (
                                <View style={styles.errorContainer}>
                                    <Ionicons name="alert-circle-outline" size={20} color="#FF3B30" />
                                    <Text style={styles.errorText}>{error}</Text>
                                </View>
                            )}
                        </ScrollView>

                        {/* Actions */}
                        <View style={styles.actions}>
                            <TouchableOpacity
                                style={styles.denyButton}
                                onPress={handleDeny}
                                disabled={isProcessing}
                            >
                                {isProcessing ? (
                                    <ActivityIndicator color="#FF3B30" />
                                ) : (
                                    <>
                                        <Ionicons name="close-circle-outline" size={20} color="#FF3B30" />
                                        <Text style={styles.denyButtonText}>Deny</Text>
                                    </>
                                )}
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={styles.approveButton}
                                onPress={handleApprove}
                                disabled={isProcessing}
                            >
                                {isProcessing ? (
                                    <ActivityIndicator color="#FFF" />
                                ) : (
                                    <>
                                        <Ionicons name="checkmark-circle-outline" size={20} color="#FFF" />
                                        <Text style={styles.approveButtonText}>Approve</Text>
                                    </>
                                )}
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>

            {/* Biometric Verification */}
            <BiometricPrompt
                visible={showBiometric}
                title="Verify to Approve"
                description="Use biometrics to confirm your consent"
                onSuccess={handleBiometricSuccess}
                onCancel={() => setShowBiometric(false)}
            />
        </>
    );
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'flex-end'
    },
    container: {
        backgroundColor: '#FFF',
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        maxHeight: '85%'
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 20,
        borderBottomWidth: 1,
        borderBottomColor: '#F0F0F0'
    },
    iconContainer: {
        width: 48,
        height: 48,
        borderRadius: 12,
        backgroundColor: '#F0F7FF',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12
    },
    title: {
        flex: 1,
        fontSize: 18,
        fontWeight: '600',
        color: '#1A1A1A'
    },
    closeButton: {
        padding: 4
    },
    content: {
        padding: 20
    },
    section: {
        marginBottom: 20
    },
    sectionLabel: {
        fontSize: 12,
        fontWeight: '600',
        color: '#666',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        marginBottom: 8
    },
    infoCard: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
        backgroundColor: '#F8F8F8',
        borderRadius: 12
    },
    infoText: {
        marginLeft: 12,
        flex: 1
    },
    infoTitle: {
        fontSize: 16,
        fontWeight: '500',
        color: '#1A1A1A'
    },
    infoSubtitle: {
        fontSize: 13,
        color: '#666',
        marginTop: 2
    },
    accessList: {
        gap: 8
    },
    accessItem: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
        backgroundColor: '#F8F8F8',
        borderRadius: 8,
        gap: 8
    },
    accessText: {
        fontSize: 14,
        color: '#1A1A1A'
    },
    purposeText: {
        fontSize: 14,
        color: '#1A1A1A',
        lineHeight: 20
    },
    durationContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8
    },
    durationText: {
        fontSize: 14,
        color: '#1A1A1A'
    },
    warningContainer: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        padding: 12,
        backgroundColor: '#F0FFF0',
        borderRadius: 12,
        gap: 8,
        marginTop: 8
    },
    warningText: {
        flex: 1,
        fontSize: 13,
        color: '#2D7A2D',
        lineHeight: 18
    },
    errorContainer: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        padding: 12,
        backgroundColor: '#FFF0F0',
        borderRadius: 12,
        gap: 8,
        marginTop: 8
    },
    errorText: {
        flex: 1,
        fontSize: 13,
        color: '#FF3B30',
        lineHeight: 18
    },
    actions: {
        flexDirection: 'row',
        padding: 20,
        gap: 12,
        borderTopWidth: 1,
        borderTopColor: '#F0F0F0'
    },
    denyButton: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 14,
        borderRadius: 12,
        backgroundColor: '#FFF0F0',
        gap: 8
    },
    denyButtonText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#FF3B30'
    },
    approveButton: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 14,
        borderRadius: 12,
        backgroundColor: '#34C759',
        gap: 8
    },
    approveButtonText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#FFF'
    }
});

export default ConsentApprovalModal;
