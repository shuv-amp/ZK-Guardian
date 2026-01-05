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
    onPress
}: AccessHistoryItemProps) {
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

    return (
        <TouchableOpacity style={styles.container} onPress={onPress} disabled={!onPress}>
            <View style={styles.iconContainer}>
                <Ionicons
                    name={isBreakGlass ? 'flash' : 'document-text-outline'}
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
            </View>

            <View style={styles.badges}>
                {isBreakGlass && (
                    <View style={styles.breakGlassBadge}>
                        <Text style={styles.badgeText}>EMERGENCY</Text>
                    </View>
                )}
                {isVerified && (
                    <Ionicons name="shield-checkmark" size={18} color={COLORS.success} />
                )}
            </View>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: COLORS.surface,
        padding: 14,
        borderRadius: RADIUS.md,
        marginBottom: SPACING.sm,
        ...SHADOWS.sm,
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
});
