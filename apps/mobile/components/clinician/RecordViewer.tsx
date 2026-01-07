import React, { useState, useCallback } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    ActivityIndicator,
    RefreshControl
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FHIRResource } from '../../services/fhirClient';
import Card from '../shared/Card';

/**
 * RecordViewer Component
 * 
 * Displays FHIR resources for clinician review.
 * Per Development Guide §1.
 */

export interface RecordViewerProps {
    patientId: string;
    patientName?: string;
    resources: FHIRResource[];
    isLoading?: boolean;
    onRefresh?: () => Promise<void>;
    onResourcePress?: (resource: FHIRResource) => void;
}

export function RecordViewer({
    patientId,
    patientName,
    resources,
    isLoading = false,
    onRefresh,
    onResourcePress
}: RecordViewerProps) {
    const [refreshing, setRefreshing] = useState(false);

    const handleRefresh = useCallback(async () => {
        if (!onRefresh) return;
        setRefreshing(true);
        await onRefresh();
        setRefreshing(false);
    }, [onRefresh]);

    // Group resources by type
    const groupedResources = resources.reduce((acc, resource) => {
        const type = resource.resourceType;
        if (!acc[type]) {
            acc[type] = [];
        }
        acc[type].push(resource);
        return acc;
    }, {} as Record<string, FHIRResource[]>);

    const resourceTypes = Object.keys(groupedResources).sort();

    if (isLoading && resources.length === 0) {
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#007AFF" />
                <Text style={styles.loadingText}>Loading records...</Text>
            </View>
        );
    }

    return (
        <ScrollView
            style={styles.container}
            refreshControl={
                onRefresh ? (
                    <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
                ) : undefined
            }
        >
            {/* Patient Header */}
            <View style={styles.patientHeader}>
                <Ionicons name="person-circle-outline" size={32} color="#007AFF" />
                <View style={styles.patientInfo}>
                    <Text style={styles.patientName}>{patientName || 'Patient'}</Text>
                    <Text style={styles.patientId}>ID: {patientId}</Text>
                </View>
            </View>

            {/* Resource Sections */}
            {resourceTypes.length === 0 ? (
                <View style={styles.emptyState}>
                    <Ionicons name="document-outline" size={48} color="#CCC" />
                    <Text style={styles.emptyText}>No records found</Text>
                </View>
            ) : (
                resourceTypes.map(type => (
                    <View key={type} style={styles.section}>
                        <View style={styles.sectionHeader}>
                            <Ionicons
                                name={getResourceIcon(type)}
                                size={20}
                                color="#007AFF"
                            />
                            <Text style={styles.sectionTitle}>{type}</Text>
                            <View style={styles.countBadge}>
                                <Text style={styles.countText}>
                                    {groupedResources[type].length}
                                </Text>
                            </View>
                        </View>

                        {groupedResources[type].map(resource => (
                            <ResourceCard
                                key={resource.id}
                                resource={resource}
                                onPress={() => onResourcePress?.(resource)}
                            />
                        ))}
                    </View>
                ))
            )}

            {/* Audit Notice */}
            <View style={styles.auditNotice}>
                <Ionicons name="shield-checkmark" size={16} color="#34C759" />
                <Text style={styles.auditText}>
                    All access is recorded on the audit log
                </Text>
            </View>
        </ScrollView>
    );
}

interface ResourceCardProps {
    resource: FHIRResource;
    onPress?: () => void;
}

function ResourceCard({ resource, onPress }: ResourceCardProps) {
    const summary = getResourceSummary(resource);

    return (
        <TouchableOpacity
            style={styles.resourceCard}
            onPress={onPress}
            disabled={!onPress}
        >
            <View style={styles.resourceContent}>
                <Text style={styles.resourceTitle}>{summary.title}</Text>
                {summary.subtitle && (
                    <Text style={styles.resourceSubtitle}>{summary.subtitle}</Text>
                )}
                {summary.date && (
                    <Text style={styles.resourceDate}>{summary.date}</Text>
                )}
            </View>
            {onPress && (
                <Ionicons name="chevron-forward" size={20} color="#CCC" />
            )}
        </TouchableOpacity>
    );
}

