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
        polygonRpcUrl: extra.POLYGON_AMOY_RPC as string | undefined,
        revocationRegistryAddress: extra.CONSENT_REVOCATION_REGISTRY_ADDRESS as string | undefined,
    };
};

const DEFAULTS = {
    development: {
        // Use 'localhost' for Simulator, but for Physical Devices use your LAN IP (e.g., 192.168.1.x)
        // For now, we default to localhost, but you should update this if testing on a real device.
        // Network-discovered LAN IP for reliable device connectivity
        GATEWAY_URL: 'http://192.168.31.173:3000',
        WS_URL: 'ws://192.168.31.173:3000/ws/consent',
        POLYGON_AMOY_RPC: 'https://rpc-amoy.polygon.technology',
        REVOCATION_REGISTRY_ADDRESS: '', // Set from deployment
    },
    production: {
        // These MUST be overridden via EAS secrets or app.config.js
        GATEWAY_URL: '', // Placeholder - will be set during deployment
        WS_URL: '',
        POLYGON_AMOY_RPC: 'https://rpc-amoy.polygon.technology',
        REVOCATION_REGISTRY_ADDRESS: '',
    }
};

export const getConfig = () => {
    const extra = getExtraConfig();

    if (__DEV__) {
        return {
            GATEWAY_URL: extra.gatewayUrl || DEFAULTS.development.GATEWAY_URL,
            WS_URL: extra.wsUrl || DEFAULTS.development.WS_URL,
            polygonRpcUrl: extra.polygonRpcUrl || DEFAULTS.development.POLYGON_AMOY_RPC,
            revocationRegistryAddress: extra.revocationRegistryAddress || DEFAULTS.development.REVOCATION_REGISTRY_ADDRESS,
            IS_CONFIGURED: true, // Dev always works with localhost
        };
    }

    // Production: Require explicit configuration
    const gatewayUrl = extra.gatewayUrl || DEFAULTS.production.GATEWAY_URL;
    const wsUrl = extra.wsUrl || DEFAULTS.production.WS_URL;

    return {
        GATEWAY_URL: gatewayUrl,
        WS_URL: wsUrl,
        polygonRpcUrl: extra.polygonRpcUrl || DEFAULTS.production.POLYGON_AMOY_RPC,
        revocationRegistryAddress: extra.revocationRegistryAddress || DEFAULTS.production.REVOCATION_REGISTRY_ADDRESS,
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
