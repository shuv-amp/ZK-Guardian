import React from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    ViewStyle,
    TextStyle
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

/**
 * Card Component
 * 
 * Reusable card container for consistent UI.
 * Per Development Guide §1.
 */

export interface CardProps {
    children: React.ReactNode;
    title?: string;
    subtitle?: string;
    icon?: keyof typeof Ionicons.glyphMap;
    iconColor?: string;
    onPress?: () => void;
    style?: ViewStyle;
    headerStyle?: ViewStyle;
    contentStyle?: ViewStyle;
    variant?: 'default' | 'elevated' | 'outlined' | 'filled';
    status?: 'default' | 'success' | 'warning' | 'error' | 'info';
    accessibilityLabel?: string;
}

export function Card({
    children,
    title,
    subtitle,
    icon,
    iconColor = '#007AFF',
    onPress,
    style,
    headerStyle,
    contentStyle,
    variant = 'default',
    status = 'default',
    accessibilityLabel
}: CardProps) {
    const cardVariantStyle = getVariantStyle(variant);
    const statusStyle = getStatusStyle(status);

    const content = (
        <View
            style={[styles.card, cardVariantStyle, statusStyle, style]}
            accessibilityLabel={accessibilityLabel}
            accessibilityRole={onPress ? 'button' : 'none'}
        >
            {/* Header */}
            {(title || icon) && (
                <View style={[styles.header, headerStyle]}>
                    {icon && (
                        <View style={[styles.iconContainer, { backgroundColor: `${iconColor}15` }]}>
                            <Ionicons name={icon} size={24} color={iconColor} />
                        </View>
                    )}
                    <View style={styles.headerText}>
                        {title && <Text style={styles.title}>{title}</Text>}
                        {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
                    </View>
                    {onPress && (
                        <Ionicons name="chevron-forward" size={20} color="#999" />
                    )}
                </View>
            )}

            {/* Content */}
            <View style={[styles.content, contentStyle]}>
                {children}
            </View>
        </View>
    );

    if (onPress) {
        return (
            <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
                {content}
            </TouchableOpacity>
        );
    }

    return content;
}

function getVariantStyle(variant: CardProps['variant']): ViewStyle {
    switch (variant) {
        case 'elevated':
            return {
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.15,
                shadowRadius: 12,
                elevation: 6
            };
        case 'outlined':
            return {
                backgroundColor: 'transparent',
                borderWidth: 1,
                borderColor: '#E0E0E0'
            };
        case 'filled':
            return {
                backgroundColor: '#F5F5F5'
            };
        default:
            return {
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.08,
                shadowRadius: 8,
                elevation: 3
            };
    }
}

function getStatusStyle(status: CardProps['status']): ViewStyle {
    switch (status) {
        case 'success':
            return { borderLeftWidth: 4, borderLeftColor: '#34C759' };
        case 'warning':
            return { borderLeftWidth: 4, borderLeftColor: '#FF9500' };
        case 'error':
            return { borderLeftWidth: 4, borderLeftColor: '#FF3B30' };
        case 'info':
            return { borderLeftWidth: 4, borderLeftColor: '#007AFF' };
        default:
            return {};
    }
}

const styles = StyleSheet.create({
    card: {
        backgroundColor: '#FFF',
        borderRadius: 16,
        padding: 16,
        marginBottom: 12
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 12
    },
    iconContainer: {
        width: 44,
        height: 44,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12
    },
    headerText: {
        flex: 1
    },
    title: {
        fontSize: 16,
        fontWeight: '600',
        color: '#1A1A1A'
    },
    subtitle: {
        fontSize: 13,
        color: '#666',
        marginTop: 2
    },
    content: {}
});

export default Card;
