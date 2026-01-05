/**
 * Patient Group Layout
 * Protected route - only accessible to patients
 */

import { Redirect, Stack } from 'expo-router';
import { useAuth } from '../../hooks/useAuth';

export default function PatientLayout() {
    const { isAuthenticated, userRole } = useAuth();

    // Redirect to login if not authenticated
    if (!isAuthenticated) {
        return <Redirect href="/(auth)/login" />;
    }

    // Redirect to clinician if wrong role
    if (userRole !== 'patient') {
        return <Redirect href="/(clinician)/dashboard" />;
    }

    return (
        <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="dashboard" />
            <Stack.Screen name="consents" />
            <Stack.Screen name="alerts" />
            <Stack.Screen name="settings" />
        </Stack>
    );
}
