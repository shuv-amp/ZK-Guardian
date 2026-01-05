import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView, ScrollView, StatusBar } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../hooks/useAuth';
import { COLORS, FONTS, SPACING, RADIUS, SHADOWS } from '../../constants/Theme';

/**
 * Patient Dashboard
 * 
 * Displays consent history, connection status, and quick actions for patients.
 */
export default function PatientDashboard() {
    const { patientId, logout, connectionState } = useAuth();

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

    return (
        <SafeAreaView style={styles.container}>
            <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />
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
                        <TouchableOpacity style={styles.actionCard} activeOpacity={0.7}>
                            <View style={[styles.actionIcon, { backgroundColor: COLORS.primaryLight }]}>
                                <Ionicons name="time-outline" size={24} color={COLORS.primary} />
                            </View>
                            <Text style={styles.actionLabel}>Access History</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.actionCard} activeOpacity={0.7}>
                            <View style={[styles.actionIcon, { backgroundColor: COLORS.successBg }]}>
                                <Ionicons name="document-text-outline" size={24} color={COLORS.success} />
                            </View>
                            <Text style={styles.actionLabel}>My Consents</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.actionCard} activeOpacity={0.7}>
                            <View style={[styles.actionIcon, { backgroundColor: COLORS.errorBg }]}>
                                <Ionicons name="ban-outline" size={24} color={COLORS.error} />
                            </View>
                            <Text style={styles.actionLabel}>Revoke Access</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.actionCard} activeOpacity={0.7}>
                            <View style={[styles.actionIcon, { backgroundColor: COLORS.infoBg }]}>
                                <Ionicons name="settings-outline" size={24} color={COLORS.info} />
                            </View>
                            <Text style={styles.actionLabel}>Settings</Text>
                        </TouchableOpacity>
                    </View>
                </View>

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
});
