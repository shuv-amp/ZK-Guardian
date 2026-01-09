/**
 * Multi-Tenant Service
 * 
 * Enterprise-grade tenant management with:
 * - Tenant isolation via PostgreSQL Row-Level Security
 * - Per-tenant configuration (FHIR endpoint, timeouts, policies)
 * - Subdomain and header-based tenant resolution
 * - Secure tenant context propagation
 */

import { prisma } from '../db/client.js';
import { logger } from '../lib/logger.js';
import crypto from 'crypto';

// Types
export interface TenantConfig {
    fhirEndpoint: string;
    consentTimeoutSeconds: number;
    breakGlassPolicy: {
        requireWitness: boolean;
        maxDurationHours: number;
        notifyComplianceImmediately: boolean;
    };
    features: {
        webhooksEnabled: boolean;
        analyticsEnabled: boolean;
        customBranding: boolean;
    };
    rateLimit: {
        requestsPerMinute: number;
        proofsPerDay: number;
    };
}

export interface Tenant {
    id: string;
    name: string;
    domain: string;
    config: TenantConfig;
    status: 'active' | 'suspended' | 'pending';
    createdAt: Date;
    updatedAt: Date;
}

export interface CreateTenantInput {
    name: string;
    domain: string;
    config?: Partial<TenantConfig>;
}

// Default configuration for new tenants
const DEFAULT_CONFIG: TenantConfig = {
    fhirEndpoint: 'http://localhost:8080/fhir',
    consentTimeoutSeconds: 60,
    breakGlassPolicy: {
        requireWitness: false,
        maxDurationHours: 4,
        notifyComplianceImmediately: true
    },
    features: {
        webhooksEnabled: true,
        analyticsEnabled: true,
        customBranding: false
    },
    rateLimit: {
        requestsPerMinute: 300,
        proofsPerDay: 1000
    }
};

/**
 * Tenant Service
 * 
 * Manages multi-tenant configuration and isolation.
 */
class TenantService {
    private tenantCache = new Map<string, Tenant>();
    private domainCache = new Map<string, string>(); // domain -> tenantId

    /**
     * Create a new tenant
     */
    async createTenant(input: CreateTenantInput): Promise<Tenant> {
        const config = { ...DEFAULT_CONFIG, ...input.config };

        const tenant = await prisma.tenant.create({
            data: {
                name: input.name,
                domain: input.domain.toLowerCase(),
                config: JSON.stringify(config),
                status: 'active'
            }
        });

        const result = this.mapTenant(tenant);
        this.tenantCache.set(tenant.id, result);
        this.domainCache.set(input.domain.toLowerCase(), tenant.id);

        logger.info({ tenantId: tenant.id, domain: input.domain }, 'Tenant created');

        return result;
    }

    /**
     * Get tenant by ID
     */
    async getTenant(tenantId: string): Promise<Tenant | null> {
        // Check cache
        if (this.tenantCache.has(tenantId)) {
            return this.tenantCache.get(tenantId)!;
        }

        const tenant = await prisma.tenant.findUnique({
            where: { id: tenantId }
        });

        if (!tenant) return null;

        const result = this.mapTenant(tenant);
        this.tenantCache.set(tenantId, result);

        return result;
    }

    /**
     * Resolve tenant from domain (subdomain or custom domain)
     */
    async resolveTenantByDomain(domain: string): Promise<Tenant | null> {
        const normalizedDomain = domain.toLowerCase();

        // Check cache
        if (this.domainCache.has(normalizedDomain)) {
            const tenantId = this.domainCache.get(normalizedDomain)!;
            return this.getTenant(tenantId);
        }

        const tenant = await prisma.tenant.findUnique({
            where: { domain: normalizedDomain }
        });

        if (!tenant) return null;

        const result = this.mapTenant(tenant);
        this.tenantCache.set(tenant.id, result);
        this.domainCache.set(normalizedDomain, tenant.id);

        return result;
    }

    /**
     * Update tenant configuration
     */
    async updateTenantConfig(tenantId: string, config: Partial<TenantConfig>): Promise<Tenant> {
        const existing = await this.getTenant(tenantId);
        if (!existing) {
            throw new Error('TENANT_NOT_FOUND');
        }

        const newConfig = { ...existing.config, ...config };

        const updated = await prisma.tenant.update({
            where: { id: tenantId },
            data: {
                config: JSON.stringify(newConfig),
                updatedAt: new Date()
            }
        });

        const result = this.mapTenant(updated);
        this.tenantCache.set(tenantId, result);

        logger.info({ tenantId }, 'Tenant config updated');

        return result;
    }

    /**
     * Suspend a tenant (disable access)
     */
    async suspendTenant(tenantId: string, reason: string): Promise<void> {
        await prisma.tenant.update({
            where: { id: tenantId },
            data: { status: 'suspended' }
        });

        this.tenantCache.delete(tenantId);

        logger.warn({ tenantId, reason }, 'Tenant suspended');
    }

    /**
     * List all tenants (admin only)
     */
    async listTenants(options: {
        status?: 'active' | 'suspended' | 'pending';
        limit?: number;
        offset?: number;
    } = {}): Promise<{ tenants: Tenant[]; total: number }> {
        const where = options.status ? { status: options.status } : {};

        const [tenants, total] = await Promise.all([
            prisma.tenant.findMany({
                where,
                take: options.limit || 50,
                skip: options.offset || 0,
                orderBy: { createdAt: 'desc' }
            }),
            prisma.tenant.count({ where })
        ]);

        return {
            tenants: tenants.map(t => this.mapTenant(t)),
            total
        };
    }

    /**
     * Generate a unique tenant ID for new API keys
     */
    generateTenantSecret(): string {
        return crypto.randomBytes(32).toString('base64url');
    }

    /**
     * Set tenant context for database queries (RLS)
     * 
     * CRITICAL: Call this at the start of every request
     */
    async setTenantContext(tenantId: string): Promise<void> {
        // Set PostgreSQL session variable for RLS
        await prisma.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
    }

    /**
     * Clear cache (for testing or admin operations)
     */
    clearCache(): void {
        this.tenantCache.clear();
        this.domainCache.clear();
    }

    // Private methods

    private mapTenant(raw: any): Tenant {
        return {
            id: raw.id,
            name: raw.name,
            domain: raw.domain,
            config: typeof raw.config === 'string' ? JSON.parse(raw.config) : raw.config,
            status: raw.status,
            createdAt: raw.createdAt,
            updatedAt: raw.updatedAt || raw.createdAt
        };
    }
}

// Singleton
export const tenantService = new TenantService();

export default tenantService;
