/**
 * ZK Guardian Mobile App - Root Layout
 * Handles navigation and auth state
 */

import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useAuth } from '../hooks/useAuth';

// Prevent splash screen from auto-hiding
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
    const { isLoading, isAuthenticated, userRole } = useAuth();
    const [appReady, setAppReady] = useState(false);

    useEffect(() => {
        async function prepare() {
            try {
                // Pre-load any resources here
                await new Promise(resolve => setTimeout(resolve, 500));
            } finally {
                setAppReady(true);
                await SplashScreen.hideAsync();
            }
        }
        prepare();
    }, []);

    if (!appReady || isLoading) {
        return null;
    }

    return (
        <>
            <StatusBar style="auto" />
            <Stack screenOptions={{ headerShown: false }}>
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
        </>
    );
}
