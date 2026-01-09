import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    Switch,
    ScrollView,
    Alert,
    StatusBar,
    ActivityIndicator
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../hooks/useAuth';
import { NullifierManager } from '../../services/NullifierManager';
import { config } from '../../config/env';
import * as SecureStore from 'expo-secure-store';
import { COLORS, FONTS, SPACING, RADIUS, SHADOWS } from '../../constants/Theme';

/**
 * Settings Screen
 * 
 * Allows patient to configure app preferences and security settings.
 * Preferences are synced with backend for persistence.
 */

interface Preferences {
    biometricEnabled: boolean;
    pushNotifications: boolean;
    alertsForAfterHours: boolean;
    alertsForNewProvider: boolean;
    alertsForBreakGlass: boolean;
    allowEmergencyAccess: boolean;
    restrictAccessHours: boolean;
    accessHoursStart: number;
    accessHoursEnd: number;
}

export default function SettingsScreen() {
    const { patientId, accessToken, logout } = useAuth();

    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [preferences, setPreferences] = useState<Preferences>({
        biometricEnabled: true,
        pushNotifications: true,
        alertsForAfterHours: true,
        alertsForNewProvider: true,
        alertsForBreakGlass: true,
        allowEmergencyAccess: true,
        restrictAccessHours: false,
        accessHoursStart: 7,
        accessHoursEnd: 19,
    });

    // Fetch preferences on mount
    useEffect(() => {
        fetchPreferences();
    }, []);

    const fetchPreferences = async () => {
        try {
            const response = await fetch(`${config.GATEWAY_URL}/api/patient/preferences`, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            if (response.ok) {
                const data = await response.json();
                setPreferences(data);
            }
        } catch (error) {
            console.error('Failed to fetch preferences:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const updatePreference = async (key: keyof Preferences, value: boolean | number) => {
        setPreferences(prev => ({ ...prev, [key]: value }));
        setIsSaving(true);

        try {
            // For biometric preference, also save to SecureStore for offline access
            if (key === 'biometricEnabled') {
                await SecureStore.setItemAsync('zk_guardian_biometric_enabled', String(value));
            }

            const response = await fetch(`${config.GATEWAY_URL}/api/patient/preferences`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ [key]: value })
            });

            if (!response.ok) {
                throw new Error('Failed to save preference');
            }
        } catch (error) {
            console.error('Failed to save preference:', error);
            // Revert on error
            fetchPreferences();
            Alert.alert('Error', 'Failed to save preference. Please try again.');
        } finally {
            setIsSaving(false);
        }
    };

    const handleLogout = () => {
        Alert.alert(
            'Sign Out',
            'Are you sure you want to sign out?',
            [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Sign Out', style: 'destructive', onPress: logout },
            ]
        );
    };

    const handleResetNullifier = () => {
        Alert.alert(
            'Reset Privacy Key',
            'This will generate a new privacy key. Your existing access history will become unlinkable. This action cannot be undone.',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Reset',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            await NullifierManager.resetNullifier('user_request');
                            Alert.alert('Success', 'Your privacy key has been reset. Previous access logs are now unlinkable.');
                        } catch (error) {
                            console.error('Failed to reset nullifier:', error);
                            Alert.alert('Error', 'Failed to reset privacy key. Please try again.');
                        }
                    }
                },
            ]
        );
    };

    if (isLoading) {
        return (
            <SafeAreaView style={styles.container}>
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color={COLORS.primary} />
                    <Text style={{ marginTop: SPACING.md, color: COLORS.textSecondary }}>Loading settings...</Text>
                </View>
            </SafeAreaView>
        );
    }

    const SettingRow = ({
        icon,
        title,
        subtitle,
        value,
        onValueChange
    }: {
        icon: string;
        title: string;
        subtitle?: string;
        value: boolean;
        onValueChange: (val: boolean) => void;
    }) => (
        <View style={styles.settingRow}>
            <View style={styles.settingIcon}>
                <Ionicons name={icon as any} size={22} color={COLORS.primary} />
            </View>
            <View style={styles.settingText}>
                <Text style={styles.settingTitle}>{title}</Text>
                {subtitle && <Text style={styles.settingSubtitle}>{subtitle}</Text>}
            </View>
            <Switch
                value={value}
                onValueChange={onValueChange}
                trackColor={{ false: COLORS.border, true: COLORS.primary }}
                thumbColor={COLORS.surface}
            />
        </View>
    );

    const ActionRow = ({
        icon,
        title,
        subtitle,
        onPress,
        destructive = false
    }: {
        icon: string;
        title: string;
        subtitle?: string;
        onPress: () => void;
        destructive?: boolean;
    }) => (
        <TouchableOpacity style={styles.actionRow} onPress={onPress} activeOpacity={0.7}>
            <View style={[styles.settingIcon, destructive && styles.iconDestructive]}>
                <Ionicons
                    name={icon as any}
                    size={22}
                    color={destructive ? COLORS.error : COLORS.primary}
                />
            </View>
            <View style={styles.settingText}>
                <Text style={[styles.settingTitle, destructive && styles.textDestructive]}>
                    {title}
                </Text>
                {subtitle && <Text style={styles.settingSubtitle}>{subtitle}</Text>}
            </View>
            <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
        </TouchableOpacity>
    );

    return (
        <SafeAreaView style={styles.container}>
            <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />
            <View style={styles.header}>
                <Text style={styles.title}>Settings</Text>
            </View>

            <ScrollView contentContainerStyle={styles.scrollContent}>
                {/* Account Section */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Account</Text>
                    <View style={styles.card}>
                        <View style={styles.profileRow}>
                            <View style={styles.avatar}>
                                <Ionicons name="person" size={32} color={COLORS.primary} />
                            </View>
                            <View style={styles.profileInfo}>
                                <Text style={styles.profileId}>Patient ID</Text>
                                <Text style={styles.profileValue}>{patientId}</Text>
                            </View>
                        </View>
                    </View>
                </View>

                {/* Security Section */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Security</Text>
                    <View style={styles.card}>
                        <SettingRow
                            icon="finger-print"
                            title="Biometric Authentication"
                            subtitle="Require Face ID / Touch ID for consent"
                            value={preferences.biometricEnabled}
                            onValueChange={(val) => updatePreference('biometricEnabled', val)}
                        />
                        <View style={styles.divider} />
                        <ActionRow
                            icon="key-outline"
                            title="Reset Privacy Key"
                            subtitle="Generate new cryptographic nullifier"
                            onPress={handleResetNullifier}
                        />
                    </View>
                </View>

                {/* Notifications Section */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Notifications</Text>
                    <View style={styles.card}>
                        <SettingRow
                            icon="notifications-outline"
                            title="Push Notifications"
                            subtitle="Receive consent requests instantly"
                            value={preferences.pushNotifications}
                            onValueChange={(val) => updatePreference('pushNotifications', val)}
                        />
                    </View>
                </View>

                {/* Alert Preferences Section */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Alert Preferences</Text>
                    <View style={styles.card}>
                        <SettingRow
                            icon="moon-outline"
                            title="After-Hours Access"
                            subtitle="Alert when accessed outside 7AM-7PM"
                            value={preferences.alertsForAfterHours}
                            onValueChange={(val) => updatePreference('alertsForAfterHours', val)}
                        />
                        <View style={styles.divider} />
                        <SettingRow
                            icon="person-add-outline"
                            title="New Provider Access"
                            subtitle="Alert for first-time providers"
                            value={preferences.alertsForNewProvider}
                            onValueChange={(val) => updatePreference('alertsForNewProvider', val)}
                        />
                        <View style={styles.divider} />
                        <SettingRow
                            icon="flash-outline"
                            title="Emergency Access"
                            subtitle="Alert for break-glass access"
                            value={preferences.alertsForBreakGlass}
                            onValueChange={(val) => updatePreference('alertsForBreakGlass', val)}
                        />
                    </View>
                </View>

                {/* Actions Section */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Account Actions</Text>
                    <View style={styles.card}>
                        <ActionRow
                            icon="log-out-outline"
                            title="Sign Out"
                            onPress={handleLogout}
                            destructive
                        />
                    </View>
                </View>

                {/* App Info */}
                <View style={styles.footer}>
                    <Text style={styles.footerText}>ZK Guardian v1.0.0</Text>
                    <Text style={styles.footerSubtext}>Privacy-preserving healthcare audit</Text>
                </View>
            </ScrollView>
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
        padding: SPACING.lg,
        backgroundColor: COLORS.surface,
        borderBottomWidth: 1,
        borderBottomColor: COLORS.border,
    },
    title: {
        fontSize: FONTS.sizes.xxl,
        ...FONTS.bold,
        color: COLORS.text,
        letterSpacing: -0.5,
    },
    scrollContent: {
        padding: SPACING.md,
        paddingBottom: 100,
    },
    section: {
        marginBottom: SPACING.xl,
    },
    sectionTitle: {
        fontSize: FONTS.sizes.sm,
        ...FONTS.semibold,
        color: COLORS.textSecondary,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        marginBottom: SPACING.sm,
        paddingLeft: SPACING.xs,
    },
    card: {
        backgroundColor: COLORS.surface,
        borderRadius: RADIUS.lg,
        overflow: 'hidden',
        ...SHADOWS.sm,
    },
    profileRow: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: SPACING.md,
    },
    avatar: {
        width: 56,
        height: 56,
        borderRadius: RADIUS.full,
        backgroundColor: COLORS.primaryLight,
        alignItems: 'center',
        justifyContent: 'center',
    },
    profileInfo: {
        marginLeft: SPACING.md,
    },
    profileId: {
        fontSize: FONTS.sizes.xs,
        color: COLORS.textSecondary,
        ...FONTS.regular,
    },
    profileValue: {
        fontSize: FONTS.sizes.md,
        ...FONTS.semibold,
        color: COLORS.text,
        marginTop: 2,
    },
    settingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: SPACING.md,
    },
    actionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: SPACING.md,
    },
    settingIcon: {
        width: 40,
        height: 40,
        borderRadius: RADIUS.md,
        backgroundColor: COLORS.primaryLight,
        alignItems: 'center',
        justifyContent: 'center',
    },
    iconDestructive: {
        backgroundColor: COLORS.errorBg,
    },
    settingText: {
        flex: 1,
        marginLeft: SPACING.md,
    },
    settingTitle: {
        fontSize: FONTS.sizes.md,
        ...FONTS.medium,
        color: COLORS.text,
    },
    textDestructive: {
        color: COLORS.error,
    },
    settingSubtitle: {
        fontSize: FONTS.sizes.xs,
        color: COLORS.textSecondary,
        marginTop: 2,
        ...FONTS.regular,
    },
    divider: {
        height: 1,
        backgroundColor: COLORS.border,
        marginLeft: 68,
    },
    footer: {
        alignItems: 'center',
        paddingVertical: SPACING.xl,
    },
    footerText: {
        fontSize: FONTS.sizes.sm,
        ...FONTS.semibold,
        color: COLORS.textLight,
    },
    footerSubtext: {
        fontSize: FONTS.sizes.xs,
        color: COLORS.textLight,
        marginTop: SPACING.xs,
        ...FONTS.regular,
    },
});
