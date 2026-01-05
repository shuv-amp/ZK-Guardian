import Constants from 'expo-constants';

/**
 * Environment configuration for ZK Guardian Mobile App.
 * 
 * For local development: Set your machine's IP if testing on a physical device.
 * For production: These should be set during EAS build via app.config.js or environment variables.
 */

// Read from Expo Constants (set via app.config.js extra field or EAS secrets)
const getExtraConfig = () => {
    const extra = Constants.expoConfig?.extra || {};
    return {
        gatewayUrl: extra.GATEWAY_URL as string | undefined,
        wsUrl: extra.WS_URL as string | undefined,
    };
};

import { Platform } from 'react-native';

const DEFAULTS = {
    development: {
        // Use 'localhost' for simulator, or your LAN IP for physical device
        // Android Emulator uses 10.0.2.2 for localhost
        GATEWAY_URL: Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000',
        WS_URL: Platform.OS === 'android' ? 'ws://10.0.2.2:3000/ws/consent' : 'ws://localhost:3000/ws/consent',
    },
    production: {
        // These MUST be overridden via EAS secrets or app.config.js
        GATEWAY_URL: '', // Placeholder - will be set during deployment
        WS_URL: '',
    }
};

export const getConfig = () => {
    const extra = getExtraConfig();

    if (__DEV__) {
        return {
            GATEWAY_URL: extra.gatewayUrl || DEFAULTS.development.GATEWAY_URL,
            WS_URL: extra.wsUrl || DEFAULTS.development.WS_URL,
            IS_CONFIGURED: true, // Dev always works with localhost
        };
    }

    // Production: Require explicit configuration
    const gatewayUrl = extra.gatewayUrl || DEFAULTS.production.GATEWAY_URL;
    const wsUrl = extra.wsUrl || DEFAULTS.production.WS_URL;

    return {
        GATEWAY_URL: gatewayUrl,
        WS_URL: wsUrl,
        IS_CONFIGURED: !!gatewayUrl && !!wsUrl,
    };
};

export const config = getConfig();

/**
 * Validates that the app is properly configured to connect to the backend.
 * Should be called at app launch and show an error screen if false.
 */
export const isBackendConfigured = (): boolean => {
    return config.IS_CONFIGURED;
};
