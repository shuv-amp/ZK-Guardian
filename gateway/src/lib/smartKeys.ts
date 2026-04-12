import { calculateJwkThumbprint, exportJWK, generateKeyPair, importJWK, JWK } from 'jose';
import { env } from '../config/env.js';
import { logger } from './logger.js';

export interface SmartKeys {
    privateJwk: JWK;
    publicJwk: JWK;
    kid: string;
}

let cachedKeysPromise: Promise<SmartKeys> | null = null;

async function buildKeysFromEnv(): Promise<SmartKeys | null> {
    if (!env.SMART_PRIVATE_JWK) {
        return null;
    }

    let privateJwk: JWK;
    try {
        privateJwk = JSON.parse(env.SMART_PRIVATE_JWK) as JWK;
    } catch (error) {
        throw new Error('SMART_PRIVATE_JWK must be valid JSON');
    }

    if (!privateJwk.kty) {
        throw new Error('SMART_PRIVATE_JWK missing required "kty"');
    }

    const privateKey = await importJWK(privateJwk, 'RS256');
    const publicJwk = await exportJWK(privateKey);

    delete (publicJwk as any).d;
    delete (publicJwk as any).p;
    delete (publicJwk as any).q;
    delete (publicJwk as any).dp;
    delete (publicJwk as any).dq;
    delete (publicJwk as any).qi;

    publicJwk.use = 'sig';
    publicJwk.alg = 'RS256';

    const kid = await calculateJwkThumbprint(publicJwk);

    return { privateJwk, publicJwk, kid };
}

async function buildEphemeralKeys(): Promise<SmartKeys> {
    const { privateKey, publicKey } = await generateKeyPair('RS256', { modulusLength: 2048 });
    const privateJwk = await exportJWK(privateKey);
    const publicJwk = await exportJWK(publicKey);

    publicJwk.use = 'sig';
    publicJwk.alg = 'RS256';

    const kid = await calculateJwkThumbprint(publicJwk);

    logger.warn('SMART_PRIVATE_JWK not set - using ephemeral OAuth keys (dev only)');

    return { privateJwk, publicJwk, kid };
}

export async function getSmartKeys(): Promise<SmartKeys> {
    if (!cachedKeysPromise) {
        cachedKeysPromise = (async () => {
            const fromEnv = await buildKeysFromEnv();
            if (fromEnv) {
                return fromEnv;
            }

            if (env.NODE_ENV === 'production') {
                throw new Error('SMART_PRIVATE_JWK is required in production');
            }

            return buildEphemeralKeys();
        })();
    }

    return cachedKeysPromise;
}
