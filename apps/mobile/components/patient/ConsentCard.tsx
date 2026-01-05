import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, SPACING, RADIUS, SHADOWS } from '../../constants/Theme';

/**
 * ConsentCard Component
 * 
 * Displays a consent grant with provider info, categories, and validity.
 */

interface ConsentCardProps {
    grantedTo: {
        name: string;
        department: string;
    };
    allowedCategories: string[];
    validPeriod: {
        start: string;
        end: string;
    };
    status: 'active' | 'inactive' | 'revoked';
    onRevoke?: () => void;
}

export function ConsentCard({
    grantedTo,
    allowedCategories,
    validPeriod,
    status,
    onRevoke
}: ConsentCardProps) {
    const formatDate = (dateStr: string) => {
        return new Date(dateStr).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
    };

    return (
        <View style={styles.card}>
            <View style={styles.header}>
                <View style={styles.providerInfo}>
                    <Ionicons name="person-circle" size={40} color={COLORS.primary} />
                    <View style={styles.providerDetails}>
                        <Text style={styles.providerName}>{grantedTo.name}</Text>
                        <Text style={styles.department}>{grantedTo.department}</Text>
                    </View>
                </View>
                <View style={[styles.statusBadge,
                status === 'active' ? styles.statusActive : styles.statusInactive
                ]}>
                    <Text style={[styles.statusText, 
                        status === 'active' ? { color: '#065F46' } : { color: COLORS.error }
                    ]}>{status.toUpperCase()}</Text>
                </View>
            </View>

            <View style={styles.categoriesRow}>
                <Text style={styles.label}>Access to:</Text>
                <View style={styles.categoriesList}>
                    {allowedCategories.map((cat, idx) => (
                        <View key={idx} style={styles.categoryChip}>
                            <Text style={styles.categoryText}>{cat}</Text>
                        </View>
                    ))}
                </View>
            </View>

            <View style={styles.validityRow}>
                <Ionicons name="calendar-outline" size={16} color={COLORS.textSecondary} />
                <Text style={styles.validityText}>
                    Valid: {formatDate(validPeriod.start)} - {formatDate(validPeriod.end)}
                </Text>
            </View>

            {status === 'active' && onRevoke && (
                <TouchableOpacity style={styles.revokeButton} onPress={onRevoke}>
                    <Ionicons name="close-circle-outline" size={20} color={COLORS.error} />
                    <Text style={styles.revokeText}>Revoke Access</Text>
                </TouchableOpacity>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        backgroundColor: COLORS.surface,
        borderRadius: RADIUS.lg,
        padding: SPACING.md,
        marginBottom: SPACING.md,
        ...SHADOWS.sm,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: SPACING.md,
    },
    providerInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    providerDetails: {
        marginLeft: SPACING.sm,
        flex: 1,
    },
    providerName: {
        fontSize: FONTS.sizes.md,
        fontWeight: FONTS.weights.semibold,
        color: COLORS.text,
    },
    department: {
        fontSize: FONTS.sizes.sm,
        color: COLORS.textSecondary,
        marginTop: 2,
    },
    statusBadge: {
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: RADIUS.md,
    },
    statusActive: {
        backgroundColor: COLORS.successBg,
    },
    statusInactive: {
        backgroundColor: COLORS.errorBg,
    },
    statusText: {
        fontSize: 11,
        fontWeight: FONTS.weights.semibold,
    },
    categoriesRow: {
        marginBottom: SPACING.sm,
    },
    label: {
        fontSize: FONTS.sizes.xs,
        color: COLORS.textSecondary,
        marginBottom: SPACING.sm,
    },
    categoriesList: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: SPACING.sm,
    },
    categoryChip: {
        backgroundColor: COLORS.primaryLight,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: RADIUS.sm,
    },
    categoryText: {
        fontSize: FONTS.sizes.xs,
        color: COLORS.primary,
        fontWeight: FONTS.weights.medium,
    },
    validityRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingTop: SPACING.sm,
        borderTopWidth: 1,
        borderTopColor: COLORS.border,
        marginTop: SPACING.sm,
    },
    validityText: {
        fontSize: FONTS.sizes.sm,
        color: COLORS.textSecondary,
    },
    revokeButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        marginTop: SPACING.md,
        paddingVertical: SPACING.sm,
        borderRadius: RADIUS.md,
        borderWidth: 1,
        borderColor: '#FECACA', // Keep specific light red border
        backgroundColor: COLORS.errorBg,
    },
    revokeText: {
        fontSize: FONTS.sizes.sm,
        fontWeight: FONTS.weights.semibold,
        color: COLORS.error,
    },
});
