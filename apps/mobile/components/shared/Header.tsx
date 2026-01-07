import React from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    StatusBar,
    Platform,
    ViewStyle
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Header Component
 * 
 * Reusable navigation header.
 * Per Development Guide §1.
 */

export interface HeaderProps {
    title: string;
    subtitle?: string;
    showBack?: boolean;
    onBack?: () => void;
    rightIcon?: keyof typeof Ionicons.glyphMap;
    onRightPress?: () => void;
    rightComponent?: React.ReactNode;
    transparent?: boolean;
    large?: boolean;
    style?: ViewStyle;
}

export function Header({
    title,
    subtitle,
    showBack = false,
    onBack,
    rightIcon,
    onRightPress,
    rightComponent,
    transparent = false,
    large = false,
    style
}: HeaderProps) {
    const router = useRouter();
    const insets = useSafeAreaInsets();

    const handleBack = () => {
        if (onBack) {
            onBack();
        } else if (router.canGoBack()) {
            router.back();
        }
    };

    return (
        <>
            <StatusBar
                barStyle={transparent ? 'light-content' : 'dark-content'}
                backgroundColor={transparent ? 'transparent' : '#FFF'}
            />
            <View
                style={[
                    styles.container,
                    transparent && styles.transparent,
                    { paddingTop: insets.top + 8 },
                    style
                ]}
            >
                <View style={styles.content}>
                    {/* Left - Back Button */}
                    <View style={styles.leftContainer}>
                        {showBack && (
                            <TouchableOpacity
                                onPress={handleBack}
                                style={styles.backButton}
                                accessibilityLabel="Go back"
                                accessibilityRole="button"
                            >
                                <Ionicons
                                    name="chevron-back"
                                    size={28}
                                    color={transparent ? '#FFF' : '#007AFF'}
                                />
                            </TouchableOpacity>
                        )}
                    </View>

                    {/* Center - Title */}
                    <View style={styles.titleContainer}>
                        {large ? (
                            <Text
                                style={[
                                    styles.largeTitle,
                                    transparent && styles.whiteText
                                ]}
                                numberOfLines={1}
                            >
                                {title}
                            </Text>
                        ) : (
                            <Text
                                style={[
                                    styles.title,
                                    transparent && styles.whiteText
                                ]}
                                numberOfLines={1}
                            >
                                {title}
                            </Text>
                        )}
                        {subtitle && (
                            <Text
                                style={[
                                    styles.subtitle,
                                    transparent && styles.whiteSubtitle
                                ]}
                                numberOfLines={1}
                            >
                                {subtitle}
                            </Text>
                        )}
                    </View>

                    {/* Right - Action */}
                    <View style={styles.rightContainer}>
                        {rightComponent}
                        {rightIcon && onRightPress && (
                            <TouchableOpacity
                                onPress={onRightPress}
                                style={styles.rightButton}
                                accessibilityRole="button"
                            >
                                <Ionicons
                                    name={rightIcon}
                                    size={24}
                                    color={transparent ? '#FFF' : '#007AFF'}
                                />
                            </TouchableOpacity>
                        )}
                    </View>
                </View>
            </View>
        </>
    );
}

/**
 * Large Header for home screens
 */
export function LargeHeader({
    title,
    subtitle,
    rightIcon,
    onRightPress,
    rightComponent,
    children
}: HeaderProps & { children?: React.ReactNode }) {
    const insets = useSafeAreaInsets();

    return (
        <View style={[styles.largeContainer, { paddingTop: insets.top + 16 }]}>
            <View style={styles.largeContent}>
                <View style={styles.largeTitleContainer}>
                    <Text style={styles.largeTitleText}>{title}</Text>
                    {subtitle && <Text style={styles.largeSubtitle}>{subtitle}</Text>}
                </View>
                <View style={styles.rightContainer}>
                    {rightComponent}
                    {rightIcon && onRightPress && (
                        <TouchableOpacity
                            onPress={onRightPress}
                            style={styles.largeRightButton}
                            accessibilityRole="button"
                        >
                            <Ionicons name={rightIcon} size={28} color="#007AFF" />
                        </TouchableOpacity>
                    )}
                </View>
            </View>
            {children}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        backgroundColor: '#FFF',
        borderBottomWidth: 1,
        borderBottomColor: '#F0F0F0',
        paddingBottom: 12
    },
    transparent: {
        backgroundColor: 'transparent',
        borderBottomWidth: 0
    },
    content: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16
    },
    leftContainer: {
        width: 44,
        alignItems: 'flex-start'
    },
    backButton: {
        padding: 4,
        marginLeft: -8
    },
    titleContainer: {
        flex: 1,
        alignItems: 'center'
    },
    title: {
        fontSize: 17,
        fontWeight: '600',
        color: '#1A1A1A'
    },
    largeTitle: {
        fontSize: 20,
        fontWeight: '700',
        color: '#1A1A1A'
    },
    subtitle: {
        fontSize: 12,
        color: '#666',
        marginTop: 2
    },
    whiteText: {
        color: '#FFF'
    },
    whiteSubtitle: {
        color: 'rgba(255, 255, 255, 0.8)'
    },
    rightContainer: {
        width: 44,
        alignItems: 'flex-end',
        flexDirection: 'row',
        justifyContent: 'flex-end'
    },
    rightButton: {
        padding: 4
    },

    // Large header styles
    largeContainer: {
        backgroundColor: '#FFF',
        paddingHorizontal: 20,
        paddingBottom: 16
    },
    largeContent: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start'
    },
    largeTitleContainer: {
        flex: 1
    },
    largeTitleText: {
        fontSize: 34,
        fontWeight: '700',
        color: '#1A1A1A',
        letterSpacing: -0.5
    },
    largeSubtitle: {
        fontSize: 15,
        color: '#666',
        marginTop: 4
    },
    largeRightButton: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: '#F0F0F0',
        justifyContent: 'center',
        alignItems: 'center'
    }
});

export default Header;
