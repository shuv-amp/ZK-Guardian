import { Request, Response, NextFunction } from 'express';
import { checkRateLimit } from '../db/redis.js';
import { logger, logSecurityEvent } from '../lib/logger.js';
import { RateLimitError } from '../lib/errors.js';

/**
 * Traffic Cop (Redis-backed)
 * 
 * Keeps our API from melting down under load.
 * We have different speed limits depending on what you're doing.
 * 
 * Limits:
 * - FHIR Read: 100/min (generous)
 * - Break-Glass: 3/hour (strict!)
 */

interface RateLimitConfig {
    limit: number;
    windowSeconds: number;
}

const RATE_LIMITS: Record<string, RateLimitConfig> = {
    'fhir-read': { limit: 100, windowSeconds: 60 },
    'fhir-search': { limit: 30, windowSeconds: 60 },
    'consent': { limit: 10, windowSeconds: 60 },
    'audit': { limit: 60, windowSeconds: 60 },
    'break-glass': { limit: 3, windowSeconds: 3600 }, // Whoa there, only 3 emergencies per hour?
    'default': { limit: 100, windowSeconds: 60 }
};

// Fallback memory store. If Redis dies, we don't want to crash.
const fallbackStore = new Map<string, { count: number; resetAt: number }>();

function getEndpointType(req: Request): string {
    const path = req.path.toLowerCase();
    const method = req.method.toUpperCase();

    if (path.includes('/break-glass')) return 'break-glass';
    if (path.includes('/consent')) return 'consent';
    if (path.includes('/access-history') || path.includes('/access-alerts')) return 'audit';
    if (path.startsWith('/fhir')) {
        return (method === 'GET' && Object.keys(req.query).length > 0)
            ? 'fhir-search'
            : 'fhir-read';
    }
    return 'default';
}

function getRateLimitKey(req: Request, endpointType: string): string {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const userId = (req as any).smartContext?.sub || 'anonymous';
    return `${ip}:${userId}:${endpointType}`;
}

/**
 * Redis-backed rate limiting with in-memory fallback
 */
export async function rateLimitMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    const endpointType = getEndpointType(req);
    const config = RATE_LIMITS[endpointType];
    const key = getRateLimitKey(req, endpointType);

    try {
        // Try Redis first
        const result = await checkRateLimit(key, config.limit, config.windowSeconds);

        res.setHeader('X-RateLimit-Limit', config.limit);
        res.setHeader('X-RateLimit-Remaining', result.remaining);
        res.setHeader('X-RateLimit-Reset', result.resetAt);

        if (!result.allowed) {
            const retryAfter = result.resetAt - Math.floor(Date.now() / 1000);

            logSecurityEvent({
                event: 'RATE_LIMIT',
                ip: req.ip,
                userId: (req as any).smartContext?.sub,
                details: `${endpointType} limit exceeded`
            });

            res.setHeader('Retry-After', retryAfter);
            throw new RateLimitError(retryAfter);
        }

        next();
    } catch (error) {
        if (error instanceof RateLimitError) {
            res.status(429).json(error.toJSON());
            return;
        }

        // Redis failed - use in-memory fallback
        logger.warn({ error }, 'Redis rate limit failed, using fallback');

        const now = Date.now();
        let entry = fallbackStore.get(key);

        if (!entry || now > entry.resetAt) {
            entry = { count: 0, resetAt: now + config.windowSeconds * 1000 };
        }

        entry.count++;
        fallbackStore.set(key, entry);

        const remaining = Math.max(0, config.limit - entry.count);
        res.setHeader('X-RateLimit-Limit', config.limit);
        res.setHeader('X-RateLimit-Remaining', remaining);
        res.setHeader('X-RateLimit-Reset', Math.floor(entry.resetAt / 1000));

        if (entry.count > config.limit) {
            const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
            res.setHeader('Retry-After', retryAfter);
            res.status(429).json(new RateLimitError(retryAfter).toJSON());
            return;
        }

        next();
    }
}

// Cleanup in-memory fallback periodically
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of fallbackStore.entries()) {
        if (now > entry.resetAt) {
            fallbackStore.delete(key);
        }
    }
}, 60000);

export { RATE_LIMITS };
