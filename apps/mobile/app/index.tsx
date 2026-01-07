/**
 * Root Index Route
 * 
 * Entry point when the app is opened directly (not via deep link).
 * Redirects to login or dashboard based on auth state.
 * 
 * Uses a ref to ensure navigation only happens once.
 */

import { useEffect, useRef } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../hooks/useAuth';
import { COLORS } from '../constants/Theme';

export default function Index() {
    const { isLoading, isAuthenticated, patientId, practitionerId } = useAuth();
    const router = useRouter();
    const hasNavigatedRef = useRef(false);

    useEffect(() => {
        // Skip if still loading or already navigated
        if (isLoading || hasNavigatedRef.current) {
            return;
        }

        // Mark as navigated to prevent multiple navigations
        hasNavigatedRef.current = true;

        // Small delay to ensure state is fully settled
        const timer = setTimeout(() => {
            if (isAuthenticated) {
                if (patientId) {
                    router.replace('/(patient)/dashboard');
                } else if (practitionerId) {
                    router.replace('/(clinician)/dashboard');
                } else {
                    router.replace('/(auth)/login');
                }
            } else {
                router.replace('/(auth)/login');
            }
        }, 100);

        return () => clearTimeout(timer);
    }, [isLoading, isAuthenticated, patientId, practitionerId, router]);

    // Show loading indicator while determining route
    return (
        <View style={styles.container}>
            <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: COLORS.background,
    },
});
