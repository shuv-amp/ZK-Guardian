/**
 * ZK Guardian Mobile App - Root Layout
 * Handles navigation, auth state, and real-time consent modal
 */

import { useEffect, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { AuthProvider, useAuth } from '../hooks/useAuth';
import { ConsentModal } from '../components/ConsentModal';
import { isBackendConfigured } from '../config/env';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, FONTS, SPACING } from '../constants/Theme';

// Prevent splash screen from auto-hiding
SplashScreen.preventAutoHideAsync();

function RootNavigator() {
    const { isLoading, isAuthenticated, patientId, practitionerId } = useAuth();
    const segments = useSegments();
    const router = useRouter();

    // Handle navigation based on auth state
    useEffect(() => {
        if (isLoading) return;

        const inAuthGroup = segments[0] === '(auth)';

        if (!isAuthenticated && !inAuthGroup) {
            // Redirect to login
            router.replace('/(auth)/login');
        } else if (isAuthenticated && inAuthGroup) {
            // Redirect to appropriate dashboard
            if (patientId) {
                router.replace('/(patient)/dashboard');
            } else if (practitionerId) {
                router.replace('/(clinician)/dashboard');
            }
        }
    }, [isLoading, isAuthenticated, segments, patientId, practitionerId]);

    if (isLoading) {
        return null; // Splash screen still showing
    }

    return (
        <>
            <StatusBar style="dark" backgroundColor={COLORS.background} />
            <Stack screenOptions={{ 
                headerShown: false,
                contentStyle: { backgroundColor: COLORS.background }
            }}>
                {/* Auth screens - shown when not authenticated */}
                <Stack.Screen
                    name="(auth)"
                    options={{
                        headerShown: false,
                        gestureEnabled: false,
                    }}
                />

                {/* Patient screens - shown when role is patient */}
                <Stack.Screen
                    name="(patient)"
                    options={{
                        headerShown: false,
                        gestureEnabled: false,
                    }}
                />

                {/* Clinician screens - shown when role is clinician */}
                <Stack.Screen
                    name="(clinician)"
                    options={{
                        headerShown: false,
                        gestureEnabled: false,
                    }}
                />
            </Stack>

            {/* Global consent request modal */}
            <ConsentModal />
        </>
    );
}

function ConfigurationError() {
    return (
        <View style={styles.errorContainer}>
            <Text style={styles.errorTitle}>Configuration Required</Text>
            <Text style={styles.errorText}>
                The app is not configured to connect to the backend.
                Please set GATEWAY_URL and WS_URL in your app configuration.
            </Text>
        </View>
    );
}

export default function RootLayout() {
    const [appReady, setAppReady] = useState(false);

    useEffect(() => {
        async function prepare() {
            try {
                await new Promise(resolve => setTimeout(resolve, 500));
            } finally {
                setAppReady(true);
                await SplashScreen.hideAsync();
            }
        }
        prepare();
    }, []);

    if (!appReady) {
        return null;
    }

    // Show error if not configured (production without env vars)
    if (!isBackendConfigured()) {
        return <ConfigurationError />;
    }

    return (
        <AuthProvider>
            <RootNavigator />
        </AuthProvider>
    );
}

const styles = StyleSheet.create({
    errorContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: SPACING.xl,
        backgroundColor: COLORS.background,
    },
    errorTitle: {
        fontSize: 24,
        ...FONTS.bold,
        color: COLORS.error,
        marginBottom: SPACING.m,
    },
    errorText: {
        fontSize: 16,
        color: COLORS.textSecondary,
        textAlign: 'center',
        lineHeight: 24,
        ...FONTS.regular,
    },
});

