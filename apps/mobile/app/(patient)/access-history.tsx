import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    FlatList,
    TouchableOpacity,
    RefreshControl,
    StatusBar,
    ActivityIndicator
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../hooks/useAuth';
import { config } from '../../config/env';
import { AccessHistoryItem } from '../../components/patient/AccessHistoryItem';
import { COLORS, FONTS, SPACING, RADIUS, SHADOWS } from '../../constants/Theme';
import { authorizedFetch, APIError } from '../../services/API';

interface AccessRecord {
    id: string;
    clinician: {
        id: string;
        displayName: string;
        department: string;
    };
    resourceType: string;
    accessEventHash: string;
    txHash?: string;
    accessTimestamp: string;
    isBreakGlass: boolean;
    isVerifiedOnChain: boolean;
}

interface AccessHistoryResponse {
    records: AccessRecord[];
    pagination: {
        total: number;
        limit: number;
        offset: number;
        hasMore: boolean;
    };
    summary: {
        totalAccesses: number;
        uniqueClinicians: number;
        breakGlassCount: number;
    };
}

const PAGE_SIZE = 20;

type FilterMode = 'all' | 'non-emergency';

export default function AccessHistoryScreen() {
    const { patientId, getAccessToken, logout } = useAuth();
    const [records, setRecords] = useState<AccessRecord[]>([]);
    const [summary, setSummary] = useState<AccessHistoryResponse['summary'] | null>(null);
    const [pagination, setPagination] = useState<AccessHistoryResponse['pagination'] | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [filterMode, setFilterMode] = useState<FilterMode>('all');

    const includeBreakGlass = filterMode === 'all';

    const queryString = useMemo(() => {
        const params = new URLSearchParams();
        params.append('limit', PAGE_SIZE.toString());
        params.append('offset', '0');
        params.append('includeBreakGlass', includeBreakGlass ? 'true' : 'false');
        return params.toString();
    }, [includeBreakGlass]);

    const fetchAccessHistory = useCallback(async (options?: { append?: boolean; offset?: number }) => {
        if (!patientId) {
            setError('Missing patient session. Please sign in again.');
            setIsLoading(false);
            return;
        }

        const offset = options?.offset ?? 0;
        const params = new URLSearchParams();
        params.append('limit', PAGE_SIZE.toString());
        params.append('offset', offset.toString());
        params.append('includeBreakGlass', includeBreakGlass ? 'true' : 'false');

        try {
            const response = await authorizedFetch(
                `${config.GATEWAY_URL}/api/patient/${patientId}/access-history?${params.toString()}`
            );

            if (!response.ok) {
                throw new Error('Failed to load access history');
            }

            const data = (await response.json()) as AccessHistoryResponse;

            setSummary(data.summary);
            setPagination(data.pagination);
            setRecords(prev => (options?.append ? [...prev, ...data.records] : data.records));
            setError(null);
        } catch (err: any) {
            if (err instanceof APIError && err.status === 401) {
                await logout();
            }
            setError(err instanceof Error ? err.message : 'Unable to load access history');
        } finally {
            setIsLoading(false);
            setIsRefreshing(false);
            setIsLoadingMore(false);
        }
    }, [includeBreakGlass, logout, patientId]);

    useEffect(() => {
        setIsLoading(true);
        fetchAccessHistory();
    }, [fetchAccessHistory, queryString]);

    const handleRefresh = () => {
        setIsRefreshing(true);
        fetchAccessHistory();
    };

    const handleLoadMore = () => {
        if (!pagination?.hasMore || isLoadingMore) return;
        setIsLoadingMore(true);
        fetchAccessHistory({ append: true, offset: pagination.offset + pagination.limit });
    };

    const renderHeader = () => (
        <View style={styles.headerContainer}>
            <View style={styles.headerTextRow}>
                <Text style={styles.title}>Access History</Text>
                {summary && (
                    <Text style={styles.subtitle}>{summary.totalAccesses} total</Text>
                )}
            </View>

            {summary && (
                <View style={styles.summaryRow}>
                    <View style={styles.summaryCard}>
                        <Text style={styles.summaryValue}>{summary.uniqueClinicians}</Text>
                        <Text style={styles.summaryLabel}>Clinicians</Text>
                    </View>
                    <View style={styles.summaryCard}>
                        <Text style={styles.summaryValue}>{summary.breakGlassCount}</Text>
                        <Text style={styles.summaryLabel}>Emergency</Text>
                    </View>
                </View>
            )}

            <View style={styles.filterRow}>
                <TouchableOpacity
                    style={[styles.filterButton, filterMode === 'all' && styles.filterButtonActive]}
                    onPress={() => setFilterMode('all')}
                >
                    <Text style={[styles.filterText, filterMode === 'all' && styles.filterTextActive]}>
                        All Access
                    </Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={[styles.filterButton, filterMode === 'non-emergency' && styles.filterButtonActive]}
                    onPress={() => setFilterMode('non-emergency')}
                >
                    <Text style={[styles.filterText, filterMode === 'non-emergency' && styles.filterTextActive]}>
                        Standard Only
                    </Text>
                </TouchableOpacity>
            </View>
        </View>
    );

    if (isLoading) {
        return (
            <SafeAreaView style={styles.container}>
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color={COLORS.primary} />
                    <Text style={styles.loadingText}>Loading access history...</Text>
                </View>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />

            <FlatList
                data={records}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                    <AccessHistoryItem
                        clinicianName={item.clinician.displayName}
                        department={item.clinician.department}
                        resourceType={item.resourceType}
                        accessTimestamp={item.accessTimestamp}
                        isBreakGlass={item.isBreakGlass}
                        isVerified={item.isVerifiedOnChain}
                        accessEventHash={item.accessEventHash}
                        txHash={item.txHash}
                    />
                )}
                contentContainerStyle={styles.listContent}
                ListHeaderComponent={renderHeader}
                ListEmptyComponent={
                    <View style={styles.emptyState}>
                        <Ionicons name="shield-checkmark" size={64} color={COLORS.textLight} />
                        <Text style={styles.emptyText}>No access events</Text>
                        <Text style={styles.emptySubtext}>
                            When clinicians access your records, the activity will show up here.
                        </Text>
                    </View>
                }
                refreshControl={
                    <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />
                }
                onEndReached={handleLoadMore}
                onEndReachedThreshold={0.4}
                ListFooterComponent={
                    isLoadingMore ? (
                        <View style={styles.footerLoading}>
                            <ActivityIndicator size="small" color={COLORS.primary} />
                        </View>
                    ) : null
                }
            />

            {error && (
                <View style={styles.errorBanner}>
                    <Ionicons name="alert-circle" size={16} color={COLORS.surface} />
                    <Text style={styles.errorText}>{error}</Text>
                </View>
            )}
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
        alignItems: 'center',
        justifyContent: 'center',
    },
    loadingText: {
        marginTop: SPACING.md,
        fontSize: 14,
        color: COLORS.textSecondary,
        ...FONTS.medium,
    },
    headerContainer: {
        paddingHorizontal: SPACING.l,
        paddingTop: SPACING.l,
        paddingBottom: SPACING.m,
    },
    headerTextRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        marginBottom: SPACING.m,
    },
    title: {
        fontSize: 26,
        ...FONTS.bold,
        color: COLORS.text,
    },
    subtitle: {
        fontSize: 14,
        color: COLORS.textSecondary,
        ...FONTS.medium,
    },
    summaryRow: {
        flexDirection: 'row',
        gap: SPACING.m,
        marginBottom: SPACING.m,
    },
    summaryCard: {
        flex: 1,
        backgroundColor: COLORS.surface,
        borderRadius: RADIUS.l,
        padding: SPACING.m,
        ...SHADOWS.small,
    },
    summaryValue: {
        fontSize: 20,
        ...FONTS.bold,
        color: COLORS.text,
    },
    summaryLabel: {
        marginTop: 4,
        fontSize: 12,
        color: COLORS.textSecondary,
        ...FONTS.medium,
    },
    filterRow: {
        flexDirection: 'row',
        gap: SPACING.s,
    },
    filterButton: {
        flex: 1,
        paddingVertical: SPACING.s,
        borderRadius: RADIUS.full,
        backgroundColor: COLORS.surface,
        alignItems: 'center',
    },
    filterButtonActive: {
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
    listContent: {
        paddingHorizontal: SPACING.l,
        paddingBottom: SPACING.xl,
    },
    emptyState: {
        alignItems: 'center',
        paddingVertical: 60,
    },
    emptyText: {
        marginTop: SPACING.m,
        fontSize: 18,
        ...FONTS.semibold,
        color: COLORS.textSecondary,
    },
    emptySubtext: {
        marginTop: SPACING.s,
        fontSize: 14,
        color: COLORS.textLight,
        textAlign: 'center',
        paddingHorizontal: 40,
        ...FONTS.regular,
    },
    footerLoading: {
        paddingVertical: SPACING.m,
    },
    errorBanner: {
        position: 'absolute',
        left: SPACING.l,
        right: SPACING.l,
        bottom: SPACING.l,
        backgroundColor: COLORS.error,
        borderRadius: RADIUS.m,
        paddingVertical: SPACING.s,
        paddingHorizontal: SPACING.m,
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
