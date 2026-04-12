import Constants from 'expo-constants';
import { Platform } from 'react-native';

export interface TlsPinConfig {
    pins: string[];
    includeSubdomains?: boolean;
}

export type TlsPinMap = Record<string, TlsPinConfig>;

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
        enableDevDirectLogin: extra.ENABLE_DEV_DIRECT_LOGIN as string | boolean | undefined,
        tlsPinMap: extra.TLS_PIN_MAP as string | TlsPinMap | undefined,
    };
};

const getDevGatewayBase = () => {
    if (Constants.isDevice) {
        return 'http://localhost:3000';
    }

    // Android emulator uses 10.0.2.2 to reach the host machine.
    if (Platform.OS === 'android') {
        return 'http://10.0.2.2:3000';
    }

    return 'http://localhost:3000';
};

const DEFAULTS = {
    development: {
        // Use 'localhost' for Simulator, but for Physical Devices use your LAN IP (e.g., 192.168.1.x)
        // For now, we default to localhost, but you should update this if testing on a real device.
        // Network-discovered LAN IP for reliable device connectivity
        GATEWAY_URL: getDevGatewayBase(),
        WS_URL: getDevGatewayBase().replace('http://', 'ws://') + '/ws/consent',
        POLYGON_AMOY_RPC: 'https://rpc-amoy.polygon.technology',
        REVOCATION_REGISTRY_ADDRESS: '', // Set from deployment
        ENABLE_DEV_DIRECT_LOGIN: true,
    },
    production: {
        // These MUST be overridden via EAS secrets or app.config.js
        GATEWAY_URL: '', // Placeholder - will be set during deployment
        WS_URL: '',
        POLYGON_AMOY_RPC: 'https://rpc-amoy.polygon.technology',
        REVOCATION_REGISTRY_ADDRESS: '',
        ENABLE_DEV_DIRECT_LOGIN: false,
    }
};

const parseBoolean = (value: string | boolean | undefined, fallback: boolean): boolean => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
        if (['false', '0', 'no', 'off'].includes(normalized)) return false;
    }
    return fallback;
};

const hasSecureTransport = (gatewayUrl: string, wsUrl: string): boolean => {
    return gatewayUrl.startsWith('https://') && wsUrl.startsWith('wss://');
};

const parseTlsPinMap = (value: string | TlsPinMap | undefined): TlsPinMap => {
    if (!value) {
        return {};
    }

    let raw: unknown = value;
    if (typeof value === 'string') {
        try {
            raw = JSON.parse(value);
        } catch {
            return {};
        }
    }

    if (!raw || typeof raw !== 'object') {
        return {};
    }

    const pinMap: TlsPinMap = {};

    for (const [hostname, configValue] of Object.entries(raw as Record<string, unknown>)) {
        let pins: string[] = [];
        let includeSubdomains = false;

        if (Array.isArray(configValue)) {
            pins = configValue.filter((pin): pin is string => typeof pin === 'string' && pin.trim().length > 0);
        } else if (typeof configValue === 'string') {
            pins = configValue.split(',').map(pin => pin.trim()).filter(Boolean);
        } else if (configValue && typeof configValue === 'object') {
            const candidate = configValue as { pins?: unknown; includeSubdomains?: unknown };
            if (Array.isArray(candidate.pins)) {
                pins = candidate.pins.filter((pin): pin is string => typeof pin === 'string' && pin.trim().length > 0);
            }
            includeSubdomains = candidate.includeSubdomains === true;
        }

        if (pins.length > 0) {
            pinMap[hostname] = { pins, includeSubdomains };
        }
    }

    return pinMap;
};

const hasPinnedHost = (url: string, pinMap: TlsPinMap): boolean => {
    try {
        const hostname = new URL(url).hostname;
        return Object.entries(pinMap).some(([configuredHost, config]) =>
            configuredHost === hostname ||
            (config.includeSubdomains === true && hostname.endsWith(`.${configuredHost}`))
        );
    } catch {
        return false;
    }
};

export const getConfig = () => {
    const extra = getExtraConfig();
    const tlsPinMap = parseTlsPinMap(extra.tlsPinMap);

    if (__DEV__) {
        return {
            GATEWAY_URL: extra.gatewayUrl || DEFAULTS.development.GATEWAY_URL,
            WS_URL: extra.wsUrl || DEFAULTS.development.WS_URL,
            polygonRpcUrl: extra.polygonRpcUrl || DEFAULTS.development.POLYGON_AMOY_RPC,
            revocationRegistryAddress: extra.revocationRegistryAddress || DEFAULTS.development.REVOCATION_REGISTRY_ADDRESS,
            ENABLE_DEV_DIRECT_LOGIN: parseBoolean(extra.enableDevDirectLogin, DEFAULTS.development.ENABLE_DEV_DIRECT_LOGIN),
            TLS_PIN_MAP: tlsPinMap,
            IS_CONFIGURED: true, // Dev always works with localhost
        };
    }

    // Production: Require explicit configuration
    const gatewayUrl = extra.gatewayUrl || DEFAULTS.production.GATEWAY_URL;
    const wsUrl = extra.wsUrl || DEFAULTS.production.WS_URL;
    const secureTransport = hasSecureTransport(gatewayUrl, wsUrl);
    const isSupportedRuntime = Platform.OS !== 'web';
    const hasGatewayPins = hasPinnedHost(gatewayUrl, tlsPinMap);

    return {
        GATEWAY_URL: gatewayUrl,
        WS_URL: wsUrl,
        polygonRpcUrl: extra.polygonRpcUrl || DEFAULTS.production.POLYGON_AMOY_RPC,
        revocationRegistryAddress: extra.revocationRegistryAddress || DEFAULTS.production.REVOCATION_REGISTRY_ADDRESS,
        ENABLE_DEV_DIRECT_LOGIN: parseBoolean(extra.enableDevDirectLogin, DEFAULTS.production.ENABLE_DEV_DIRECT_LOGIN),
        TLS_PIN_MAP: tlsPinMap,
        IS_CONFIGURED: !!gatewayUrl && !!wsUrl && secureTransport && isSupportedRuntime && hasGatewayPins,
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
