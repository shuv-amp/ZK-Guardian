/**
 * Certificate Pinning Utility
 *
 * Production traffic must use native TLS pinning. We intentionally fail closed
 * when pin data or native support is missing so releases cannot silently fall
 * back to standard fetch.
 */

import { NativeModules, Platform } from 'react-native';
import { config, TlsPinConfig } from '../config/env';

const nativeSslPinning = (NativeModules as Record<string, any>)?.RNSslPinning;

function getPinConfigForHost(hostname: string): TlsPinConfig | null {
    for (const [configuredHost, pinConfig] of Object.entries(config.TLS_PIN_MAP)) {
        if (configuredHost === hostname) {
            return pinConfig;
        }

        if (pinConfig.includeSubdomains === true && hostname.endsWith(`.${configuredHost}`)) {
            return pinConfig;
        }
    }

    return null;
}

function assertHttpsUrl(url: string): URL {
    const parsed = new URL(url);

    if (!__DEV__ && parsed.protocol !== 'https:') {
        throw new CertificatePinningError(`Production requests must use HTTPS: ${url}`, parsed.hostname);
    }

    return parsed;
}

function buildNativePinConfig(pinConfig: TlsPinConfig) {
    return pinConfig.pins.map((pin) =>
        Platform.OS === 'ios'
            ? { publicKeyHash: pin }
            : { 'sha256/hash': pin }
    );
}

function buildResponseBody(nativeResponse: any): string {
    if (typeof nativeResponse?.bodyString === 'string') {
        return nativeResponse.bodyString;
    }

    if (typeof nativeResponse?.data === 'string') {
        return nativeResponse.data;
    }

    if (nativeResponse?.data !== undefined) {
        return JSON.stringify(nativeResponse.data);
    }

    if (nativeResponse?.body !== undefined) {
        return typeof nativeResponse.body === 'string'
            ? nativeResponse.body
            : JSON.stringify(nativeResponse.body);
    }

    return '';
}

export async function validateCertificate(hostname: string): Promise<boolean> {
    if (__DEV__) {
        return true;
    }

    const pinConfig = getPinConfigForHost(hostname);
    return !!pinConfig && pinConfig.pins.length > 0 && typeof nativeSslPinning?.fetch === 'function';
}

export async function pinnedFetch(url: string, options?: RequestInit): Promise<Response> {
    const parsedUrl = assertHttpsUrl(url);

    if (__DEV__) {
        return fetch(url, options);
    }

    const pinConfig = getPinConfigForHost(parsedUrl.hostname);
    if (!pinConfig || pinConfig.pins.length === 0) {
        throw new CertificatePinningError(
            `No TLS pins configured for ${parsedUrl.hostname}`,
            parsedUrl.hostname
        );
    }

    if (typeof nativeSslPinning?.fetch !== 'function') {
        throw new CertificatePinningError(
            `Native TLS pinning is unavailable for ${parsedUrl.hostname}`,
            parsedUrl.hostname
        );
    }

    try {
        const response = await nativeSslPinning.fetch(url, {
            method: options?.method || 'GET',
            headers: options?.headers,
            body: options?.body,
            timeoutInterval: 30000,
            sslPinning: {
                certs: buildNativePinConfig(pinConfig)
            }
        });

        return new Response(buildResponseBody(response), {
            status: response.status,
            headers: new Headers(response.headers || {})
        });
    } catch (error: any) {
        throw new CertificatePinningError(
            `TLS pinning validation failed for ${parsedUrl.hostname}: ${error?.message || 'Unknown error'}`,
            parsedUrl.hostname
        );
    }
}

export class CertificatePinningError extends Error {
    public readonly hostname: string;

    constructor(message: string, hostname?: string) {
        super(message);
        this.name = 'CertificatePinningError';
        this.hostname = hostname || 'unknown';
    }
}

export function getPinnedHostnames(): string[] {
    return Object.keys(config.TLS_PIN_MAP);
}

export function isPinningEnabled(): boolean {
    if (__DEV__) {
        return false;
    }

    return getPinnedHostnames().length > 0 && typeof nativeSslPinning?.fetch === 'function';
}

export default {
    pinnedFetch,
    validateCertificate,
    getPinnedHostnames,
    isPinningEnabled,
    CertificatePinningError
};
