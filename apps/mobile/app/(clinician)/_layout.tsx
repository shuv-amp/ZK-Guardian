/**
 * Clinician Group Layout
 * Protected route - only accessible to authenticated clinicians
 */

import { Redirect, Stack } from 'expo-router';
import { useAuth } from '../../hooks/useAuth';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { COLORS } from '../../constants/Theme';

export default function ClinicianLayout() {
    const { isLoading, isAuthenticated, patientId, practitionerId } = useAuth();

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

    // If user is a patient (has patientId but no practitionerId), redirect them
    if (patientId && !practitionerId) {
        return <Redirect href="/(patient)/dashboard" />;
    }

    // Render clinician screens
    return (
        <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="dashboard" />
            <Stack.Screen name="records" />
            <Stack.Screen name="proofs" />
            <Stack.Screen name="break-glass" />
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
