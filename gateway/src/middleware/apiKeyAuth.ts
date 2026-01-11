/**
 * API Key Authentication Middleware
 * 
 * Validates API keys and enforces scope-based access control.
 * 
 * Usage:
 *   - Bearer token: Authorization: Bearer zkg_xxxxx
 *   - Header: X-API-Key: zkg_xxxxx
 */

import { Request, Response, NextFunction } from 'express';
import { apiKeyService, ValidatedAPIKey, APIScope } from '../modules/identity/apiKeyService.js';
import { tenantService } from '../modules/identity/tenantService.js';
import { logger } from '../lib/logger.js';
import { rateLimitCounter } from '../metrics/prometheus.js';

// Extend Express Request
declare global {
    namespace Express {
        interface Request {
            apiKey?: ValidatedAPIKey;
        }
    }
}

/**
 * API Key authentication middleware
 * 
 * Validates the API key and attaches key info + tenant to request.
 */
export async function apiKeyAuth(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const rawKey = extractAPIKey(req);

        if (!rawKey) {
            res.status(401).json({
                error: 'API_KEY_REQUIRED',
                message: 'API key required. Use Authorization: Bearer <key> or X-API-Key header.'
            });
            return;
        }

        const apiKey = await apiKeyService.validateKey(rawKey);

        if (!apiKey) {
            logger.warn({ keyPrefix: rawKey.slice(0, 12) }, 'Invalid API key attempt');
            res.status(401).json({
                error: 'INVALID_API_KEY',
                message: 'The provided API key is invalid, expired, or revoked.'
            });
            return;
        }

        // Get tenant
        const tenant = await tenantService.getTenant(apiKey.tenantId);
        if (!tenant || tenant.status !== 'active') {
            res.status(403).json({
                error: 'TENANT_INACTIVE',
                message: 'The associated tenant is not active.'
            });
            return;
        }

        // Attach to request
        req.apiKey = apiKey;
        req.tenant = tenant;
        req.tenantId = tenant.id;

        // Set RLS context
        await tenantService.setTenantContext(tenant.id);

        next();
    } catch (error: any) {
        logger.error({ error: error.message }, 'API key auth error');
        res.status(500).json({
            error: 'AUTH_ERROR',
            message: 'Authentication failed'
        });
    }
}

/**
 * Require specific scopes for an endpoint
 * 
 * Usage: app.get('/api/data', apiKeyAuth, requireScopes('fhir:read'), handler)
 */
export function requireScopes(...scopes: APIScope[]) {
    return (req: Request, res: Response, next: NextFunction): void => {
        if (!req.apiKey) {
            res.status(401).json({
                error: 'AUTH_REQUIRED',
                message: 'Authentication required'
            });
            return;
        }

        const missing = scopes.filter(scope => !req.apiKey!.hasScope(scope));

        if (missing.length > 0) {
            logger.warn({
                keyId: req.apiKey.id,
                required: scopes,
                missing
            }, 'Insufficient API key scopes');

            res.status(403).json({
                error: 'INSUFFICIENT_SCOPES',
                message: `Missing required scopes: ${missing.join(', ')}`,
                required: scopes,
                missing
            });
            return;
        }

        next();
    };
}

/**
 * Optional API key auth - continues if no key provided
 */
export async function optionalApiKeyAuth(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    const rawKey = extractAPIKey(req);

    if (!rawKey) {
        return next();
    }

    const apiKey = await apiKeyService.validateKey(rawKey);

    if (apiKey) {
        req.apiKey = apiKey;

        const tenant = await tenantService.getTenant(apiKey.tenantId);
        if (tenant && tenant.status === 'active') {
            req.tenant = tenant;
            req.tenantId = tenant.id;
            await tenantService.setTenantContext(tenant.id);
        }
    }

    next();
}

/**
 * Combined auth: API key OR SMART auth
 * 
 * Useful for endpoints that support both machine and user access.
 */
export async function flexibleAuth(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    // Try API key first
    const rawKey = extractAPIKey(req);
    if (rawKey) {
        return apiKeyAuth(req, res, next);
    }

    // Fall back to SMART auth (imported dynamically to avoid circular deps)
    const { smartAuthMiddleware } = await import('./smartAuth.js');
    return smartAuthMiddleware(req, res, next);
}

// Helpers

function extractAPIKey(req: Request): string | null {
    // Check Authorization header (Bearer token)
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        if (token.startsWith('zkg_')) {
            return token;
        }
    }

    // Check X-API-Key header
    const apiKeyHeader = req.headers['x-api-key'] as string;
    if (apiKeyHeader?.startsWith('zkg_')) {
        return apiKeyHeader;
    }

    return null;
}

export default apiKeyAuth;
