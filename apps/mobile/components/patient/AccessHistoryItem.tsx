import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, SPACING, RADIUS, SHADOWS } from '../../constants/Theme';

/**
 * AccessHistoryItem Component
 * 
 * Displays a single access record in the patient's history.
 */

interface AccessHistoryItemProps {
    clinicianName: string;
    department: string;
    resourceType: string;
    accessTimestamp: string;
    isBreakGlass: boolean;
    isVerified: boolean;
    onPress?: () => void;
}

export function AccessHistoryItem({
    clinicianName,
    department,
    resourceType,
    accessTimestamp,
    isBreakGlass,
    isVerified,
    accessEventHash,
    txHash,
    onPress
}: AccessHistoryItemProps & { accessEventHash?: string; txHash?: string }) {
    const [expanded, setExpanded] = React.useState(false);

    // Debug logging
    React.useEffect(() => {
        if (expanded) {
            console.log('AccessHistoryItem Expanded:', { accessEventHash, txHash });
        }
    }, [expanded, accessEventHash, txHash]);

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
        return date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        });
    };

    const handlePress = () => {
        setExpanded(!expanded);
        if (onPress) onPress();
    };

    const hasProof = !!(accessEventHash || txHash);

    return (
        <TouchableOpacity style={styles.container} onPress={handlePress} activeOpacity={0.7}>
            <View style={styles.mainRow}>
                <View style={[styles.iconContainer, isBreakGlass && styles.iconContainerAlert]}>
                    <Ionicons
                        name={isBreakGlass ? 'warning' : 'shield-checkmark'}
                        size={20}
                        color={isBreakGlass ? COLORS.error : COLORS.primary}
                    />
                </View>

                <View style={styles.content}>
                    <View style={styles.header}>
                        <Text style={styles.clinicianName}>{clinicianName}</Text>
                        <Text style={styles.timestamp}>{formatTime(accessTimestamp)}</Text>
                    </View>

                    <View style={styles.details}>
                        <Text style={styles.department}>{department}</Text>
                        <View style={styles.dot} />
                        <Text style={styles.resourceType}>{resourceType}</Text>
                    </View>

                    {/* Visual cue for expansion */}
                    {hasProof && (
                        <View style={styles.expandHint}>
                            <Text style={styles.expandText}>
                                {expanded ? 'Hide Proof' : 'View Proof'}
                            </Text>
                            <Ionicons
                                name={expanded ? 'chevron-up' : 'chevron-down'}
                                size={12}
                                color={COLORS.primary}
                            />
                        </View>
                    )}
                </View>

                <View style={styles.badges}>
                    {isBreakGlass && (
                        <View style={styles.breakGlassBadge}>
                            <Text style={styles.badgeText}>ALERT</Text>
                        </View>
                    )}
                </View>
            </View>

            {expanded && hasProof && (
                <View style={styles.proofDetails}>
                    <View style={styles.divider} />
                    <Text style={styles.proofHeader}>Cryptographic Proof</Text>

                    {accessEventHash ? (
                        <View style={styles.hashRow}>
                            <Text style={styles.hashLabel}>Event Hash:</Text>
                            <Text style={styles.hashValue} numberOfLines={1} ellipsizeMode="middle">
                                {accessEventHash}
                            </Text>
                        </View>
                    ) : <Text>No Event Hash</Text>}

                    {txHash ? (
                        <View style={styles.hashRow}>
                            <Text style={styles.hashLabel}>Polygon Tx:</Text>
                            <Text style={styles.hashValue} numberOfLines={1} ellipsizeMode="middle">
                                {txHash}
                            </Text>
                        </View>
                    ) : null}

                    <View style={styles.verifiedRow}>
                        <Ionicons name="checkmark-circle" size={14} color={COLORS.success} />
                        <Text style={styles.verifiedText}>Verified on-chain</Text>
                    </View>
                </View>
            )}
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    container: {
        backgroundColor: COLORS.surface,
        borderRadius: RADIUS.md,
        marginBottom: SPACING.sm,
        ...SHADOWS.sm,
        overflow: 'hidden',
    },
    mainRow: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 14,
    },
    iconContainer: {
        width: 40,
        height: 40,
        borderRadius: RADIUS.sm,
        backgroundColor: COLORS.primaryLight,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: SPACING.md,
    },
    iconContainerAlert: {
        backgroundColor: COLORS.errorBg,
    },
    content: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    clinicianName: {
        fontSize: FONTS.sizes.sm,
        fontWeight: FONTS.weights.semibold,
        color: COLORS.text,
    },
    timestamp: {
        fontSize: 11,
        color: COLORS.textTertiary,
    },
    details: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 4,
    },
    department: {
        fontSize: FONTS.sizes.xs,
        color: COLORS.textSecondary,
    },
    dot: {
        width: 3,
        height: 3,
        borderRadius: 1.5,
        backgroundColor: COLORS.border,
        marginHorizontal: 6,
    },
    resourceType: {
        fontSize: FONTS.sizes.xs,
        color: COLORS.primary,
    },
    badges: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginLeft: SPACING.sm,
    },
    breakGlassBadge: {
        backgroundColor: COLORS.errorBg,
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
    },
    badgeText: {
        fontSize: 9,
        fontWeight: FONTS.weights.bold,
        color: COLORS.error,
    },
    proofDetails: {
        paddingHorizontal: 14,
        paddingBottom: 14,
        backgroundColor: COLORS.surface,
    },
    divider: {
        height: 1,
        backgroundColor: COLORS.border,
        marginBottom: 12,
        opacity: 0.5,
    },
    proofHeader: {
        fontSize: 11,
        fontWeight: FONTS.weights.semibold,
        color: COLORS.textSecondary,
        marginBottom: 8,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    hashRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 6,
    },
    hashLabel: {
        fontSize: 11,
        color: COLORS.textTertiary,
        width: 70,
    },
    hashValue: {
        fontSize: 11,
        color: COLORS.text,
        fontFamily: 'monospace', // Ensure monospace for hashes
        flex: 1,
    },
    verifiedRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 4,
        gap: 6,
    },
    verifiedText: {
        fontSize: 11,
        color: COLORS.success,
        fontWeight: FONTS.weights.medium,
    },
    expandHint: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 6,
        gap: 4,
    },
    expandText: {
        fontSize: 11,
        color: COLORS.primary,
        fontWeight: FONTS.weights.medium,
    },
});
