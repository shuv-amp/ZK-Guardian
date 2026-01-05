import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../hooks/useAuth';

/**
 * Patient Dashboard
 * 
 * Displays consent history, connection status, and quick actions for patients.
 */
export default function PatientDashboard() {
    const { patientId, logout, connectionState } = useAuth();

    const getConnectionColor = () => {
        switch (connectionState) {
            case 'connected': return '#4CAF50';
            case 'connecting': return '#FF9800';
            case 'error': return '#F44336';
            default: return '#9E9E9E';
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
            <ScrollView contentContainerStyle={styles.scrollContent}>
                {/* Header */}
                <View style={styles.header}>
                    <View>
                        <Text style={styles.greeting}>Welcome back</Text>
                        <Text style={styles.patientId}>Patient ID: {patientId}</Text>
                    </View>
                    <TouchableOpacity onPress={logout} style={styles.logoutButton}>
                        <Ionicons name="log-out-outline" size={24} color="#666" />
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
                        <TouchableOpacity style={styles.actionCard}>
                            <Ionicons name="time-outline" size={32} color="#2196F3" />
                            <Text style={styles.actionLabel}>Access History</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.actionCard}>
                            <Ionicons name="document-text-outline" size={32} color="#4CAF50" />
                            <Text style={styles.actionLabel}>My Consents</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.actionCard}>
                            <Ionicons name="ban-outline" size={32} color="#F44336" />
                            <Text style={styles.actionLabel}>Revoke Access</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.actionCard}>
                            <Ionicons name="settings-outline" size={32} color="#9C27B0" />
                            <Text style={styles.actionLabel}>Settings</Text>
                        </TouchableOpacity>
                    </View>
                </View>

                {/* Privacy Shield */}
                <View style={styles.privacySection}>
                    <Ionicons name="shield-checkmark" size={48} color="#4CAF50" />
                    <Text style={styles.privacyTitle}>Your Privacy is Protected</Text>
                    <Text style={styles.privacyText}>
                        All access requests are verified using zero-knowledge proofs.
                        Your personal data never leaves your control.
                    </Text>
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F5F7FA',
    },
    scrollContent: {
        padding: 20,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 24,
    },
    greeting: {
        fontSize: 28,
        fontWeight: '700',
        color: '#1A1A1A',
    },
    patientId: {
        fontSize: 14,
        color: '#666',
        marginTop: 4,
    },
    logoutButton: {
        padding: 8,
    },
    statusCard: {
        backgroundColor: '#FFF',
        borderRadius: 16,
        padding: 20,
        marginBottom: 24,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    statusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
    },
    statusDot: {
        width: 12,
        height: 12,
        borderRadius: 6,
        marginRight: 8,
    },
    statusText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#1A1A1A',
    },
    statusDescription: {
        fontSize: 14,
        color: '#666',
        lineHeight: 20,
    },
    section: {
        marginBottom: 24,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: '#1A1A1A',
        marginBottom: 16,
    },
    actionsGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 12,
    },
    actionCard: {
        width: '47%',
        backgroundColor: '#FFF',
        borderRadius: 16,
        padding: 20,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    actionLabel: {
        fontSize: 14,
        fontWeight: '500',
        color: '#1A1A1A',
        marginTop: 12,
        textAlign: 'center',
    },
    privacySection: {
        backgroundColor: '#E8F5E9',
        borderRadius: 16,
        padding: 24,
        alignItems: 'center',
    },
    privacyTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: '#2E7D32',
        marginTop: 12,
        marginBottom: 8,
    },
    privacyText: {
        fontSize: 14,
        color: '#558B2F',
        textAlign: 'center',
        lineHeight: 20,
    },
});
