/**
 * ZK Guardian Mobile App - Root Layout
 * 
 * This is the root layout that wraps all screens.
 * Auth-based routing is handled by:
 * - `app/index.tsx` for initial/deep link routing
 * - Individual screen guards where needed
 */

import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { AuthProvider } from '../hooks/useAuth';
import { ConsentProvider } from '../hooks/ConsentProvider';
import { isBackendConfigured } from '../config/env';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, FONTS, SPACING } from '../constants/Theme';

// Prevent splash screen from auto-hiding
SplashScreen.preventAutoHideAsync();

function ConfigurationError() {
    return (
        <View style={styles.errorContainer}>
            <Text style={styles.errorTitle}>Configuration Required</Text>
            <Text style={styles.errorText}>
                The app is not configured to connect to the backend.
                Production builds require `GATEWAY_URL`, `WS_URL`, and `TLS_PIN_MAP`
                with HTTPS/WSS endpoints and matching pinned hosts.
            </Text>
        </View>
    );
}

export default function RootLayout() {
    const [appReady, setAppReady] = useState(false);

    useEffect(() => {
        async function prepare() {
            try {
                // Brief delay for splash screen
                await new Promise(resolve => setTimeout(resolve, 300));
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
            <StatusBar style="dark" backgroundColor={COLORS.background} />
            <ConsentProvider>
                <Stack screenOptions={{
                    headerShown: false,
                    contentStyle: { backgroundColor: COLORS.background },
                    animation: 'fade',
                }}>
                    {/* Index route - handles auth-based redirects */}
                    <Stack.Screen
                        name="index"
                        options={{
                            headerShown: false,
                        }}
                    />

                    {/* OAuth callback route */}
                    <Stack.Screen
                        name="auth"
                        options={{
                            headerShown: false,
                            animation: 'none',
                        }}
                    />

                    {/* Auth screens */}
                    <Stack.Screen
                        name="(auth)"
                        options={{
                            headerShown: false,
                            gestureEnabled: false,
                        }}
                    />

                    {/* Patient screens */}
                    <Stack.Screen
                        name="(patient)"
                        options={{
                            headerShown: false,
                            gestureEnabled: false,
                        }}
                    />

                    {/* Clinician screens */}
                    <Stack.Screen
                        name="(clinician)"
                        options={{
                            headerShown: false,
                            gestureEnabled: false,
                        }}
                    />
                </Stack>
            </ConsentProvider>
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