function getResourceIcon(type: string): keyof typeof Ionicons.glyphMap {
    const icons: Record<string, keyof typeof Ionicons.glyphMap> = {
        Observation: 'pulse-outline',
        Condition: 'medkit-outline',
        Medication: 'medical-outline',
        MedicationRequest: 'document-text-outline',
        Procedure: 'cut-outline',
        DiagnosticReport: 'analytics-outline',
        Immunization: 'shield-outline',
        AllergyIntolerance: 'warning-outline',
        CarePlan: 'clipboard-outline',
        Encounter: 'calendar-outline',
        DocumentReference: 'folder-outline'
    };
    return icons[type] || 'document-outline';
}

function getResourceSummary(resource: FHIRResource): {
    title: string;
    subtitle?: string;
    date?: string;
} {
    const type = resource.resourceType;

    switch (type) {
        case 'Observation':
            return {
                title: resource.code?.text || resource.code?.coding?.[0]?.display || 'Observation',
                subtitle: resource.valueQuantity
                    ? `${resource.valueQuantity.value} ${resource.valueQuantity.unit}`
                    : resource.valueString,
                date: formatResourceDate(resource.effectiveDateTime)
            };

        case 'Condition':
            return {
                title: resource.code?.text || resource.code?.coding?.[0]?.display || 'Condition',
                subtitle: resource.clinicalStatus?.coding?.[0]?.code,
                date: formatResourceDate(resource.onsetDateTime || resource.recordedDate)
            };

        case 'MedicationRequest':
            return {
                title: resource.medicationCodeableConcept?.text
                    || resource.medicationCodeableConcept?.coding?.[0]?.display
                    || 'Medication',
                subtitle: resource.dosageInstruction?.[0]?.text,
                date: formatResourceDate(resource.authoredOn)
            };

        case 'Procedure':
            return {
                title: resource.code?.text || resource.code?.coding?.[0]?.display || 'Procedure',
                subtitle: resource.status,
                date: formatResourceDate(resource.performedDateTime)
            };

        case 'DiagnosticReport':
            return {
                title: resource.code?.text || resource.code?.coding?.[0]?.display || 'Report',
                subtitle: resource.status,
                date: formatResourceDate(resource.effectiveDateTime || resource.issued)
            };

        default:
            return {
                title: resource.id || type,
                date: formatResourceDate(resource.meta?.lastUpdated)
            };
    }
}

function formatResourceDate(dateStr?: string): string | undefined {
    if (!dateStr) return undefined;

    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F8F8F8'
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 40
    },
    loadingText: {
        marginTop: 12,
        fontSize: 14,
        color: '#666'
    },
    patientHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        backgroundColor: '#FFF',
        borderBottomWidth: 1,
        borderBottomColor: '#F0F0F0'
    },
    patientInfo: {
        marginLeft: 12
    },
    patientName: {
        fontSize: 18,
        fontWeight: '600',
        color: '#1A1A1A'
    },
    patientId: {
        fontSize: 12,
        color: '#666',
        marginTop: 2
    },
    emptyState: {
        alignItems: 'center',
        padding: 40
    },
    emptyText: {
        marginTop: 12,
        fontSize: 14,
        color: '#999'
    },
    section: {
        marginTop: 16
    },
    sectionHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        marginBottom: 8,
        gap: 8
    },
    sectionTitle: {
        flex: 1,
        fontSize: 14,
        fontWeight: '600',
        color: '#666'
    },
    countBadge: {
        backgroundColor: '#F0F0F0',
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 10
    },
    countText: {
        fontSize: 12,
        fontWeight: '500',
        color: '#666'
    },
    resourceCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFF',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#F0F0F0'
    },
    resourceContent: {
        flex: 1
    },
    resourceTitle: {
        fontSize: 15,
        fontWeight: '500',
        color: '#1A1A1A'
    },
    resourceSubtitle: {
        fontSize: 13,
        color: '#666',
        marginTop: 2
    },
    resourceDate: {
        fontSize: 12,
        color: '#999',
        marginTop: 4
    },
    auditNotice: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        marginTop: 16,
        gap: 6
    },
    auditText: {
        fontSize: 12,
        color: '#34C759'
    }
});

export default RecordViewer;
