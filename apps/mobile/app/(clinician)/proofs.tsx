import React, { useCallback, useEffect, useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    FlatList,
    RefreshControl,
    TouchableOpacity,
    StatusBar
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../hooks/useAuth';
import { config } from '../../config/env';
import { authorizedFetch } from '../../services/API';
import { COLORS, FONTS, SPACING, RADIUS, SHADOWS } from '../../constants/Theme';

/**
 * Proofs Screen (Clinician)
 * 
 * Shows the status of ZK proofs generated for clinician's access requests.
 */

interface ProofRecord {
    id: string;
    patientId: string;
    resourceType: string;
    accessEventHash: string;
    status: 'pending' | 'queued' | 'verified' | 'failed';
    createdAt: string;
    blockchain?: {
        txHash: string;
        blockNumber: number;
        gasUsed: number;
    };
}

const STATUS_CONFIG = {
    pending: { bg: COLORS.warningBg, text: COLORS.warning, icon: 'time-outline' },
    queued: { bg: COLORS.infoBg, text: COLORS.info, icon: 'layers-outline' },
    verified: { bg: COLORS.successBg, text: COLORS.success, icon: 'checkmark-circle' },
    failed: { bg: COLORS.errorBg, text: COLORS.error, icon: 'close-circle' },
};

export default function ProofsScreen() {
    const { practitionerId } = useAuth();
    const [proofs, setProofs] = useState<ProofRecord[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [stats, setStats] = useState({
        pending: 0,
        queued: 0,
        verified: 0,
        failed: 0
    });

    const fetchProofs = useCallback(async () => {
        try {
            if (!practitionerId) {
                setProofs([]);
                setStats({ pending: 0, queued: 0, verified: 0, failed: 0 });
                setIsLoading(false);
                setRefreshing(false);
                return;
            }

            const response = await authorizedFetch(
                `${config.GATEWAY_URL}/api/clinician/${practitionerId}/proofs?limit=20`,
                {
                    headers: {
                        'Content-Type': 'application/json'
                    }
                }
            );

            if (!response.ok) {
                throw new Error('Failed to fetch proofs');
            }

            const data = await response.json();
            const proofRecords: ProofRecord[] = Array.isArray(data.proofs) ? data.proofs : [];
            setProofs(proofRecords);

            // Calculate stats
            const newStats: Record<ProofRecord['status'], number> = {
                pending: 0,
                queued: 0,
                verified: 0,
                failed: 0
            };
            proofRecords.forEach((proof) => {
                if (newStats[proof.status] !== undefined) {
                    newStats[proof.status]++;
                }
            });
            setStats(newStats);
        } catch (error) {
            console.error('Failed to fetch proofs:', error);
        } finally {
            setIsLoading(false);
            setRefreshing(false);
        }
    }, [practitionerId]);

    useEffect(() => {
        void fetchProofs();
    }, [fetchProofs]);

    const formatTime = (dateStr: string) => {
        const date = new Date(dateStr);
        const now = new Date();
        const diff = now.getTime() - date.getTime();

        if (diff < 60000) return 'Just now';
        if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`;
        return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    };

    const renderProofCard = ({ item }: { item: ProofRecord }) => {
        const config = STATUS_CONFIG[item.status];

        return (
            <View style={styles.card}>
                <View style={styles.cardHeader}>
                    <View style={[styles.statusBadge, { backgroundColor: config.bg }]}>
                        <Ionicons name={config.icon as any} size={14} color={config.text} />
                        <Text style={[styles.statusText, { color: config.text }]}>
                            {item.status.toUpperCase()}
                        </Text>
                    </View>
                    <Text style={styles.timeText}>{formatTime(item.createdAt)}</Text>
                </View>

                <View style={styles.cardContent}>
                    <View style={styles.infoRow}>
                        <Text style={styles.label}>Patient</Text>
                        <Text style={styles.value}>{item.patientId}</Text>
                    </View>
                    <View style={styles.infoRow}>
                        <Text style={styles.label}>Resource</Text>
                        <Text style={styles.value}>{item.resourceType}</Text>
                    </View>
                    <View style={styles.infoRow}>
                        <Text style={styles.label}>Event Hash</Text>
                        <Text style={styles.hashValue}>{item.accessEventHash}</Text>
                    </View>
                </View>

                {item.blockchain && (
                    <View style={styles.blockchainInfo}>
                        <Ionicons name="cube-outline" size={16} color={COLORS.primary} />
                        <Text style={styles.blockchainText}>
                            Block #{item.blockchain.blockNumber} • {item.blockchain.gasUsed.toLocaleString()} gas
                        </Text>
                        <TouchableOpacity>
                            <Ionicons name="open-outline" size={16} color={COLORS.primary} />
                        </TouchableOpacity>
                    </View>
                )}
            </View>
        );
    };

    const StatCard = ({ label, value, color }: { label: string; value: number; color: string }) => (
        <View style={styles.statCard}>
            <Text style={[styles.statValue, { color }]}>{value}</Text>
            <Text style={styles.statLabel}>{label}</Text>
        </View>
    );

    return (
        <SafeAreaView style={styles.container}>
            <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />
            <View style={styles.header}>
                <Text style={styles.title}>ZK Proofs</Text>
                <Text style={styles.subtitle}>Cryptographic access verification</Text>
            </View>

            {/* Stats Row */}
            <View style={styles.statsRow}>
                <StatCard label="Pending" value={stats.pending} color={COLORS.warning} />
                <StatCard label="Queued" value={stats.queued} color={COLORS.info} />
                <StatCard label="Verified" value={stats.verified} color={COLORS.success} />
            </View>

            {/* Info Banner */}
            <View style={styles.infoBanner}>
                <Ionicons name="information-circle" size={20} color={COLORS.primary} />
                <Text style={styles.infoText}>
                    Proofs are batched every 5 minutes to optimize gas costs
                </Text>
            </View>

            <FlatList
                data={proofs}
                renderItem={renderProofCard}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.listContent}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={() => {
                        setRefreshing(true);
                        void fetchProofs();
                    }} />
                }
                ListEmptyComponent={
                    !isLoading ? (
                        <View style={styles.emptyState}>
                            <Ionicons name="document-lock-outline" size={64} color={COLORS.textLight} />
                            <Text style={styles.emptyText}>No proofs yet</Text>
                            <Text style={styles.emptySubtext}>
                                Proofs are generated when you access patient records
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
    statsRow: {
        flexDirection: 'row',
        padding: SPACING.m,
        gap: SPACING.m,
    },
    statCard: {
        flex: 1,
        backgroundColor: COLORS.surface,
        borderRadius: RADIUS.m,
        padding: SPACING.m,
        alignItems: 'center',
        ...SHADOWS.small,
    },
    statValue: {
        fontSize: 24,
        ...FONTS.bold,
    },
    statLabel: {
        fontSize: 12,
        color: COLORS.textSecondary,
        marginTop: SPACING.xs,
        ...FONTS.medium,
    },
    infoBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: SPACING.s,
        marginHorizontal: SPACING.m,
        marginBottom: SPACING.s,
        padding: SPACING.m,
        backgroundColor: COLORS.primaryLight,
        borderRadius: RADIUS.m,
    },
    infoText: {
        fontSize: 12,
        color: COLORS.primaryDark,
        flex: 1,
        ...FONTS.medium,
    },
    listContent: {
        padding: SPACING.m,
        paddingBottom: 100,
    },
    card: {
        backgroundColor: COLORS.surface,
        borderRadius: RADIUS.m,
        padding: SPACING.m,
        marginBottom: SPACING.m,
        ...SHADOWS.small,
    },
    cardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: SPACING.m,
    },
    statusBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: SPACING.s,
        paddingVertical: 4,
        borderRadius: RADIUS.full,
    },
    statusText: {
        fontSize: 10,
        ...FONTS.bold,
    },
    timeText: {
        fontSize: 12,
        color: COLORS.textLight,
        ...FONTS.regular,
    },
    cardContent: {
        gap: SPACING.s,
    },
    infoRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    label: {
        fontSize: 13,
        color: COLORS.textSecondary,
        ...FONTS.regular,
    },
    value: {
        fontSize: 13,
        ...FONTS.medium,
        color: COLORS.text,
    },
    hashValue: {
        fontSize: 11,
        fontFamily: 'monospace',
        color: COLORS.text,
    },
    blockchainInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: SPACING.s,
        marginTop: SPACING.m,
        paddingTop: SPACING.m,
        borderTopWidth: 1,
        borderTopColor: COLORS.border,
    },
    blockchainText: {
        fontSize: 12,
        color: COLORS.primary,
        flex: 1,
        ...FONTS.medium,
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
        ...FONTS.regular,
    },
});
