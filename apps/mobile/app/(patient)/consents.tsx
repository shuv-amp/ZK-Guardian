import React, { useEffect, useMemo, useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    FlatList,
    TouchableOpacity,
    RefreshControl,
    Alert,
    StatusBar
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../hooks/useAuth';
import { config } from '../../config/env';
import { ConsentCard } from '../../components/patient/ConsentCard';
import { COLORS, FONTS, SPACING, RADIUS } from '../../constants/Theme';
import { authorizedFetch, APIError } from '../../services/API';

/**
 * Consents Screen
 * 
 * Displays all active consents for the patient and allows management.
 */

interface Consent {
    id: string;
    status: 'active' | 'inactive' | 'revoked';
    grantedTo: {
        id: string;
        name: string;
        department: string;
    };
    allowedCategories: string[];
    validPeriod: {
        start: string;
        end: string;
    };
    createdAt: string;
}

export default function ConsentsScreen() {
    const { patientId, getAccessToken, logout } = useAuth();
    const [consents, setConsents] = useState<Consent[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [statusFilter, setStatusFilter] = useState<'active' | 'revoked' | 'all'>('active');

    const statusLabel = useMemo(() => {
        if (statusFilter === 'active') return 'active';
        if (statusFilter === 'revoked') return 'revoked';
        return 'total';
    }, [statusFilter]);

    const fetchConsents = async () => {
        try {
            const params = new URLSearchParams();
            params.append('status', statusFilter);
            const response = await authorizedFetch(`${config.GATEWAY_URL}/api/patient/${patientId}/consents?${params.toString()}`);

            if (response.ok) {
                const data = await response.json();
                setConsents(data.consents || []);
                setErrorMessage(null);
            }
        } catch (error: any) {
            console.error('Failed to fetch consents:', error);
            if (error instanceof APIError && error.status === 401) {
                await logout();
            }
            setErrorMessage('Unable to load consents. Please try again.');
        } finally {
            setIsLoading(false);
            setRefreshing(false);
        }
    };

    useEffect(() => {
        if (patientId) {
            fetchConsents();
        }
    }, [patientId, statusFilter]);

    const handleRevoke = (consentId: string, clinicianName: string) => {
        Alert.alert(
            'Revoke Consent',
            `Are you sure you want to revoke access for ${clinicianName}? This action cannot be undone.`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Revoke',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            const response = await authorizedFetch(
                                `${config.GATEWAY_URL}/api/patient/${patientId}/consents/${consentId}/revoke`,
                                {
                                    method: 'POST',
                                    headers: {
                                        'Content-Type': 'application/json',
                                    },
                                    body: JSON.stringify({ revokeImmediately: true }),
                                }
                            );

                            if (response.ok) {
                                Alert.alert('Success', 'Consent has been revoked.');
                                fetchConsents();
                            } else {
                                Alert.alert('Error', 'Failed to revoke consent.');
                            }
                        } catch (error) {
                            Alert.alert('Error', 'Failed to revoke consent.');
                        }
                    }
                },
            ]
        );
    };

    const renderConsentCard = ({ item }: { item: Consent }) => (
        <ConsentCard
            grantedTo={{
                name: item.grantedTo.name,
                department: item.grantedTo.department
            }}
            allowedCategories={item.allowedCategories}
            validPeriod={item.validPeriod}
            status={item.status}
            onRevoke={item.status === 'active' ? () => handleRevoke(item.id, item.grantedTo.name) : undefined}
        />
    );

    if (isLoading) {
        return (
            <SafeAreaView style={styles.container}>
                <View style={styles.loadingContainer}>
                    <Text style={{ color: COLORS.textSecondary }}>Loading consents...</Text>
                </View>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={styles.container}>
            <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />
            <View style={styles.header}>
                <Text style={styles.title}>My Consents</Text>
                <Text style={styles.subtitle}>
                    {consents.length} {statusLabel}
                </Text>
            </View>

            <View style={styles.filterRow}>
                <TouchableOpacity
                    style={[styles.filterButton, statusFilter === 'active' && styles.filterActive]}
                    onPress={() => setStatusFilter('active')}
                >
                    <Text style={[styles.filterText, statusFilter === 'active' && styles.filterTextActive]}>
                        Active
                    </Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={[styles.filterButton, statusFilter === 'all' && styles.filterActive]}
                    onPress={() => setStatusFilter('all')}
                >
                    <Text style={[styles.filterText, statusFilter === 'all' && styles.filterTextActive]}>
                        All
                    </Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={[styles.filterButton, statusFilter === 'revoked' && styles.filterActive]}
                    onPress={() => setStatusFilter('revoked')}
                >
                    <Text style={[styles.filterText, statusFilter === 'revoked' && styles.filterTextActive]}>
                        Revoked
                    </Text>
                </TouchableOpacity>
            </View>

            {errorMessage && (
                <View style={styles.errorBanner}>
                    <Ionicons name="alert-circle" size={16} color={COLORS.surface} />
                    <Text style={styles.errorText}>{errorMessage}</Text>
                </View>
            )}

            <FlatList
                data={consents}
                renderItem={renderConsentCard}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.listContent}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={() => {
                        setRefreshing(true);
                        fetchConsents();
                    }} />
                }
                ListEmptyComponent={
                    <View style={styles.emptyState}>
                        <Ionicons name="document-outline" size={64} color={COLORS.textLight} />
                        <Text style={styles.emptyText}>No consents found</Text>
                        <Text style={styles.emptySubtext}>
                            When you grant access to providers, they'll appear here.
                        </Text>
                    </View>
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
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    header: {
        padding: SPACING.l,
        backgroundColor: COLORS.surface,
        borderBottomWidth: 1,
        borderBottomColor: COLORS.border,
    },
    title: {
        fontSize: 28,
        ...FONTS.bold,
        color: COLORS.text,
        letterSpacing: -0.5,
    },
    subtitle: {
        fontSize: 14,
        color: COLORS.textSecondary,
        marginTop: SPACING.xs,
        ...FONTS.regular,
    },
    listContent: {
        padding: SPACING.m,
        paddingBottom: 100,
    },
    filterRow: {
        flexDirection: 'row',
        gap: SPACING.s,
        paddingHorizontal: SPACING.m,
        paddingBottom: SPACING.m,
        backgroundColor: COLORS.surface,
        borderBottomWidth: 1,
        borderBottomColor: COLORS.border,
    },
    filterButton: {
        flex: 1,
        paddingVertical: SPACING.s,
        borderRadius: RADIUS.full,
        backgroundColor: COLORS.background,
        alignItems: 'center',
    },
    filterActive: {
        backgroundColor: COLORS.primary,
    },
    filterText: {
        fontSize: 12,
        color: COLORS.textSecondary,
        ...FONTS.medium,
    },
    filterTextActive: {
        color: COLORS.surface,
    },
    emptyState: {
        alignItems: 'center',
        paddingVertical: 60,
    },
    emptyText: {
        fontSize: 18,
        ...FONTS.semibold,
        color: COLORS.textSecondary,
        marginTop: SPACING.m,
    },
    emptySubtext: {
        fontSize: 14,
        color: COLORS.textLight,
        textAlign: 'center',
        marginTop: SPACING.s,
        paddingHorizontal: 40,
        ...FONTS.regular,
    },
    errorBanner: {
        marginHorizontal: SPACING.m,
        marginTop: SPACING.m,
        padding: SPACING.s,
        borderRadius: RADIUS.m,
        backgroundColor: COLORS.error,
        flexDirection: 'row',
        alignItems: 'center',
        gap: SPACING.s,
    },
    errorText: {
        color: COLORS.surface,
        fontSize: 12,
        ...FONTS.medium,
    },
});
