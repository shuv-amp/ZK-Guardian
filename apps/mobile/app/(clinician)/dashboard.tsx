import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView, ScrollView, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../hooks/useAuth';
import { config } from '../../config/env';

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
            <ScrollView contentContainerStyle={styles.scrollContent}>
                {/* Header */}
                <View style={styles.header}>
                    <View>
                        <Text style={styles.greeting}>Clinician Portal</Text>
                        <Text style={styles.practitionerId}>ID: {practitionerId}</Text>
                    </View>
                    <TouchableOpacity onPress={logout} style={styles.logoutButton}>
                        <Ionicons name="log-out-outline" size={24} color="#666" />
                    </TouchableOpacity>
                </View>

                {/* Patient Search */}
                <View style={styles.searchSection}>
                    <Text style={styles.sectionTitle}>Patient Lookup</Text>
                    <View style={styles.searchInputContainer}>
                        <Ionicons name="search" size={20} color="#666" style={styles.searchIcon} />
                        <TextInput
                            style={styles.searchInput}
                            placeholder="Enter Patient ID"
                            value={patientSearch}
                            onChangeText={setPatientSearch}
                            placeholderTextColor="#999"
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
                        >
                            <Ionicons name="flask" size={32} color="#2196F3" />
                            <Text style={styles.resourceLabel}>Lab Results</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={styles.resourceCard}
                            onPress={() => handleAccessRequest('DiagnosticReport')}
                            disabled={isLoading || !patientSearch}
                        >
                            <Ionicons name="image" size={32} color="#9C27B0" />
                            <Text style={styles.resourceLabel}>Imaging</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={styles.resourceCard}
                            onPress={() => handleAccessRequest('MedicationRequest')}
                            disabled={isLoading || !patientSearch}
                        >
                            <Ionicons name="medkit" size={32} color="#F44336" />
                            <Text style={styles.resourceLabel}>Medications</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={styles.resourceCard}
                            onPress={() => handleAccessRequest('Condition')}
                            disabled={isLoading || !patientSearch}
                        >
                            <Ionicons name="medical" size={32} color="#FF9800" />
                            <Text style={styles.resourceLabel}>Diagnoses</Text>
                        </TouchableOpacity>
                    </View>
                </View>

                {/* Compliance Notice */}
                <View style={styles.complianceSection}>
                    <Ionicons name="shield-checkmark" size={24} color="#1976D2" />
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
    practitionerId: {
        fontSize: 14,
        color: '#666',
        marginTop: 4,
    },
    logoutButton: {
        padding: 8,
    },
    searchSection: {
        marginBottom: 24,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: '#1A1A1A',
        marginBottom: 12,
    },
    sectionDescription: {
        fontSize: 14,
        color: '#666',
        marginBottom: 16,
        lineHeight: 20,
    },
    searchInputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFF',
        borderRadius: 12,
        paddingHorizontal: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    searchIcon: {
        marginRight: 12,
    },
    searchInput: {
        flex: 1,
        height: 50,
        fontSize: 16,
        color: '#1A1A1A',
    },
    section: {
        marginBottom: 24,
    },
    resourceGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 12,
    },
    resourceCard: {
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
    resourceLabel: {
        fontSize: 14,
        fontWeight: '500',
        color: '#1A1A1A',
        marginTop: 12,
        textAlign: 'center',
    },
    complianceSection: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#E3F2FD',
        borderRadius: 12,
        padding: 16,
        gap: 12,
    },
    complianceText: {
        flex: 1,
        fontSize: 13,
        color: '#1565C0',
        lineHeight: 18,
    },
});
