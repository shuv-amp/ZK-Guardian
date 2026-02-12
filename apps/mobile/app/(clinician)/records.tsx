import React, { useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TextInput,
    TouchableOpacity,
    FlatList,
    ActivityIndicator,
    StatusBar
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../hooks/useAuth';
import { config } from '../../config/env';
import { authorizedFetch, APIError } from '../../services/API';
import { mapAccessErrorMessage, parseGatewayError } from '../../services/gatewayError';
import { COLORS, FONTS, SPACING, RADIUS, SHADOWS } from '../../constants/Theme';

/**
 * Records Screen (Clinician)
 * 
 * Allows clinicians to search and view patient FHIR resources.
 */

interface FHIRResource {
    resourceType: string;
    id: string;
    meta?: {
        lastUpdated: string;
    };
    category?: Array<{ coding: Array<{ display: string }> }>;
    code?: { coding: Array<{ display: string }> };
    status?: string;
    effectiveDateTime?: string;
    valueQuantity?: { value: number; unit: string };
}

const RESOURCE_TYPES = [
    { key: 'Observation', label: 'Lab Results', icon: 'flask-outline' },
    { key: 'MedicationRequest', label: 'Medications', icon: 'medical-outline' },
    { key: 'Condition', label: 'Conditions', icon: 'fitness-outline' },
    { key: 'DiagnosticReport', label: 'Reports', icon: 'document-text-outline' },
    { key: 'Encounter', label: 'Visits', icon: 'calendar-outline' },
];

export default function RecordsScreen() {
    const { logout, practitionerId } = useAuth();
    const [patientId, setPatientId] = useState('');
    const [selectedType, setSelectedType] = useState('Observation');
    const [resources, setResources] = useState<FHIRResource[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [zkProofHash, setZkProofHash] = useState<string | null>(null);
    const [consentStatus, setConsentStatus] = useState<'unknown' | 'active' | 'expired' | 'none'>('unknown');
    const [consentExpiresAt, setConsentExpiresAt] = useState<string | null>(null);
    const [isCheckingConsent, setIsCheckingConsent] = useState(false);

    React.useEffect(() => {
        let isCancelled = false;

        const fetchConsentStatus = async () => {
            const trimmedPatientId = patientId.trim();
            if (!trimmedPatientId) {
                setConsentStatus('unknown');
                setConsentExpiresAt(null);
                return;
            }

            setIsCheckingConsent(true);

            try {
                const params = new URLSearchParams({ status: 'active', limit: '50' });
                const response = await authorizedFetch(
                    `${config.GATEWAY_URL}/api/patient/${trimmedPatientId}/consents?${params.toString()}`
                );

                if (!response.ok) {
                    throw new Error('Consent lookup failed');
                }

                const data = await response.json();
                const consents = Array.isArray(data.consents) ? data.consents : [];
                const matchingConsent = consents.find((consent: any) => {
                    const ref = consent?.grantedTo?.reference;
                    return ref === practitionerId || ref === `Practitioner/${practitionerId}`;
                });

                if (!matchingConsent) {
                    if (!isCancelled) {
                        setConsentStatus('none');
                        setConsentExpiresAt(null);
                    }
                    return;
                }

                const end = matchingConsent?.validPeriod?.end;
                const expiresAt = end ? new Date(end) : null;

                if (!isCancelled) {
                    if (expiresAt && expiresAt.getTime() <= Date.now()) {
                        setConsentStatus('expired');
                    } else {
                        setConsentStatus('active');
                    }
                    setConsentExpiresAt(end || null);
                }
            } catch (err: any) {
                if (err instanceof APIError && err.status === 401) {
                    await logout();
                }
                if (!isCancelled) {
                    setConsentStatus('unknown');
                    setConsentExpiresAt(null);
                }
            } finally {
                if (!isCancelled) {
                    setIsCheckingConsent(false);
                }
            }
        };

        fetchConsentStatus();

        return () => {
            isCancelled = true;
        };
    }, [patientId, practitionerId, logout]);

    const searchResources = async () => {
        const trimmedPatientId = patientId.trim();
        if (!trimmedPatientId) {
            setError('Please enter a patient ID');
            return;
        }

        setIsLoading(true);
        setError(null);
        setZkProofHash(null);
        setResources([]);

        try {
            const response = await authorizedFetch(
                `${config.GATEWAY_URL}/fhir/${selectedType}?patient=${trimmedPatientId}`
            );

            // Capture ZK proof hash from response headers
            const proofHash = response.headers.get('X-ZK-Audit-Hash');
            if (proofHash) {
                setZkProofHash(proofHash);
            }

            if (response.ok) {
                const bundle = await response.json();
                const entries = bundle.entry?.map((e: any) => e.resource) || [];
                setResources(entries);
            } else {
                const { code, message } = await parseGatewayError(response);
                setError(mapAccessErrorMessage(code, message));
            }
        } catch (err: any) {
             if (err instanceof APIError && err.status === 401) {
                await logout();
                setError('Session expired. Please sign in again.');
             } else {
                setError('Network error. Please check connection.');
             }
        } finally {
            setIsLoading(false);
        }
    };

    const formatDate = (dateStr?: string) => {
        if (!dateStr) return 'N/A';
        return new Date(dateStr).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
    };

    const getResourceDisplay = (resource: FHIRResource) => {
        if (resource.code?.coding?.[0]?.display) {
            return resource.code.coding[0].display;
        }
        if (resource.category?.[0]?.coding?.[0]?.display) {
            return resource.category[0].coding[0].display;
        }
        return resource.resourceType;
    };

    const renderResourceCard = ({ item }: { item: FHIRResource }) => (
        <View style={styles.resourceCard}>
            <View style={styles.cardHeader}>
                <Text style={styles.resourceTitle}>{getResourceDisplay(item)}</Text>
                <View style={[styles.statusBadge,
                item.status === 'final' || item.status === 'completed'
                    ? styles.statusFinal
                    : styles.statusPending
                ]}>
                    <Text style={[styles.statusText, 
                        item.status === 'final' || item.status === 'completed' 
                        ? { color: COLORS.success } 
                        : { color: COLORS.warning }
                    ]}>{item.status || 'N/A'}</Text>
                </View>
            </View>

            <View style={styles.cardDetails}>
                <View style={styles.detailRow}>
                    <Ionicons name="calendar-outline" size={14} color={COLORS.textSecondary} />
                    <Text style={styles.detailText}>
                        {formatDate(item.effectiveDateTime || item.meta?.lastUpdated)}
                    </Text>
                </View>

                {item.valueQuantity && (
                    <View style={styles.detailRow}>
                        <Ionicons name="analytics-outline" size={14} color={COLORS.textSecondary} />
                        <Text style={styles.detailText}>
                            {item.valueQuantity.value} {item.valueQuantity.unit}
                        </Text>
                    </View>
                )}
            </View>

            <Text style={styles.resourceId}>ID: {item.id}</Text>
        </View>
    );

    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />
            <View style={styles.header}>
                <Text style={styles.title}>Patient Records</Text>
                <Text style={styles.subtitle}>Search FHIR resources</Text>
            </View>

            {/* Search Bar */}
            <View style={styles.searchSection}>
                <View style={styles.inputRow}>
                    <Ionicons name="search" size={20} color={COLORS.textTertiary} style={styles.searchIcon} />
                    <TextInput
                        style={styles.input}
                        placeholder="Enter Patient ID..."
                        value={patientId}
                        onChangeText={setPatientId}
                        placeholderTextColor={COLORS.textTertiary}
                        autoCapitalize="none"
                    />
                    <TouchableOpacity
                        style={styles.searchButton}
                        onPress={searchResources}
                        disabled={isLoading}
                    >
                        {isLoading ? (
                            <ActivityIndicator color={COLORS.surface} size="small" />
                        ) : (
                            <Text style={styles.searchButtonText}>Search</Text>
                        )}
                    </TouchableOpacity>
                </View>
                {patientId.trim().length > 0 && (
                    <View
                        style={[
                            styles.consentStatus,
                            consentStatus === 'active' && styles.consentActive,
                            consentStatus === 'expired' && styles.consentExpired,
                            consentStatus === 'none' && styles.consentMissing
                        ]}
                    >
                        <Ionicons
                            name={
                                isCheckingConsent
                                    ? 'time-outline'
                                    : consentStatus === 'active'
                                        ? 'checkmark-circle'
                                        : consentStatus === 'expired'
                                            ? 'time'
                                            : 'alert-circle'
                            }
                            size={16}
                            color={
                                consentStatus === 'active'
                                    ? COLORS.success
                                    : consentStatus === 'expired'
                                        ? COLORS.warning
                                        : COLORS.error
                            }
                        />
                        <Text style={styles.consentStatusText}>
                            {isCheckingConsent && 'Checking consent...'}
                            {!isCheckingConsent && consentStatus === 'active' && `Consent active${consentExpiresAt ? ` (expires ${new Date(consentExpiresAt).toLocaleDateString()})` : ''}`}
                            {!isCheckingConsent && consentStatus === 'expired' && 'Consent expired'}
                            {!isCheckingConsent && consentStatus === 'none' && 'No active consent'}
                            {!isCheckingConsent && consentStatus === 'unknown' && 'Consent status unavailable'}
                        </Text>
                    </View>
                )}
            </View>

            {/* Resource Type Tabs */}
            <View style={styles.tabsContainer}>
                <FlatList
                    horizontal
                    data={RESOURCE_TYPES}
                    renderItem={({ item }) => (
                        <TouchableOpacity
                            style={[styles.tab, selectedType === item.key && styles.tabActive]}
                            onPress={() => setSelectedType(item.key)}
                        >
                            <Ionicons
                                name={item.icon as any}
                                size={16}
                                color={selectedType === item.key ? COLORS.surface : COLORS.textSecondary}
                            />
                            <Text style={[
                                styles.tabText,
                                selectedType === item.key && styles.tabTextActive
                            ]}>
                                {item.label}
                            </Text>
                        </TouchableOpacity>
                    )}
                    keyExtractor={(item) => item.key}
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.tabsList}
                />
            </View>

            {/* ZK Proof Banner */}
            {zkProofHash && (
                <View style={styles.proofBanner}>
                    <Ionicons name="shield-checkmark" size={18} color={COLORS.success} />
                    <Text style={styles.proofText}>Access verified on-chain</Text>
                    <Text style={styles.proofHash}>{zkProofHash.slice(0, 10)}...</Text>
                </View>
            )}

            {/* Error State */}
            {error && (
                <View style={styles.errorBanner}>
                    <Ionicons name="alert-circle" size={20} color={COLORS.error} />
                    <Text style={styles.errorText}>{error}</Text>
                </View>
            )}

            {/* Results */}
            <FlatList
                data={resources}
                renderItem={renderResourceCard}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.listContent}
                ListEmptyComponent={
                    !isLoading && !error ? (
                        <View style={styles.emptyState}>
                            <Ionicons name="folder-open-outline" size={64} color={COLORS.gray200} />
                            <Text style={styles.emptyText}>No records found</Text>
                            <Text style={styles.emptySubtext}>
                                Search for a patient to view their records
                            </Text>
                        </View>
                    ) : null
                }
            />
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: COLORS.background,
    },
    header: {
        padding: SPACING.lg,
        backgroundColor: COLORS.surface,
        borderBottomWidth: 1,
        borderBottomColor: COLORS.border,
    },
    title: {
        fontSize: FONTS.sizes.xl,
        fontWeight: FONTS.weights.bold,
        color: COLORS.text,
    },
    subtitle: {
        fontSize: FONTS.sizes.sm,
        color: COLORS.textSecondary,
        marginTop: 4,
    },
    searchSection: {
        padding: SPACING.md,
        backgroundColor: COLORS.surface,
    },
    consentStatus: {
        marginTop: SPACING.sm,
        flexDirection: 'row',
        alignItems: 'center',
        gap: SPACING.xs,
        paddingVertical: SPACING.xs,
        paddingHorizontal: SPACING.sm,
        borderRadius: RADIUS.sm,
        backgroundColor: COLORS.surface,
        borderWidth: 1,
        borderColor: COLORS.border,
    },
    consentActive: {
        backgroundColor: COLORS.successBg,
        borderColor: COLORS.success,
    },
    consentExpired: {
        backgroundColor: COLORS.warningBg,
        borderColor: COLORS.warning,
    },
    consentMissing: {
        backgroundColor: COLORS.errorBg,
        borderColor: COLORS.error,
    },
    consentStatusText: {
        fontSize: FONTS.sizes.sm,
        color: COLORS.textSecondary,
        fontWeight: FONTS.weights.medium,
    },
    inputRow: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: COLORS.gray100,
        borderRadius: RADIUS.md,
        paddingHorizontal: SPACING.md,
    },
    searchIcon: {
        marginRight: SPACING.sm,
    },
    input: {
        flex: 1,
        height: 48,
        fontSize: FONTS.sizes.md,
        color: COLORS.text,
    },
    searchButton: {
        backgroundColor: COLORS.primary,
        paddingHorizontal: SPACING.lg,
        paddingVertical: 10,
        borderRadius: RADIUS.sm,
        marginLeft: SPACING.sm,
    },
    searchButtonText: {
        color: COLORS.surface,
        fontWeight: FONTS.weights.semibold,
        fontSize: FONTS.sizes.sm,
    },
    tabsContainer: {
        backgroundColor: COLORS.surface,
        paddingBottom: SPACING.md,
    },
    tabsList: {
        paddingHorizontal: SPACING.md,
        gap: SPACING.sm,
    },
    tab: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 14,
        paddingVertical: SPACING.sm,
        borderRadius: RADIUS.full,
        backgroundColor: COLORS.gray100,
        marginRight: SPACING.sm,
    },
    tabActive: {
        backgroundColor: COLORS.primary,
    },
    tabText: {
        fontSize: FONTS.sizes.sm,
        fontWeight: FONTS.weights.medium,
        color: COLORS.textSecondary,
    },
    tabTextActive: {
        color: COLORS.surface,
    },
    proofBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        margin: SPACING.md,
        marginBottom: 0,
        padding: SPACING.md,
        backgroundColor: COLORS.successBg,
        borderRadius: RADIUS.md,
    },
    proofText: {
        fontSize: FONTS.sizes.sm,
        fontWeight: FONTS.weights.medium,
        color: COLORS.success,
        flex: 1,
    },
    proofHash: {
        fontSize: 11,
        fontFamily: 'monospace',
        color: COLORS.success,
    },
    errorBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        margin: SPACING.md,
        marginBottom: 0,
        padding: SPACING.md,
        backgroundColor: COLORS.errorBg,
        borderRadius: RADIUS.md,
    },
    errorText: {
        fontSize: FONTS.sizes.sm,
        color: COLORS.error,
        flex: 1,
    },
    listContent: {
        padding: SPACING.md,
        paddingBottom: 100,
    },
    resourceCard: {
        backgroundColor: COLORS.surface,
        borderRadius: RADIUS.md,
        padding: SPACING.md,
        marginBottom: SPACING.md,
        ...SHADOWS.sm,
    },
    cardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: SPACING.md,
    },
    resourceTitle: {
        fontSize: 15,
        fontWeight: FONTS.weights.semibold,
        color: COLORS.text,
        flex: 1,
    },
    statusBadge: {
        paddingHorizontal: SPACING.sm,
        paddingVertical: 3,
        borderRadius: 6,
    },
    statusFinal: {
        backgroundColor: COLORS.successBg,
    },
    statusPending: {
        backgroundColor: COLORS.warningBg,
    },
    statusText: {
        fontSize: 10,
        fontWeight: FONTS.weights.semibold,
        color: '#065F46', // Keep specific dark green for contrast
    },
    cardDetails: {
        gap: 4,
    },
    detailRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    detailText: {
        fontSize: FONTS.sizes.sm,
        color: COLORS.textSecondary,
    },
    resourceId: {
        fontSize: 11,
        color: COLORS.textTertiary,
        marginTop: SPACING.sm,
        fontFamily: 'monospace',
    },
    emptyState: {
        alignItems: 'center',
        paddingVertical: 60,
    },
    emptyText: {
        fontSize: FONTS.sizes.lg,
        fontWeight: FONTS.weights.semibold,
        color: COLORS.textSecondary,
        marginTop: SPACING.md,
    },
    emptySubtext: {
        fontSize: FONTS.sizes.sm,
        color: COLORS.textTertiary,
        textAlign: 'center',
        marginTop: SPACING.sm,
    },
});
