import React, { useEffect, useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    FlatList,
    TouchableOpacity,
    RefreshControl,
    StatusBar
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../hooks/useAuth';
import { config } from '../../config/env';
import { COLORS, FONTS, SPACING, RADIUS, SHADOWS } from '../../constants/Theme';

/**
 * Alerts Screen
 * 
 * Displays access alerts for suspicious or unusual access patterns.
 */

interface AccessAlert {
    id: string;
    type: 'AFTER_HOURS' | 'UNUSUAL_VOLUME' | 'NEW_PROVIDER' | 'SENSITIVE_RESOURCE' | 'BREAK_GLASS';
    severity: 'LOW' | 'MEDIUM' | 'HIGH';
    message: string;
    accessEventHash: string;
    createdAt: string;
    acknowledgedAt?: string;
    relatedAccess: {
        clinician: string;
        resourceType: string;
    };
    suggestedAction: string;
}

const SEVERITY_COLORS = {
    LOW: { bg: COLORS.infoBg, text: COLORS.info, icon: 'information-circle' },
    MEDIUM: { bg: COLORS.warningBg, text: COLORS.warning, icon: 'warning' },
    HIGH: { bg: COLORS.errorBg, text: COLORS.error, icon: 'alert-circle' },
};

const TYPE_ICONS: Record<string, string> = {
    AFTER_HOURS: 'moon-outline',
    UNUSUAL_VOLUME: 'trending-up-outline',
    NEW_PROVIDER: 'person-add-outline',
    SENSITIVE_RESOURCE: 'shield-outline',
    BREAK_GLASS: 'flash-outline',
};

export default function AlertsScreen() {
    const { patientId, accessToken } = useAuth();
    const [alerts, setAlerts] = useState<AccessAlert[]>([]);
    const [unacknowledgedCount, setUnacknowledgedCount] = useState(0);
    const [isLoading, setIsLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [filter, setFilter] = useState<'all' | 'unacknowledged'>('unacknowledged');

    const fetchAlerts = async () => {
        try {
            const acknowledged = filter === 'all' ? 'true' : 'false';
            const response = await fetch(
                `${config.GATEWAY_URL}/api/patient/${patientId}/access-alerts?acknowledged=${acknowledged}`,
                {
                    headers: { 'Authorization': `Bearer ${accessToken}` },
                }
            );

            if (response.ok) {
                const data = await response.json();
                setAlerts(data.alerts || []);
                setUnacknowledgedCount(data.unacknowledged || 0);
            }
        } catch (error) {
            console.error('Failed to fetch alerts:', error);
        } finally {
            setIsLoading(false);
            setRefreshing(false);
        }
    };

    useEffect(() => {
        fetchAlerts();
    }, [filter]);

    const handleAcknowledge = async (alertId: string) => {
        try {
            const response = await fetch(
                `${config.GATEWAY_URL}/api/patient/${patientId}/access-alerts/${alertId}/acknowledge`,
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ acknowledged: true }),
                }
            );

            if (response.ok) {
                fetchAlerts();
            }
        } catch (error) {
            console.error('Failed to acknowledge alert:', error);
        }
    };

    const formatTime = (dateStr: string) => {
        const date = new Date(dateStr);
        const now = new Date();
        const diff = now.getTime() - date.getTime();

        if (diff < 60 * 60 * 1000) {
            return `${Math.floor(diff / 60000)} min ago`;
        }
        if (diff < 24 * 60 * 60 * 1000) {
            return `${Math.floor(diff / 3600000)} hours ago`;
        }
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    };

    const renderAlertCard = ({ item }: { item: AccessAlert }) => {
        const colors = SEVERITY_COLORS[item.severity];
        const typeIcon = TYPE_ICONS[item.type] || 'alert-outline';

        return (
            <View style={[styles.card, item.acknowledgedAt && styles.cardAcknowledged]}>
                <View style={styles.cardHeader}>
                    <View style={[styles.severityBadge, { backgroundColor: colors.bg }]}>
                        <Ionicons name={colors.icon as any} size={14} color={colors.text} />
                        <Text style={[styles.severityText, { color: colors.text }]}>
                            {item.severity}
                        </Text>
                    </View>
                    <Text style={styles.timeText}>{formatTime(item.createdAt)}</Text>
                </View>

                <View style={styles.alertContent}>
                    <View style={styles.iconContainer}>
                        <Ionicons name={typeIcon as any} size={24} color={COLORS.primary} />
                    </View>
                    <View style={styles.textContent}>
                        <Text style={styles.messageText}>{item.message}</Text>
                        <Text style={styles.clinicianText}>
                            {item.relatedAccess.clinician} • {item.relatedAccess.resourceType}
                        </Text>
                    </View>
                </View>

                <View style={styles.actionRow}>
                    <Text style={styles.suggestionText}>{item.suggestedAction}</Text>
                </View>

                {!item.acknowledgedAt && (
                    <TouchableOpacity
                        style={styles.acknowledgeButton}
                        onPress={() => handleAcknowledge(item.id)}
                    >
                        <Ionicons name="checkmark-circle-outline" size={18} color={COLORS.success} />
                        <Text style={styles.acknowledgeText}>Mark as Reviewed</Text>
                    </TouchableOpacity>
                )}
            </View>
        );
    };

    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />
            <View style={styles.header}>
                <Text style={styles.title}>Access Alerts</Text>
                {unacknowledgedCount > 0 && (
                    <View style={styles.countBadge}>
                        <Text style={styles.countText}>{unacknowledgedCount} new</Text>
                    </View>
                )}
            </View>

            <View style={styles.filterRow}>
                <TouchableOpacity
                    style={[styles.filterButton, filter === 'unacknowledged' && styles.filterActive]}
                    onPress={() => setFilter('unacknowledged')}
                >
                    <Text style={[styles.filterText, filter === 'unacknowledged' && styles.filterTextActive]}>
                        Needs Review
                    </Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={[styles.filterButton, filter === 'all' && styles.filterActive]}
                    onPress={() => setFilter('all')}
                >
                    <Text style={[styles.filterText, filter === 'all' && styles.filterTextActive]}>
                        All Alerts
                    </Text>
                </TouchableOpacity>
            </View>

            <FlatList
                data={alerts}
                renderItem={renderAlertCard}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.listContent}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={() => {
                        setRefreshing(true);
                        fetchAlerts();
                    }} tintColor={COLORS.primary} />
                }
                ListEmptyComponent={
                    <View style={styles.emptyState}>
                        <Ionicons name="shield-checkmark" size={64} color={COLORS.success} />
                        <Text style={styles.emptyText}>No alerts</Text>
                        <Text style={styles.emptySubtext}>
                            All access to your records appears normal.
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
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
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
    countBadge: {
        backgroundColor: COLORS.error,
        paddingHorizontal: SPACING.sm,
        paddingVertical: 4,
        borderRadius: RADIUS.full,
    },
    countText: {
        fontSize: FONTS.sizes.xs,
        fontWeight: FONTS.weights.semibold,
        color: COLORS.surface,
    },
    filterRow: {
        flexDirection: 'row',
        padding: SPACING.md,
        gap: SPACING.sm,
    },
    filterButton: {
        paddingHorizontal: SPACING.md,
        paddingVertical: SPACING.sm,
        borderRadius: RADIUS.full,
        backgroundColor: COLORS.gray100,
    },
    filterActive: {
        backgroundColor: COLORS.primary,
    },
    filterText: {
        fontSize: FONTS.sizes.sm,
        fontWeight: FONTS.weights.medium,
        color: COLORS.textSecondary,
    },
    filterTextActive: {
        color: COLORS.surface,
    },
    listContent: {
        padding: SPACING.md,
        paddingBottom: 100,
    },
    card: {
        backgroundColor: COLORS.surface,
        borderRadius: RADIUS.lg,
        padding: SPACING.md,
        marginBottom: SPACING.md,
        ...SHADOWS.sm,
    },
    cardAcknowledged: {
        opacity: 0.7,
    },
    cardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: SPACING.md,
    },
    severityBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: SPACING.sm,
        paddingVertical: 4,
        borderRadius: RADIUS.md,
    },
    severityText: {
        fontSize: 11,
        fontWeight: FONTS.weights.semibold,
    },
    timeText: {
        fontSize: FONTS.sizes.xs,
        color: COLORS.textTertiary,
    },
    alertContent: {
        flexDirection: 'row',
        gap: SPACING.md,
        marginBottom: SPACING.md,
    },
    iconContainer: {
        width: 40,
        height: 40,
        borderRadius: RADIUS.full,
        backgroundColor: COLORS.primaryLight,
        alignItems: 'center',
        justifyContent: 'center',
    },
    textContent: {
        flex: 1,
    },
    messageText: {
        fontSize: FONTS.sizes.md,
        fontWeight: FONTS.weights.medium,
        color: COLORS.text,
        lineHeight: 20,
    },
    clinicianText: {
        fontSize: FONTS.sizes.sm,
        color: COLORS.textSecondary,
        marginTop: 4,
    },
    actionRow: {
        paddingTop: SPACING.md,
        borderTopWidth: 1,
        borderTopColor: COLORS.border,
    },
    suggestionText: {
        fontSize: FONTS.sizes.sm,
        color: COLORS.primary,
        fontStyle: 'italic',
    },
    acknowledgeButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        marginTop: SPACING.md,
        paddingVertical: SPACING.sm,
        borderRadius: RADIUS.md,
        backgroundColor: COLORS.successBg,
    },
    acknowledgeText: {
        fontSize: FONTS.sizes.sm,
        fontWeight: FONTS.weights.semibold,
        color: COLORS.success,
    },
    emptyState: {
        alignItems: 'center',
        paddingVertical: 60,
    },
    emptyText: {
        fontSize: FONTS.sizes.lg,
        fontWeight: FONTS.weights.semibold,
        color: COLORS.success,
        marginTop: SPACING.md,
    },
    emptySubtext: {
        fontSize: FONTS.sizes.md,
        color: COLORS.textSecondary,
        textAlign: 'center',
        marginTop: SPACING.sm,
    },
});
