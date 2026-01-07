import React from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Card from '../shared/Card';

/**
 * PatientCard Component
 * 
 * Displays patient summary for clinician views.
 * Per Development Guide §1.
 */

export interface PatientInfo {
    id: string;
    name: string;
    birthDate?: string;
    gender?: string;
    mrn?: string; // Medical Record Number
    lastAccess?: Date;
    hasActiveConsent?: boolean;
    consentExpiresAt?: Date;
}

export interface PatientCardProps {
    patient: PatientInfo;
    onPress?: (patient: PatientInfo) => void;
    onRequestAccess?: (patient: PatientInfo) => void;
    showAccessButton?: boolean;
    compact?: boolean;
}

export function PatientCard({
    patient,
    onPress,
    onRequestAccess,
    showAccessButton = true,
    compact = false
}: PatientCardProps) {
    const age = patient.birthDate ? calculateAge(patient.birthDate) : null;

    const getConsentStatus = () => {
        if (!patient.hasActiveConsent) {
            return { label: 'No Consent', color: '#FF9500', icon: 'alert-circle' as const };
        }
        if (patient.consentExpiresAt && patient.consentExpiresAt < new Date()) {
            return { label: 'Expired', color: '#FF3B30', icon: 'time' as const };
        }
        return { label: 'Active', color: '#34C759', icon: 'checkmark-circle' as const };
    };

    const status = getConsentStatus();

    if (compact) {
        return (
            <TouchableOpacity
                style={styles.compactContainer}
                onPress={() => onPress?.(patient)}
                disabled={!onPress}
            >
                <View style={styles.avatar}>
                    <Text style={styles.avatarText}>
                        {getInitials(patient.name)}
                    </Text>
                </View>
                <View style={styles.compactInfo}>
                    <Text style={styles.compactName} numberOfLines={1}>
                        {patient.name}
                    </Text>
                    <Text style={styles.compactMrn}>
                        MRN: {patient.mrn || patient.id.slice(0, 8)}
                    </Text>
                </View>
                <View style={[styles.statusBadge, { backgroundColor: `${status.color}20` }]}>
                    <Ionicons name={status.icon} size={14} color={status.color} />
                </View>
            </TouchableOpacity>
        );
    }

    return (
        <Card
            variant="elevated"
            onPress={onPress ? () => onPress(patient) : undefined}
        >
            <View style={styles.header}>
                <View style={styles.avatar}>
                    <Text style={styles.avatarText}>
                        {getInitials(patient.name)}
                    </Text>
                </View>
                <View style={styles.headerInfo}>
                    <Text style={styles.name}>{patient.name}</Text>
                    <Text style={styles.details}>
                        {age && `${age} years`}
                        {age && patient.gender && ' • '}
                        {patient.gender}
                    </Text>
                </View>
                <View style={[styles.statusBadge, { backgroundColor: `${status.color}20` }]}>
                    <Ionicons name={status.icon} size={16} color={status.color} />
                    <Text style={[styles.statusText, { color: status.color }]}>
                        {status.label}
                    </Text>
                </View>
            </View>

            <View style={styles.infoRow}>
                <View style={styles.infoItem}>
                    <Text style={styles.infoLabel}>MRN</Text>
                    <Text style={styles.infoValue}>
                        {patient.mrn || patient.id.slice(0, 8)}
                    </Text>
                </View>
                {patient.lastAccess && (
                    <View style={styles.infoItem}>
                        <Text style={styles.infoLabel}>Last Access</Text>
                        <Text style={styles.infoValue}>
                            {formatDate(patient.lastAccess)}
                        </Text>
                    </View>
                )}
            </View>

            {showAccessButton && (
                <View style={styles.actions}>
                    <TouchableOpacity
                        style={[
                            styles.accessButton,
                            !patient.hasActiveConsent && styles.accessButtonPrimary
                        ]}
                        onPress={() => onRequestAccess?.(patient)}
                    >
                        <Ionicons
                            name={patient.hasActiveConsent ? 'document-text-outline' : 'key-outline'}
                            size={18}
                            color={patient.hasActiveConsent ? '#007AFF' : '#FFF'}
                        />
                        <Text style={[
                            styles.accessButtonText,
                            !patient.hasActiveConsent && styles.accessButtonTextPrimary
                        ]}>
                            {patient.hasActiveConsent ? 'View Records' : 'Request Access'}
                        </Text>
                    </TouchableOpacity>
                </View>
            )}
        </Card>
    );
}

function getInitials(name: string): string {
    return name
        .split(' ')
        .map(part => part[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
}

function calculateAge(birthDate: string): number {
    const birth = new Date(birthDate);
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
        age--;
    }
    return age;
}

function formatDate(date: Date): string {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    return date.toLocaleDateString();
}

const styles = StyleSheet.create({
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 16
    },
    avatar: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: '#007AFF',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12
    },
    avatarText: {
        fontSize: 18,
        fontWeight: '600',
        color: '#FFF'
    },
    headerInfo: {
        flex: 1
    },
    name: {
        fontSize: 17,
        fontWeight: '600',
        color: '#1A1A1A'
    },
    details: {
        fontSize: 13,
        color: '#666',
        marginTop: 2
    },
    statusBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 16,
        gap: 4
    },
    statusText: {
        fontSize: 12,
        fontWeight: '500'
    },
    infoRow: {
        flexDirection: 'row',
        marginBottom: 16
    },
    infoItem: {
        flex: 1
    },
    infoLabel: {
        fontSize: 11,
        fontWeight: '500',
        color: '#999',
        textTransform: 'uppercase',
        letterSpacing: 0.5
    },
    infoValue: {
        fontSize: 14,
        color: '#1A1A1A',
        marginTop: 2
    },
    actions: {
        borderTopWidth: 1,
        borderTopColor: '#F0F0F0',
        paddingTop: 12,
        marginTop: 4
    },
    accessButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 12,
        borderRadius: 10,
        backgroundColor: '#F0F7FF',
        gap: 8
    },
    accessButtonPrimary: {
        backgroundColor: '#007AFF'
    },
    accessButtonText: {
        fontSize: 15,
        fontWeight: '600',
        color: '#007AFF'
    },
    accessButtonTextPrimary: {
        color: '#FFF'
    },

    // Compact styles
    compactContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
        backgroundColor: '#FFF',
        borderRadius: 12,
        marginBottom: 8
    },
    compactInfo: {
        flex: 1,
        marginLeft: 12
    },
    compactName: {
        fontSize: 15,
        fontWeight: '500',
        color: '#1A1A1A'
    },
    compactMrn: {
        fontSize: 12,
        color: '#666',
        marginTop: 2
    }
});

export default PatientCard;
