import { config } from '../config/env';
import { pinnedFetch } from './certificatePinning';

function ensureSecureProductionUrl(url: string): void {
    if (__DEV__) {
        return;
    }

    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') {
        throw new Error(`Production requests must use HTTPS: ${url}`);
    }
}

export async function secureFetch(url: string, options?: RequestInit): Promise<Response> {
    if (__DEV__) {
        return fetch(url, options);
    }

    if (!config.IS_CONFIGURED) {
        throw new Error('Mobile production transport is not fully configured');
    }

    ensureSecureProductionUrl(url);
    return pinnedFetch(url, options);
}
