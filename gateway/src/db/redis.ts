// eslint-disable-next-line @typescript-eslint/no-var-requires
import Redis from 'ioredis';

/**
 * Redis Client
 * 
 * Used for:
 * - Rate limiting (ephemeral counters)
 * - Batch proof queue
 * - WebSocket session tracking
 */

// Use the default export constructor
const RedisClient = (Redis as any).default || Redis;

let redisClient: InstanceType<typeof RedisClient> | null = null;

export function getRedis() {
    if (!redisClient) {
        const url = process.env.REDIS_URL || 'redis://localhost:6379';

        redisClient = new RedisClient(url, {
            maxRetriesPerRequest: 3,
            enableReadyCheck: true,
            lazyConnect: true
        });

        redisClient.on('connect', () => {
            console.log('[Redis] Connected');
        });

        redisClient.on('error', (err: Error) => {
            console.error('[Redis] Error:', err.message);
        });

        redisClient.on('reconnecting', () => {
            console.log('[Redis] Reconnecting...');
        });
    }

    return redisClient!;
}

/**
 * Check if Redis is connected
 */
export async function testRedisConnection(): Promise<boolean> {
    try {
        const redis = getRedis();
        await redis.connect();
        const pong = await redis.ping();
        return pong === 'PONG';
    } catch (error) {
        console.error('[Redis] Connection test failed:', error);
        return false;
    }
}

/**
 * Graceful shutdown
 */
export async function disconnectRedis(): Promise<void> {
    if (redisClient) {
        await redisClient.quit();
        redisClient = null;
    }
}

// ============================================
// Rate Limiting Helpers
// ============================================

interface RateLimitResult {
    allowed: boolean;
    remaining: number;
    resetAt: number;
}

export async function checkRateLimit(
    key: string,
    limit: number,
    windowSeconds: number
): Promise<RateLimitResult> {
    const redis = getRedis();
    const now = Math.floor(Date.now() / 1000);
    const windowKey = `rate:${key}:${Math.floor(now / windowSeconds)}`;

    const count = await redis.incr(windowKey);

    if (count === 1) {
        await redis.expire(windowKey, windowSeconds);
    }

    return {
        allowed: count <= limit,
        remaining: Math.max(0, limit - count),
        resetAt: (Math.floor(now / windowSeconds) + 1) * windowSeconds
    };
}

// ============================================
// Batch Queue Helpers
// ============================================

export async function enqueueBatchProof(proof: object): Promise<number> {
    const redis = getRedis();
    return redis.rpush('batch_proof_queue', JSON.stringify(proof));
}

export async function dequeueBatchProofs(count: number): Promise<object[]> {
    const redis = getRedis();
    const items = await redis.lrange('batch_proof_queue', 0, count - 1);

    if (items.length > 0) {
        await redis.ltrim('batch_proof_queue', items.length, -1);
    }

    return items.map((item: string) => JSON.parse(item));
}

export async function getBatchQueueSize(): Promise<number> {
    const redis = getRedis();
    return redis.llen('batch_proof_queue');
}
