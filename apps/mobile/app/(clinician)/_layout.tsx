/**
 * Clinician Group Layout
 * Protected route - only accessible to clinicians
 */

import { Redirect, Stack } from 'expo-router';
import { useAuth } from '../../hooks/useAuth';

export default function ClinicianLayout() {
    const { isAuthenticated, userRole } = useAuth();

    // Redirect to login if not authenticated
    if (!isAuthenticated) {
        return <Redirect href="/(auth)/login" />;
    }

    // Redirect to patient if wrong role
    if (userRole !== 'clinician') {
        return <Redirect href="/(patient)/dashboard" />;
    }

    return (
        <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="dashboard" />
            <Stack.Screen name="records" />
            <Stack.Screen name="proofs" />
            <Stack.Screen name="break-glass" />
        </Stack>
    );
}
