/**
 * Login Screen
 * Role selection + SMART on FHIR authentication
 */

import { useState } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    SafeAreaView,
    ActivityIndicator
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../hooks/useAuth';

type UserRole = 'patient' | 'clinician';

export default function LoginScreen() {
    const router = useRouter();
    const { login } = useAuth();
    const [selectedRole, setSelectedRole] = useState<UserRole>('patient');
    const [loading, setLoading] = useState(false);

    const handleLogin = async () => {
        setLoading(true);
        try {
            // TODO: Implement SMART on FHIR OAuth flow
            // For now, simulate login
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Mock token and user ID
            const mockToken = 'mock-jwt-token';
            const mockUserId = selectedRole === 'patient' ? 'patient-123' : 'practitioner-456';

            await login(mockToken, selectedRole, mockUserId);

            // Navigate to appropriate dashboard
            if (selectedRole === 'patient') {
                router.replace('/(patient)/dashboard');
            } else {
                router.replace('/(clinician)/dashboard');
            }
        } catch (error) {
            console.error('Login failed:', error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.content}>
                {/* Header */}
                <View style={styles.header}>
                    <Text style={styles.icon}>🛡️</Text>
                    <Text style={styles.title}>ZK Guardian</Text>
                    <Text style={styles.subtitle}>Privacy-Preserving Healthcare</Text>
                </View>

                {/* Role Selection */}
                <View style={styles.roleContainer}>
                    <Text style={styles.roleLabel}>I am a...</Text>

                    <View style={styles.roleButtons}>
                        <TouchableOpacity
                            style={[
                                styles.roleButton,
                                selectedRole === 'patient' && styles.roleButtonActive,
                            ]}
                            onPress={() => setSelectedRole('patient')}
                            disabled={loading}
                        >
                            <Text style={styles.roleIcon}>👤</Text>
                            <Text style={[
                                styles.roleText,
                                selectedRole === 'patient' && styles.roleTextActive,
                            ]}>
                                Patient
                            </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[
                                styles.roleButton,
                                selectedRole === 'clinician' && styles.roleButtonActive,
                            ]}
                            onPress={() => setSelectedRole('clinician')}
                            disabled={loading}
                        >
                            <Text style={styles.roleIcon}>🩺</Text>
                            <Text style={[
                                styles.roleText,
                                selectedRole === 'clinician' && styles.roleTextActive,
                            ]}>
                                Clinician
                            </Text>
                        </TouchableOpacity>
                    </View>
                </View>

                {/* Login Button */}
                <TouchableOpacity
                    style={[styles.loginButton, loading && styles.loginButtonDisabled]}
                    onPress={handleLogin}
                    disabled={loading}
                >
                    {loading ? (
                        <ActivityIndicator color="#fff" />
                    ) : (
                        <Text style={styles.loginButtonText}>
                            Sign in with SMART on FHIR
                        </Text>
                    )}
                </TouchableOpacity>

                {/* Footer */}
                <Text style={styles.footer}>
                    Secure • Private • HIPAA Compliant
                </Text>
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F0F4FF',
    },
    content: {
        flex: 1,
        justifyContent: 'center',
        paddingHorizontal: 24,
    },
    header: {
        alignItems: 'center',
        marginBottom: 48,
    },
    icon: {
        fontSize: 64,
        marginBottom: 16,
    },
    title: {
        fontSize: 32,
        fontWeight: '700',
        color: '#1F2937',
        marginBottom: 8,
    },
    subtitle: {
        fontSize: 16,
        color: '#6B7280',
    },
    roleContainer: {
        marginBottom: 32,
    },
    roleLabel: {
        fontSize: 16,
        fontWeight: '600',
        color: '#374151',
        marginBottom: 16,
        textAlign: 'center',
    },
    roleButtons: {
        flexDirection: 'row',
        gap: 12,
    },
    roleButton: {
        flex: 1,
        backgroundColor: '#fff',
        borderRadius: 16,
        padding: 20,
        alignItems: 'center',
        borderWidth: 2,
        borderColor: '#E5E7EB',
    },
    roleButtonActive: {
        borderColor: '#5B68DF',
        backgroundColor: '#EEF2FF',
    },
    roleIcon: {
        fontSize: 32,
        marginBottom: 8,
    },
    roleText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#6B7280',
    },
    roleTextActive: {
        color: '#5B68DF',
    },
    loginButton: {
        backgroundColor: '#5B68DF',
        borderRadius: 12,
        padding: 16,
        alignItems: 'center',
        marginBottom: 24,
    },
    loginButtonDisabled: {
        backgroundColor: '#9CA3AF',
    },
    loginButtonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '600',
    },
    footer: {
        textAlign: 'center',
        color: '#9CA3AF',
        fontSize: 12,
    },
});
