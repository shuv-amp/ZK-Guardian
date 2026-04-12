import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '../../hooks/useAuth';
import { COLORS, FONTS, SPACING, RADIUS, SHADOWS } from '../../constants/Theme';
import { useConsentContext } from '../../hooks/ConsentProvider';

/**
 * Patient Dashboard
 * 
 * Displays consent history, connection status, and quick actions for patients.
 * WebSocket connection is now managed centrally by useAuth - no need to connect here.
 */
export default function PatientDashboard() {
    const { patientId, logout, connectionState } = useAuth();
    const { pendingRequests, openConsentRequest } = useConsentContext();
    const router = useRouter();
    const pendingPreview = useMemo(() => pendingRequests.slice(0, 3), [pendingRequests]);

    const getConnectionColor = () => {
        switch (connectionState) {
            case 'connected': return COLORS.success;
            case 'connecting': return COLORS.warning;
            case 'error': return COLORS.error;
            default: return COLORS.textLight;
        }
    };

    const getConnectionText = () => {
        switch (connectionState) {
            case 'connected': return 'Connected';
            case 'connecting': return 'Connecting...';
            case 'error': return 'Connection Error';
            default: return 'Disconnected';
        }
    };

    const handleReviewRequest = (requestId: string) => {
        openConsentRequest(requestId);
    };

    return (
        <SafeAreaView style={styles.container}>

            <ScrollView contentContainerStyle={styles.scrollContent}>
                {/* Header */}
                <View style={styles.header}>
                    <View>
                        <Text style={styles.greeting}>Welcome back</Text>
                        <Text style={styles.patientId}>Patient ID: {patientId}</Text>
                    </View>
                    <TouchableOpacity onPress={logout} style={styles.logoutButton}>
                        <Ionicons name="log-out-outline" size={24} color={COLORS.textSecondary} />
                    </TouchableOpacity>
                </View>

                {/* Connection Status */}
                <View style={styles.statusCard}>
                    <View style={styles.statusRow}>
                        <View style={[styles.statusDot, { backgroundColor: getConnectionColor() }]} />
                        <Text style={styles.statusText}>{getConnectionText()}</Text>
                    </View>
                    <Text style={styles.statusDescription}>
                        {connectionState === 'connected'
                            ? 'You will receive real-time consent requests from clinicians'
                            : 'Consent requests will be queued until reconnection'}
                    </Text>
                </View>

                {/* Quick Actions */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Quick Actions</Text>
                    <View style={styles.actionsGrid}>
                        <TouchableOpacity
                            style={styles.actionCard}
                            activeOpacity={0.7}
                            onPress={() => router.push('/(patient)/access-history')}
                        >
                            <View style={[styles.actionIcon, { backgroundColor: COLORS.primaryLight }]}>
                                <Ionicons name="time-outline" size={24} color={COLORS.primary} />
                            </View>
                            <Text style={styles.actionLabel}>Access History</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={styles.actionCard}
                            activeOpacity={0.7}
                            onPress={() => router.push('/(patient)/consents')}
                        >
                            <View style={[styles.actionIcon, { backgroundColor: COLORS.successBg }]}>
                                <Ionicons name="document-text-outline" size={24} color={COLORS.success} />
                            </View>
                            <Text style={styles.actionLabel}>My Consents</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={styles.actionCard}
                            activeOpacity={0.7}
                            onPress={() => router.push('/(patient)/consents')}
                        >
                            <View style={[styles.actionIcon, { backgroundColor: COLORS.errorBg }]}>
                                <Ionicons name="ban-outline" size={24} color={COLORS.error} />
                            </View>
                            <Text style={styles.actionLabel}>Revoke Access</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={styles.actionCard}
                            activeOpacity={0.7}
                            onPress={() => router.push('/(patient)/settings')}
                        >
                            <View style={[styles.actionIcon, { backgroundColor: COLORS.infoBg }]}>
                                <Ionicons name="settings-outline" size={24} color={COLORS.info} />
                            </View>
                            <Text style={styles.actionLabel}>Settings</Text>
                        </TouchableOpacity>
                    </View>
                </View>

                {pendingRequests.length > 0 && (
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Pending Requests</Text>
                        <View style={styles.pendingCard}>
                            <View style={styles.pendingHeader}>
                                <Text style={styles.pendingTitle}>Consent Needed</Text>
                                <View style={styles.pendingCountBadge}>
                                    <Text style={styles.pendingCountText}>{pendingRequests.length}</Text>
                                </View>
                            </View>
                            <View style={styles.pendingList}>
                                {pendingPreview.map((request) => (
                                    <View key={request.requestId} style={styles.pendingRow}>
                                        <View style={styles.pendingRowIcon}>
                                            <Ionicons name="person-circle" size={24} color={COLORS.primary} />
                                        </View>
                                        <View style={styles.pendingRowContent}>
                                            <Text style={styles.pendingRowTitle}>
                                                {request.clinicianName || request.details.practitioner}
                                            </Text>
                                            <Text style={styles.pendingRowSubtitle}>
                                                {request.resourceTypes?.[0] || request.details.resourceType}
                                            </Text>
                                        </View>
                                        <TouchableOpacity
                                            style={styles.pendingRowButton}
                                            onPress={() => handleReviewRequest(request.requestId)}
                                        >
                                            <Text style={styles.pendingRowButtonText}>Review</Text>
                                        </TouchableOpacity>
                                    </View>
                                ))}
                            </View>
                            {pendingRequests.length > 3 && (
                                <Text style={styles.pendingFooterText}>
                                    {pendingRequests.length - 3} more pending request(s)
                                </Text>
                            )}
                        </View>
                    </View>
                )}

                {/* Privacy Shield */}
                <View style={styles.privacySection}>
                    <View style={styles.privacyIconContainer}>
                        <Ionicons name="shield-checkmark" size={32} color={COLORS.success} />
                    </View>
                    <View style={styles.privacyContent}>
                        <Text style={styles.privacyTitle}>Your Privacy is Protected</Text>
                        <Text style={styles.privacyText}>
                            All access requests are verified using zero-knowledge proofs.
                            Your personal data never leaves your control.
                        </Text>
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
    patientId: {
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
    statusCard: {
        backgroundColor: COLORS.surface,
        borderRadius: RADIUS.l,
        padding: SPACING.l,
        marginBottom: SPACING.xl,
        ...SHADOWS.small,
        borderLeftWidth: 4,
        borderLeftColor: COLORS.primary,
    },
    statusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: SPACING.s,
    },
    statusDot: {
        width: 10,
        height: 10,
        borderRadius: RADIUS.full,
        marginRight: SPACING.s,
    },
    statusText: {
        fontSize: 16,
        ...FONTS.semibold,
        color: COLORS.text,
    },
    statusDescription: {
        fontSize: 14,
        color: COLORS.textSecondary,
        lineHeight: 20,
        ...FONTS.regular,
    },
    section: {
        marginBottom: SPACING.xl,
    },
    sectionTitle: {
        fontSize: 18,
        ...FONTS.semibold,
        color: COLORS.text,
        marginBottom: SPACING.m,
    },
    actionsGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: SPACING.m,
    },
    actionCard: {
        width: '47%',
        backgroundColor: COLORS.surface,
        borderRadius: RADIUS.l,
        padding: SPACING.m,
        alignItems: 'center',
        ...SHADOWS.small,
    },
    actionIcon: {
        width: 48,
        height: 48,
        borderRadius: RADIUS.full,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: SPACING.s,
    },
    actionLabel: {
        fontSize: 14,
        ...FONTS.medium,
        color: COLORS.text,
        marginTop: SPACING.xs,
        textAlign: 'center',
    },
    privacySection: {
        backgroundColor: COLORS.successBg,
        borderRadius: RADIUS.l,
        padding: SPACING.l,
        flexDirection: 'row',
        alignItems: 'flex-start',
        borderWidth: 1,
        borderColor: 'rgba(76, 175, 80, 0.2)',
    },
    privacyIconContainer: {
        marginRight: SPACING.m,
        marginTop: SPACING.xs,
    },
    privacyContent: {
        flex: 1,
    },
    privacyTitle: {
        fontSize: 16,
        ...FONTS.semibold,
        color: COLORS.success,
        marginBottom: SPACING.xs,
    },
    privacyText: {
        fontSize: 13,
        color: COLORS.textSecondary,
        lineHeight: 18,
        ...FONTS.regular,
    },
    pendingCard: {
        backgroundColor: COLORS.surface,
        borderRadius: RADIUS.l,
        padding: SPACING.l,
        ...SHADOWS.small,
        borderWidth: 1,
        borderColor: COLORS.border,
    },
    pendingHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: SPACING.m,
    },
    pendingTitle: {
        fontSize: 16,
        ...FONTS.semibold,
        color: COLORS.text,
    },
    pendingCountBadge: {
        backgroundColor: COLORS.warningBg,
        paddingHorizontal: SPACING.s,
        paddingVertical: 2,
        borderRadius: RADIUS.full,
    },
    pendingCountText: {
        fontSize: 12,
        ...FONTS.semibold,
        color: COLORS.warning,
    },
    pendingList: {
        gap: SPACING.s,
    },
    pendingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: SPACING.s,
        borderRadius: RADIUS.m,
        backgroundColor: COLORS.background,
    },
    pendingRowIcon: {
        marginRight: SPACING.s,
    },
    pendingRowContent: {
        flex: 1,
    },
    pendingRowTitle: {
        fontSize: 14,
        ...FONTS.medium,
        color: COLORS.text,
    },
    pendingRowSubtitle: {
        fontSize: 12,
        color: COLORS.textSecondary,
        marginTop: 2,
        ...FONTS.regular,
    },
    pendingRowButton: {
        backgroundColor: COLORS.primary,
        paddingHorizontal: SPACING.m,
        paddingVertical: 6,
        borderRadius: RADIUS.full,
    },
    pendingRowButtonText: {
        fontSize: 12,
        ...FONTS.semibold,
        color: COLORS.surface,
    },
    pendingFooterText: {
        marginTop: SPACING.s,
        fontSize: 12,
        color: COLORS.textSecondary,
        textAlign: 'center',
        ...FONTS.regular,
    },
});
