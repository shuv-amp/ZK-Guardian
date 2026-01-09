/**
 * Tenant Middleware
 * 
 * Extracts tenant context from request and sets up RLS.
 * 
 * Resolution order:
 * 1. X-Tenant-ID header (for API key auth)
 * 2. Subdomain (e.g., hospital-a.zkguardian.io)
 * 3. Origin header (for CORS-enabled web apps)
 */

import { Request, Response, NextFunction } from 'express';
import { tenantService, Tenant } from '../services/tenantService.js';
import { logger } from '../lib/logger.js';

// Extend Express Request
declare global {
    namespace Express {
        interface Request {
            tenant?: Tenant;
            tenantId?: string;
        }
    }
}

/**
 * Extract tenant context and set up RLS
 */
export async function tenantMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const tenant = await resolveTenant(req);

        if (!tenant) {
            // In development, allow requests without tenant
            if (process.env.NODE_ENV === 'development') {
                logger.debug('No tenant resolved, continuing in dev mode');
                return next();
            }

            res.status(400).json({
                error: 'TENANT_REQUIRED',
                message: 'Unable to determine tenant from request'
            });
            return;
        }

        // Check tenant status
        if (tenant.status !== 'active') {
            res.status(403).json({
                error: 'TENANT_SUSPENDED',
                message: 'This tenant account has been suspended'
            });
            return;
        }

        // Attach tenant to request
        req.tenant = tenant;
        req.tenantId = tenant.id;

        // Set PostgreSQL RLS context
        await tenantService.setTenantContext(tenant.id);

        // Add tenant ID to response headers (for debugging)
        res.setHeader('X-Tenant-ID', tenant.id);

        next();
    } catch (error: any) {
        logger.error({ error: error.message }, 'Tenant resolution failed');
        res.status(500).json({
            error: 'TENANT_ERROR',
            message: 'Failed to resolve tenant'
        });
    }
}

/**
 * Resolve tenant from request using multiple strategies
 */
async function resolveTenant(req: Request): Promise<Tenant | null> {
    // Strategy 1: Explicit header (highest priority)
    const headerTenantId = req.headers['x-tenant-id'] as string;
    if (headerTenantId) {
        return tenantService.getTenant(headerTenantId);
    }

    // Strategy 2: Subdomain
    const host = req.headers.host || '';
    const subdomain = extractSubdomain(host);
    if (subdomain) {
        return tenantService.resolveTenantByDomain(subdomain);
    }

    // Strategy 3: Origin header (for web apps)
    const origin = req.headers.origin as string;
    if (origin) {
        try {
            const url = new URL(origin);
            const originSubdomain = extractSubdomain(url.hostname);
            if (originSubdomain) {
                return tenantService.resolveTenantByDomain(originSubdomain);
            }
        } catch {
            // Invalid URL, skip
        }
    }

    // Strategy 4: Full domain match
    if (host) {
        const domain = host.split(':')[0]; // Remove port
        return tenantService.resolveTenantByDomain(domain);
    }

    return null;
}

/**
 * Extract subdomain from hostname
 * e.g., "hospital-a.zkguardian.io" -> "hospital-a"
 */
function extractSubdomain(hostname: string): string | null {
    const parts = hostname.split('.');

    // Ignore localhost and IP addresses
    if (hostname.includes('localhost') || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
        return null;
    }

    // Need at least 3 parts (subdomain.domain.tld)
    if (parts.length >= 3) {
        return parts[0];
    }

    return null;
}

/**
 * Require tenant to be resolved (strict mode)
 */
export function requireTenant(
    req: Request,
    res: Response,
    next: NextFunction
): void {
    if (!req.tenant) {
        res.status(400).json({
            error: 'TENANT_REQUIRED',
            message: 'This endpoint requires a valid tenant context'
        });
        return;
    }
    next();
}

/**
 * Get tenant config helper
 */
export function getTenantConfig<K extends keyof Tenant['config']>(
    req: Request,
    key: K
): Tenant['config'][K] | undefined {
    return req.tenant?.config[key];
}

export default tenantMiddleware;
