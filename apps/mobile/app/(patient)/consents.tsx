import React, { useEffect, useState } from 'react';
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
import { COLORS, FONTS, SPACING, RADIUS, SHADOWS } from '../../constants/Theme';

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
    const { patientId, accessToken } = useAuth();
    const [consents, setConsents] = useState<Consent[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    const fetchConsents = async () => {
        try {
            const response = await fetch(`${config.GATEWAY_URL}/api/patient/${patientId}/consents`, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                },
            });

            if (response.ok) {
                const data = await response.json();
                setConsents(data.consents || []);
            }
        } catch (error) {
            console.error('Failed to fetch consents:', error);
        } finally {
            setIsLoading(false);
            setRefreshing(false);
        }
    };

    useEffect(() => {
        fetchConsents();
    }, []);

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
                            const response = await fetch(
                                `${config.GATEWAY_URL}/api/patient/${patientId}/consents/${consentId}/revoke`,
                                {
                                    method: 'POST',
                                    headers: {
                                        'Authorization': `Bearer ${accessToken}`,
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

    const formatDate = (dateStr: string) => {
        return new Date(dateStr).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    };

    const renderConsentCard = ({ item }: { item: Consent }) => (
        <View style={styles.card}>
            <View style={styles.cardHeader}>
                <View style={styles.providerInfo}>
                    <Ionicons name="person-circle" size={40} color={COLORS.primary} />
                    <View style={styles.providerDetails}>
                        <Text style={styles.providerName}>{item.grantedTo.name}</Text>
                        <Text style={styles.department}>{item.grantedTo.department}</Text>
                    </View>
                </View>
                <View style={[styles.statusBadge,
                item.status === 'active' ? styles.statusActive : styles.statusInactive
                ]}>
                    <Text style={[styles.statusText, 
                        item.status === 'active' ? { color: COLORS.success } : { color: COLORS.error }
                    ]}>{item.status.toUpperCase()}</Text>
                </View>
            </View>

            <View style={styles.categoriesRow}>
                <Text style={styles.label}>Access to:</Text>
                <View style={styles.categoriesList}>
                    {item.allowedCategories.map((cat, idx) => (
                        <View key={idx} style={styles.categoryChip}>
                            <Text style={styles.categoryText}>{cat}</Text>
                        </View>
                    ))}
                </View>
            </View>

            <View style={styles.validityRow}>
                <Ionicons name="calendar-outline" size={16} color={COLORS.textSecondary} />
                <Text style={styles.validityText}>
                    Valid: {formatDate(item.validPeriod.start)} - {formatDate(item.validPeriod.end)}
                </Text>
            </View>

            {item.status === 'active' && (
                <TouchableOpacity
                    style={styles.revokeButton}
                    onPress={() => handleRevoke(item.id, item.grantedTo.name)}
                    activeOpacity={0.7}
                >
                    <Ionicons name="close-circle-outline" size={20} color={COLORS.error} />
                    <Text style={styles.revokeText}>Revoke Access</Text>
                </TouchableOpacity>
            )}
        </View>
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
                    {consents.filter(c => c.status === 'active').length} active
                </Text>
            </View>

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
    card: {
        backgroundColor: COLORS.surface,
        borderRadius: RADIUS.l,
        padding: SPACING.m,
        marginBottom: SPACING.m,
        ...SHADOWS.small,
    },
    cardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: SPACING.m,
    },
    providerInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    providerDetails: {
        marginLeft: SPACING.m,
        flex: 1,
    },
    providerName: {
        fontSize: 16,
        ...FONTS.semibold,
        color: COLORS.text,
    },
    department: {
        fontSize: 13,
        color: COLORS.textSecondary,
        marginTop: 2,
        ...FONTS.regular,
    },
    statusBadge: {
        paddingHorizontal: SPACING.s,
        paddingVertical: 4,
        borderRadius: RADIUS.full,
    },
    statusActive: {
        backgroundColor: COLORS.successBg,
    },
    statusInactive: {
        backgroundColor: COLORS.errorBg,
    },
    statusText: {
        fontSize: 11,
        ...FONTS.bold,
    },
    categoriesRow: {
        marginBottom: SPACING.m,
    },
    label: {
        fontSize: 12,
        color: COLORS.textSecondary,
        marginBottom: SPACING.s,
        ...FONTS.medium,
    },
    categoriesList: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: SPACING.s,
    },
    categoryChip: {
        backgroundColor: COLORS.primaryLight,
        paddingHorizontal: SPACING.s,
        paddingVertical: 4,
        borderRadius: RADIUS.s,
    },
    categoryText: {
        fontSize: 12,
        color: COLORS.primary,
        ...FONTS.medium,
    },
    validityRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: SPACING.s,
        paddingTop: SPACING.m,
        borderTopWidth: 1,
        borderTopColor: COLORS.border,
        marginTop: SPACING.xs,
    },
    validityText: {
        fontSize: 13,
        color: COLORS.textSecondary,
        ...FONTS.regular,
    },
    revokeButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: SPACING.s,
        marginTop: SPACING.m,
        paddingVertical: SPACING.m,
        borderRadius: RADIUS.m,
        borderWidth: 1,
        borderColor: COLORS.errorBg,
        backgroundColor: COLORS.errorBg,
    },
    revokeText: {
        fontSize: 14,
        ...FONTS.semibold,
        color: COLORS.error,
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
});
