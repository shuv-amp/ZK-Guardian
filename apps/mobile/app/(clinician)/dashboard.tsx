import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView, ScrollView, TextInput, StatusBar } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../hooks/useAuth';
import { config } from '../../config/env';
import { COLORS, FONTS, SPACING, RADIUS, SHADOWS } from '../../constants/Theme';

/**
 * Clinician Dashboard
 * 
 * Interface for clinicians to request patient data access.
 */
export default function ClinicianDashboard() {
    const { practitionerId, logout } = useAuth();
    const [patientSearch, setPatientSearch] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const handleAccessRequest = async (resourceType: string) => {
        if (!patientSearch.trim()) return;

        setIsLoading(true);
        try {
            const response = await fetch(`${config.GATEWAY_URL}/fhir/${resourceType}?patient=${patientSearch}`, {
                headers: {
                    'Authorization': `Bearer ${await getAccessToken()}`,
                },
            });

            if (response.ok) {
                // Handle successful access
                console.log('Access granted');
            } else if (response.status === 403) {
                // Handle consent required/denied
                console.log('Consent required or denied');
            }
        } catch (error) {
            console.error('Access request failed:', error);
        }
        setIsLoading(false);
    };

    // Placeholder - would come from auth service
    const getAccessToken = async () => 'mock-token';

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
});
