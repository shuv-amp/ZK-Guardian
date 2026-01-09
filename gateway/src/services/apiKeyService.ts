/**
 * API Key Service
 * 
 * Enterprise-grade API key management with:
 * - Secure key generation (cryptographically random)
 * - SHA-256 hashing (key never stored in plain text)
 * - Scope-based access control
 * - Key rotation support
 * - Usage tracking
 */

import { prisma } from '../db/client.js';
import { logger } from '../lib/logger.js';
import crypto from 'crypto';

// Types
export interface APIKeyScopes {
    'fhir:read': boolean;
    'fhir:write': boolean;
    'consent:read': boolean;
    'consent:write': boolean;
    'audit:read': boolean;
    'break_glass:read': boolean;
    'break_glass:write': boolean;
    'admin:read': boolean;
    'admin:write': boolean;
}

export type APIScope = keyof APIKeyScopes;

export interface CreateAPIKeyInput {
    name: string;
    scopes: APIScope[];
    expiresInDays?: number;
}

export interface APIKeyInfo {
    id: string;
    tenantId: string;
    name: string;
    keyPrefix: string;
    scopes: string[];
    expiresAt: Date | null;
    lastUsedAt: Date | null;
    createdAt: Date;
    isExpired: boolean;
    isRevoked: boolean;
}

export interface ValidatedAPIKey extends APIKeyInfo {
    hasScope: (scope: APIScope) => boolean;
}

// Constants
const KEY_PREFIX = 'zkg_'; // ZK Guardian prefix
const KEY_LENGTH = 32; // 256 bits
const HASH_ALGORITHM = 'sha256';

/**
 * API Key Service
 * 
 * Manages API key lifecycle and validation.
 */
class APIKeyService {
    /**
     * Generate a new API key
     * 
     * IMPORTANT: The raw key is returned only once. Store it securely.
     */
    async createKey(tenantId: string, input: CreateAPIKeyInput): Promise<{
        key: string;
        info: APIKeyInfo;
    }> {
        // Generate cryptographically secure key
        const randomBytes = crypto.randomBytes(KEY_LENGTH);
        const rawKey = KEY_PREFIX + randomBytes.toString('base64url');
        const keyPrefix = rawKey.slice(0, 12); // First 12 chars for identification

        // Hash the key for storage
        const hashedKey = this.hashKey(rawKey);

        // Calculate expiration
        const expiresAt = input.expiresInDays
            ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
            : null;

        // Store in database
        const apiKey = await prisma.aPIKey.create({
            data: {
                tenantId,
                name: input.name,
                keyPrefix,
                hashedKey,
                scopes: input.scopes,
                expiresAt
            }
        });

        logger.info({
            tenantId,
            keyId: apiKey.id,
            keyPrefix,
            scopes: input.scopes
        }, 'API key created');

        return {
            key: rawKey, // Only returned once!
            info: this.mapKeyInfo(apiKey)
        };
    }

    /**
     * Validate an API key and return key info if valid
     */
    async validateKey(rawKey: string): Promise<ValidatedAPIKey | null> {
        // Basic format check
        if (!rawKey.startsWith(KEY_PREFIX)) {
            return null;
        }

        const hashedKey = this.hashKey(rawKey);

        // Find key by hash
        const apiKey = await prisma.aPIKey.findUnique({
            where: { hashedKey }
        });

        if (!apiKey) {
            return null;
        }

        // Check if revoked
        if (apiKey.revokedAt) {
            logger.warn({ keyId: apiKey.id }, 'Attempted use of revoked API key');
            return null;
        }

        // Check expiration
        if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
            logger.warn({ keyId: apiKey.id }, 'Attempted use of expired API key');
            return null;
        }

        // Update last used timestamp (async, don't wait)
        prisma.aPIKey.update({
            where: { id: apiKey.id },
            data: { lastUsedAt: new Date() }
        }).catch(() => { }); // Ignore errors

        const keyInfo = this.mapKeyInfo(apiKey);

        return {
            ...keyInfo,
            hasScope: (scope: APIScope) => keyInfo.scopes.includes(scope)
        };
    }

    /**
     * List all API keys for a tenant (without exposing the actual keys)
     */
    async listKeys(tenantId: string): Promise<APIKeyInfo[]> {
        const keys = await prisma.aPIKey.findMany({
            where: { tenantId },
            orderBy: { createdAt: 'desc' }
        });

        return keys.map(k => this.mapKeyInfo(k));
    }

    /**
     * Revoke an API key
     */
    async revokeKey(tenantId: string, keyId: string): Promise<void> {
        const key = await prisma.aPIKey.findFirst({
            where: { id: keyId, tenantId }
        });

        if (!key) {
            throw new Error('API_KEY_NOT_FOUND');
        }

        await prisma.aPIKey.update({
            where: { id: keyId },
            data: { revokedAt: new Date() }
        });

        logger.info({ tenantId, keyId }, 'API key revoked');
    }

    /**
     * Rotate an API key (revoke old, create new with same config)
     */
    async rotateKey(tenantId: string, keyId: string): Promise<{
        oldKeyId: string;
        newKey: string;
        info: APIKeyInfo;
    }> {
        const oldKey = await prisma.aPIKey.findFirst({
            where: { id: keyId, tenantId }
        });

        if (!oldKey) {
            throw new Error('API_KEY_NOT_FOUND');
        }

        // Create new key with same config
        const { key: newKey, info } = await this.createKey(tenantId, {
            name: `${oldKey.name} (rotated)`,
            scopes: oldKey.scopes as APIScope[]
        });

        // Revoke old key
        await this.revokeKey(tenantId, keyId);

        logger.info({ tenantId, oldKeyId: keyId, newKeyId: info.id }, 'API key rotated');

        return {
            oldKeyId: keyId,
            newKey,
            info
        };
    }

    /**
     * Get key statistics for a tenant
     */
    async getKeyStats(tenantId: string): Promise<{
        total: number;
        active: number;
        expired: number;
        revoked: number;
    }> {
        const now = new Date();

        const [total, revoked, expired] = await Promise.all([
            prisma.aPIKey.count({ where: { tenantId } }),
            prisma.aPIKey.count({ where: { tenantId, revokedAt: { not: null } } }),
            prisma.aPIKey.count({ where: { tenantId, expiresAt: { lt: now } } })
        ]);

        return {
            total,
            active: total - revoked - expired,
            expired,
            revoked
        };
    }

    // Private methods

    private hashKey(rawKey: string): string {
        return crypto.createHash(HASH_ALGORITHM).update(rawKey).digest('hex');
    }

    private mapKeyInfo(raw: any): APIKeyInfo {
        const now = new Date();
        return {
            id: raw.id,
            tenantId: raw.tenantId,
            name: raw.name,
            keyPrefix: raw.keyPrefix,
            scopes: raw.scopes,
            expiresAt: raw.expiresAt,
            lastUsedAt: raw.lastUsedAt,
            createdAt: raw.createdAt,
            isExpired: raw.expiresAt ? raw.expiresAt < now : false,
            isRevoked: !!raw.revokedAt
        };
    }
}

// Singleton
export const apiKeyService = new APIKeyService();

export default apiKeyService;
