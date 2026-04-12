import React, { useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    Modal,
    TouchableOpacity,
    TextInput,
    Alert
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, SPACING, RADIUS } from '../../constants/Theme';

/**
 * BreakGlassModal Component (Clinician)
 * 
 * Quick-access modal for initiating break-glass emergency access.
 */

interface BreakGlassModalProps {
    visible: boolean;
    onClose: () => void;
    onSubmit: (patientId: string, reason: string, justification: string) => Promise<void>;
}

const QUICK_REASONS = [
    { key: 'LIFE_THREATENING_EMERGENCY', label: 'Life-Threatening' },
    { key: 'UNCONSCIOUS_PATIENT', label: 'Unconscious Patient' },
    { key: 'PSYCHIATRIC_CRISIS', label: 'Psychiatric Crisis' },
];

export function BreakGlassModal({ visible, onClose, onSubmit }: BreakGlassModalProps) {
    const [patientId, setPatientId] = useState('');
    const [selectedReason, setSelectedReason] = useState<string | null>(null);
    const [justification, setJustification] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = async () => {
        if (!patientId.trim() || !selectedReason || justification.length < 20) {
            Alert.alert('Error', 'Please fill all required fields');
            return;
        }

        setIsSubmitting(true);
        try {
            await onSubmit(patientId, selectedReason, justification);
            resetForm();
            onClose();
        } catch {
            Alert.alert('Error', 'Failed to initiate break-glass');
        } finally {
            setIsSubmitting(false);
        }
    };

    const resetForm = () => {
        setPatientId('');
        setSelectedReason(null);
        setJustification('');
    };

    return (
        <Modal
            visible={visible}
            transparent
            animationType="slide"
            onRequestClose={onClose}
        >
            <View style={styles.overlay}>
                <View style={styles.modal}>
                    {/* Header */}
                    <View style={styles.header}>
                        <View style={styles.headerIcon}>
                            <Ionicons name="flash" size={24} color={COLORS.error} />
                        </View>
                        <Text style={styles.title}>Emergency Access</Text>
                        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                            <Ionicons name="close" size={24} color={COLORS.textSecondary} />
                        </TouchableOpacity>
                    </View>

                    {/* Warning */}
                    <View style={styles.warning}>
                        <Text style={styles.warningText}>
                            Break-glass bypasses consent. Use only for genuine emergencies.
                        </Text>
                    </View>

                    {/* Patient ID */}
                    <TextInput
                        style={styles.input}
                        placeholder="Patient ID"
                        value={patientId}
                        onChangeText={setPatientId}
                        autoCapitalize="none"
                        placeholderTextColor={COLORS.textTertiary}
                    />

                    {/* Quick Reasons */}
                    <View style={styles.reasonsRow}>
                        {QUICK_REASONS.map((reason) => (
                            <TouchableOpacity
                                key={reason.key}
                                style={[
                                    styles.reasonChip,
                                    selectedReason === reason.key && styles.reasonSelected
                                ]}
                                onPress={() => setSelectedReason(reason.key)}
                            >
                                <Text style={[
                                    styles.reasonText,
                                    selectedReason === reason.key && styles.reasonTextSelected
                                ]}>
                                    {reason.label}
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </View>

                    {/* Justification */}
                    <TextInput
                        style={[styles.input, styles.textArea]}
                        placeholder="Justification (min 20 chars)"
                        value={justification}
                        onChangeText={setJustification}
                        multiline
                        numberOfLines={3}
                        textAlignVertical="top"
                        placeholderTextColor={COLORS.textTertiary}
                    />

                    {/* Submit */}
                    <TouchableOpacity
                        style={[styles.submitButton, isSubmitting && styles.submitDisabled]}
                        onPress={handleSubmit}
                        disabled={isSubmitting}
                    >
                        <Ionicons name="flash" size={18} color={COLORS.surface} />
                        <Text style={styles.submitText}>
                            {isSubmitting ? 'Processing...' : 'Initiate Break-Glass'}
                        </Text>
                    </TouchableOpacity>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'flex-end',
    },
    modal: {
        backgroundColor: COLORS.surface,
        borderTopLeftRadius: RADIUS.xl,
        borderTopRightRadius: RADIUS.xl,
        padding: SPACING.lg,
        paddingBottom: 40,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: SPACING.md,
    },
    headerIcon: {
        width: 40,
        height: 40,
        borderRadius: RADIUS.full,
        backgroundColor: COLORS.errorBg,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: SPACING.md,
    },
    title: {
        fontSize: FONTS.sizes.lg,
        fontWeight: FONTS.weights.bold,
        color: COLORS.text,
        flex: 1,
    },
    closeButton: {
        padding: 4,
    },
    warning: {
        backgroundColor: COLORS.warningBg,
        padding: SPACING.md,
        borderRadius: RADIUS.md,
        marginBottom: SPACING.md,
    },
    warningText: {
        fontSize: FONTS.sizes.xs,
        color: '#92400E', // Keep specific dark amber
        textAlign: 'center',
    },
    input: {
        backgroundColor: COLORS.gray100,
        borderRadius: RADIUS.md,
        padding: 14,
        fontSize: FONTS.sizes.md,
        color: COLORS.text,
        marginBottom: SPACING.md,
    },
    textArea: {
        height: 80,
        paddingTop: 14,
    },
    reasonsRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: SPACING.sm,
        marginBottom: SPACING.md,
    },
    reasonChip: {
        paddingHorizontal: SPACING.md,
        paddingVertical: SPACING.sm,
        borderRadius: RADIUS.sm,
        backgroundColor: COLORS.gray100,
        borderWidth: 1,
        borderColor: COLORS.border,
    },
    reasonSelected: {
        backgroundColor: COLORS.primary,
        borderColor: COLORS.primary,
    },
    reasonText: {
        fontSize: FONTS.sizes.xs,
        color: COLORS.textSecondary,
        fontWeight: FONTS.weights.medium,
    },
    reasonTextSelected: {
        color: COLORS.surface,
    },
    submitButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: COLORS.error,
        paddingVertical: 14,
        borderRadius: RADIUS.md,
        marginTop: 4,
    },
    submitDisabled: {
        opacity: 0.6,
    },
    submitText: {
        fontSize: FONTS.sizes.md,
        fontWeight: FONTS.weights.bold,
        color: COLORS.surface,
    },
});
