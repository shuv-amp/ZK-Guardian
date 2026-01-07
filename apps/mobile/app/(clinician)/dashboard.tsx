import React, { useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, StatusBar, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '../../hooks/useAuth';
import { config } from '../../config/env';
import { COLORS, FONTS, SPACING, RADIUS, SHADOWS } from '../../constants/Theme';

/**
 * Clinician Dashboard
 * 
 * Interface for clinicians to request patient data access.
 */
export default function ClinicianDashboard() {
    const { practitionerId, logout, getAccessToken } = useAuth();
    const router = useRouter();
    const [patientSearch, setPatientSearch] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [requestStatus, setRequestStatus] = useState<'idle' | 'loading' | 'waiting' | 'approved' | 'denied'>('idle');
    const [statusMessage, setStatusMessage] = useState('');

    // Track polling interval for cleanup
    const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const pollingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Cleanup polling on unmount
    useEffect(() => {
        return () => {
            if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
            if (pollingTimeoutRef.current) clearTimeout(pollingTimeoutRef.current);
        };
    }, []);

    const handleAccessRequest = async (resourceType: string) => {
        if (!patientSearch.trim()) return;

        setIsLoading(true);
        setRequestStatus('loading');
        setStatusMessage('Initiating Request...');

        try {
            const token = await getAccessToken();
            if (!token) {
                setRequestStatus('denied');
                setStatusMessage('Authentication Error - Please re-login');
                setIsLoading(false);
                return;
            }

            const response = await fetch(`${config.GATEWAY_URL}/fhir/${resourceType}?patient=${patientSearch}`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                },
            });

            if (response.ok) {
                setRequestStatus('approved');
                setStatusMessage('Access Granted - View Records');
                console.log('Access granted');
            } else if (response.status === 403) {
                // Handshake triggered
                setRequestStatus('waiting');
                setStatusMessage('Waiting for Patient Consent...');

                // Poll for result
                pollForConsent(resourceType, token);
            } else if (response.status === 401) {
                setRequestStatus('denied');
                setStatusMessage('Session Expired - Please re-login');
            } else {
                setRequestStatus('denied');
                setStatusMessage('Access Denied');
            }
        } catch (error) {
            console.error('Access request failed:', error);
            setRequestStatus('denied');
            setStatusMessage('Network Error - Check Connection');
        }
        setIsLoading(false);
    };

    const pollForConsent = async (resourceType: string, token: string | null) => {
        // Clear any existing polling
        if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
        if (pollingTimeoutRef.current) clearTimeout(pollingTimeoutRef.current);

        pollingIntervalRef.current = setInterval(async () => {
            try {
                const currentToken = token || await getAccessToken();
                if (!currentToken) return;

                const response = await fetch(`${config.GATEWAY_URL}/fhir/${resourceType}?patient=${patientSearch}`, {
                    headers: { 'Authorization': `Bearer ${currentToken}` },
                });

                if (response.ok) {
                    if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
                    if (pollingTimeoutRef.current) clearTimeout(pollingTimeoutRef.current);
                    setRequestStatus('approved');
                    setStatusMessage('Consent Received! Access Granted.');
                }
            } catch (e) {
                // ignore errors while polling
            }
        }, 3000);

        // Timeout after 60s
        pollingTimeoutRef.current = setTimeout(() => {
            if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
            setRequestStatus('denied');
            setStatusMessage('Request Timed Out - Patient did not respond');
        }, 60000);
    };

    return (
        <SafeAreaView style={styles.container}>
            <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />
            <ScrollView contentContainerStyle={styles.scrollContent}>
                {/* Header */}
                <View style={styles.header}>
                    <View>
                        <Text style={styles.greeting}>Clinician Portal</Text>
                        <Text style={styles.practitionerId}>ID: {practitionerId}</Text>
                    </View>
                    <TouchableOpacity onPress={logout} style={styles.logoutButton}>
                        <Ionicons name="log-out-outline" size={24} color={COLORS.textSecondary} />
                    </TouchableOpacity>
                </View>

                {/* Patient Search */}
                <View style={styles.searchSection}>
                    <Text style={styles.sectionTitle}>Patient Lookup</Text>
                    <View style={styles.searchInputContainer}>
                        <Ionicons name="search" size={20} color={COLORS.textSecondary} style={styles.searchIcon} />
                        <TextInput
                            style={styles.searchInput}
                            placeholder="Enter Patient ID"
                            value={patientSearch}
                            onChangeText={setPatientSearch}
                            placeholderTextColor={COLORS.textLight}
                        />
                    </View>
                </View>

                {/* Status Indicator */}
                {requestStatus !== 'idle' && (
                    <View style={[styles.statusBanner,
                    requestStatus === 'waiting' && styles.statusWaiting,
                    requestStatus === 'loading' && styles.statusWaiting,
                    requestStatus === 'approved' && styles.statusSuccess,
                    requestStatus === 'denied' && styles.statusError
                    ]}>
                        <Text style={styles.statusBannerText}>{statusMessage}</Text>
                        {(requestStatus === 'waiting' || requestStatus === 'loading') && (
                            <ActivityIndicator size="small" color={COLORS.primary} style={{ marginLeft: 10 }} />
                        )}
                    </View>
                )}

                {/* Resource Access Buttons */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Request Access</Text>
                    <Text style={styles.sectionDescription}>
                        Select a resource type to request access. The patient will be notified in real-time.
                    </Text>

                    <View style={styles.resourceGrid}>
                        <TouchableOpacity
                            style={styles.resourceCard}
                            onPress={() => handleAccessRequest('Observation')}
                            disabled={isLoading || !patientSearch}
                            activeOpacity={0.7}
                        >
                            <View style={[styles.resourceIcon, { backgroundColor: COLORS.primaryLight }]}>
                                <Ionicons name="flask" size={24} color={COLORS.primary} />
                            </View>
                            <Text style={styles.resourceLabel}>Lab Results</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={styles.resourceCard}
                            onPress={() => handleAccessRequest('DiagnosticReport')}
                            disabled={isLoading || !patientSearch}
                            activeOpacity={0.7}
                        >
                            <View style={[styles.resourceIcon, { backgroundColor: COLORS.infoBg }]}>
                                <Ionicons name="image" size={24} color={COLORS.info} />
                            </View>
                            <Text style={styles.resourceLabel}>Imaging</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={styles.resourceCard}
                            onPress={() => handleAccessRequest('MedicationRequest')}
                            disabled={isLoading || !patientSearch}
                            activeOpacity={0.7}
                        >
                            <View style={[styles.resourceIcon, { backgroundColor: COLORS.errorBg }]}>
                                <Ionicons name="medkit" size={24} color={COLORS.error} />
                            </View>
                            <Text style={styles.resourceLabel}>Medications</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={styles.resourceCard}
                            onPress={() => handleAccessRequest('Condition')}
                            disabled={isLoading || !patientSearch}
                            activeOpacity={0.7}
                        >
                            <View style={[styles.resourceIcon, { backgroundColor: COLORS.warningBg }]}>
                                <Ionicons name="medical" size={24} color={COLORS.warning} />
                            </View>
                            <Text style={styles.resourceLabel}>Diagnoses</Text>
                        </TouchableOpacity>
                    </View>
                </View>

                {/* Compliance Notice */}
                <View style={styles.complianceSection}>
                    <Ionicons name="shield-checkmark" size={24} color={COLORS.primary} />
                    <Text style={styles.complianceText}>
                        All access requests are logged on-chain using zero-knowledge proofs for HIPAA compliance.
                    </Text>
                </View>

                {/* Quick Actions */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Quick Actions</Text>
                    <View style={styles.quickActions}>
                        <TouchableOpacity
                            style={styles.quickActionBtn}
                            onPress={() => router.push('/(clinician)/records')}
                            activeOpacity={0.7}
                        >
                            <Ionicons name="folder-open-outline" size={20} color={COLORS.primary} />
                            <Text style={styles.quickActionText}>View Records</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={styles.quickActionBtn}
                            onPress={() => router.push('/(clinician)/proofs')}
                            activeOpacity={0.7}
                        >
                            <Ionicons name="checkmark-done-outline" size={20} color={COLORS.primary} />
                            <Text style={styles.quickActionText}>Proof Status</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.quickActionBtn, styles.breakGlassBtn]}
                            onPress={() => router.push('/(clinician)/break-glass')}
                            activeOpacity={0.7}
                        >
                            <Ionicons name="flash-outline" size={20} color={COLORS.error} />
                            <Text style={[styles.quickActionText, { color: COLORS.error }]}>Break-Glass</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: COLORS.background,
    },
    scrollContent: {
        padding: SPACING.l,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: SPACING.xl,
    },
    greeting: {
        fontSize: 28,
        ...FONTS.bold,
        color: COLORS.text,
        letterSpacing: -0.5,
    },
    practitionerId: {
        fontSize: 14,
        color: COLORS.textSecondary,
        marginTop: SPACING.xs,
        ...FONTS.medium,
    },
    logoutButton: {
        padding: SPACING.s,
        backgroundColor: COLORS.surface,
        borderRadius: RADIUS.full,
        ...SHADOWS.small,
    },
    searchSection: {
        marginBottom: SPACING.xl,
    },
    sectionTitle: {
        fontSize: 18,
        ...FONTS.semibold,
        color: COLORS.text,
        marginBottom: SPACING.m,
    },
    sectionDescription: {
        fontSize: 14,
        color: COLORS.textSecondary,
        marginBottom: SPACING.m,
        lineHeight: 20,
        ...FONTS.regular,
    },
    searchInputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: COLORS.surface,
        borderRadius: RADIUS.m,
        paddingHorizontal: SPACING.m,
        ...SHADOWS.small,
    },
    searchIcon: {
        marginRight: SPACING.s,
    },
    searchInput: {
        flex: 1,
        height: 50,
        fontSize: 16,
        color: COLORS.text,
        ...FONTS.regular,
    },
    section: {
        marginBottom: SPACING.xl,
    },
    resourceGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: SPACING.m,
    },
    resourceCard: {
        width: '47%',
        backgroundColor: COLORS.surface,
        borderRadius: RADIUS.l,
        padding: SPACING.m,
        alignItems: 'center',
        ...SHADOWS.small,
    },
    resourceIcon: {
        width: 48,
        height: 48,
        borderRadius: RADIUS.full,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: SPACING.s,
    },
    resourceLabel: {
        fontSize: 14,
        ...FONTS.medium,
        color: COLORS.text,
        marginTop: SPACING.xs,
        textAlign: 'center',
    },
    complianceSection: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: COLORS.primaryLight,
        borderRadius: RADIUS.m,
        padding: SPACING.m,
        gap: SPACING.m,
    },
    complianceText: {
        flex: 1,
        fontSize: 13,
        color: COLORS.primaryDark,
        lineHeight: 18,
        ...FONTS.regular,
    },
    statusBanner: {
        marginVertical: SPACING.m,
        padding: SPACING.m,
        borderRadius: RADIUS.m,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },
    statusWaiting: {
        backgroundColor: COLORS.warningBg,
        borderWidth: 1,
        borderColor: COLORS.warning,
    },
    statusSuccess: {
        backgroundColor: COLORS.successBg,
        borderWidth: 1,
        borderColor: COLORS.success,
    },
    statusError: {
        backgroundColor: COLORS.errorBg,
        borderWidth: 1,
        borderColor: COLORS.error,
    },
    statusBannerText: {
        ...FONTS.semibold,
        fontSize: 14,
        color: COLORS.text,
    },
    quickActions: {
        flexDirection: 'row',
        gap: SPACING.m,
    },
    quickActionBtn: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: COLORS.surface,
        borderRadius: RADIUS.m,
        padding: SPACING.m,
        gap: SPACING.xs,
        ...SHADOWS.small,
    },
    quickActionText: {
        fontSize: 12,
        ...FONTS.medium,
        color: COLORS.primary,
    },
    breakGlassBtn: {
        backgroundColor: COLORS.errorBg,
        borderWidth: 1,
        borderColor: COLORS.error,
    },

});
