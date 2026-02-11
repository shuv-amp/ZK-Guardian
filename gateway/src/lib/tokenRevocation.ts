import { getRedis } from '../db/redis.js';
import { logger } from './logger.js';

const REDIS_PREFIX = 'revoked:jti:';
const memoryRevoked = new Map<string, number>();

function cleanupMemoryRevocations(): void {
    const now = Date.now();
    for (const [jti, expMs] of memoryRevoked.entries()) {
        if (expMs <= now) {
            memoryRevoked.delete(jti);
        }
    }
}

export async function revokeToken(jti: string, expSeconds?: number): Promise<void> {
    const expiresAtMs = expSeconds ? expSeconds * 1000 : Date.now() + 3600 * 1000;

    try {
        const redis = getRedis();
        const ttlSeconds = Math.max(1, Math.floor((expiresAtMs - Date.now()) / 1000));
        await redis.setex(`${REDIS_PREFIX}${jti}`, ttlSeconds, '1');
        return;
    } catch (error) {
        logger.warn({ error }, 'Failed to store token revocation in Redis, using memory fallback');
    }

    memoryRevoked.set(jti, expiresAtMs);
    cleanupMemoryRevocations();
}

export async function isTokenRevoked(jti?: string): Promise<boolean> {
    if (!jti) return false;

    try {
        const redis = getRedis();
        const revoked = await redis.get(`${REDIS_PREFIX}${jti}`);
        return revoked === '1';
    } catch (error) {
        logger.warn({ error }, 'Failed to check token revocation in Redis, using memory fallback');
    }

    cleanupMemoryRevocations();
    const expMs = memoryRevoked.get(jti);
    if (!expMs) return false;

    return expMs > Date.now();
}
