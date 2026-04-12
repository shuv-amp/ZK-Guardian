/**
 * Patient Group Layout
 * Protected route - only accessible to authenticated patients
 */

import { Redirect, Stack } from 'expo-router';
import { useAuth } from '../../hooks/useAuth';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { COLORS } from '../../constants/Theme';

import { PushNotificationService } from '../../services/PushNotificationService';
import { config } from '../../config/env';
import { useEffect } from 'react';

export default function PatientLayout() {
    const { isLoading, isAuthenticated, patientId, practitionerId, accessToken } = useAuth();

    // Sync push token with backend
    useEffect(() => {
        if (isAuthenticated && accessToken && patientId) {
            PushNotificationService.syncTokenWithBackend(accessToken, config.GATEWAY_URL);
        }
    }, [isAuthenticated, accessToken, patientId]);

    // Show loading while auth state is being determined
    if (isLoading) {
        return (
            <View style={styles.loading}>
                <ActivityIndicator size="large" color={COLORS.primary} />
            </View>
        );
    }

    // Redirect to login if not authenticated
    if (!isAuthenticated) {
        return <Redirect href="/(auth)/login" />;
    }

    // If user is a clinician (has practitionerId but no patientId), redirect them
    if (practitionerId && !patientId) {
        return <Redirect href="/(clinician)/dashboard" />;
    }

    // Render patient screens
    return (
        <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="dashboard" />
            <Stack.Screen name="access-history" />
            <Stack.Screen name="consents" />
            <Stack.Screen name="alerts" />
            <Stack.Screen name="settings" />
        </Stack>
    );
}

const styles = StyleSheet.create({
    loading: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: COLORS.background,
    },
});
