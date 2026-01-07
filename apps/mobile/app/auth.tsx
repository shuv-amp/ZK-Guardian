/**
 * OAuth Callback Route Handler
 * 
 * This route catches the OAuth redirect from the authorization server.
 * After auth completes, it navigates to the appropriate dashboard.
 * 
 * Uses a ref to ensure navigation only happens once.
 */

import { useEffect, useRef, useState } from 'react';
import { View, ActivityIndicator, StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../hooks/useAuth';
import { COLORS, FONTS } from '../constants/Theme';

export default function AuthCallback() {
    const { isLoading, isAuthenticated, patientId, practitionerId } = useAuth();
    const router = useRouter();
    const hasNavigatedRef = useRef(false);
    const [status, setStatus] = useState('Processing...');

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
                    setStatus('Welcome, Patient!');
                    router.replace('/(patient)/dashboard');
                } else if (practitionerId) {
                    setStatus('Welcome, Clinician!');
                    router.replace('/(clinician)/dashboard');
                } else {
                    setStatus('No role found');
                    router.replace('/(auth)/login');
                }
            } else {
                setStatus('Authentication required');
                router.replace('/(auth)/login');
            }
        }, 100);

        return () => clearTimeout(timer);
    }, [isLoading, isAuthenticated, patientId, practitionerId, router]);

    return (
        <View style={styles.container}>
            <ActivityIndicator size="large" color={COLORS.primary} />
            <Text style={styles.text}>{status}</Text>
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
    text: {
        marginTop: 16,
        fontSize: 16,
        color: COLORS.textSecondary,
        ...FONTS.medium,
    },
});
