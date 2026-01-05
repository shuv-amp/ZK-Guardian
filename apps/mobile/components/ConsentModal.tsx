import React, { useState, useEffect } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { consentClient } from '../services/ConsentHandshakeClient';
import { Ionicons } from '@expo/vector-icons';

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
        // Register consent request handler
        consentClient.onConsentRequest((req) => {
            setRequest(req);
        });
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
        <Modal visible={true} transparent animationType="slide">
            <View style={styles.overlay}>
                <View style={styles.modal}>
                    {/* Header */}
                    <View style={styles.header}>
                        <Ionicons name="shield-checkmark" size={48} color="#4CAF50" />
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
                        <Text style={styles.timer}>
                            Expires in {timeRemaining}s
                        </Text>
                    </View>

                    {/* Actions */}
                    {isProcessing ? (
                        <ActivityIndicator size="large" color="#2196F3" />
                    ) : (
                        <View style={styles.actions}>
                            <TouchableOpacity
                                style={[styles.button, styles.denyButton]}
                                onPress={handleDeny}
                            >
                                <Ionicons name="close" size={24} color="#FFF" />
                                <Text style={styles.buttonText}>Deny</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={[styles.button, styles.approveButton]}
                                onPress={handleApprove}
                            >
                                <Ionicons name="checkmark" size={24} color="#FFF" />
                                <Text style={styles.buttonText}>Approve</Text>
                            </TouchableOpacity>
                        </View>
                    )}

                    {/* Security Note */}
                    <Text style={styles.securityNote}>
                        Approval requires biometric authentication
                    </Text>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    modal: {
        backgroundColor: '#FFF',
        borderRadius: 20,
        padding: 24,
        width: '100%',
        maxWidth: 400,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 8,
    },
    header: {
        alignItems: 'center',
        marginBottom: 20,
    },
    title: {
        fontSize: 24,
        fontWeight: '700',
        color: '#1A1A1A',
        marginTop: 12,
    },
    content: {
        alignItems: 'center',
        marginBottom: 20,
    },
    practitioner: {
        fontSize: 20,
        fontWeight: '600',
        color: '#2196F3',
        textAlign: 'center',
    },
    description: {
        fontSize: 16,
        color: '#666',
        marginVertical: 8,
    },
    resource: {
        fontSize: 20,
        fontWeight: '600',
        color: '#1A1A1A',
    },
    timerContainer: {
        backgroundColor: '#FFF3E0',
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 20,
        marginBottom: 20,
    },
    timer: {
        fontSize: 14,
        color: '#FF9800',
        fontWeight: '600',
    },
    actions: {
        flexDirection: 'row',
        gap: 16,
        marginBottom: 16,
    },
    button: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 32,
        paddingVertical: 14,
        borderRadius: 12,
        gap: 8,
    },
    approveButton: {
        backgroundColor: '#4CAF50',
    },
    denyButton: {
        backgroundColor: '#F44336',
    },
    buttonText: {
        color: '#FFF',
        fontSize: 16,
        fontWeight: '600',
    },
    securityNote: {
        fontSize: 12,
        color: '#999',
        textAlign: 'center',
    },
});
