/**
 * Admin API Routes
 * 
 * Enterprise administration endpoints for:
 * - Tenant management
 * - API key management
 * - Webhook configuration
 */

import { Router, Request, Response, NextFunction } from 'express';
import { tenantService } from '../services/tenantService.js';
import { apiKeyService, APIScope } from '../services/apiKeyService.js';
import { webhookService, WebhookEventType } from '../services/webhookService.js';
import { keysRouter } from './admin/keys.js';
import { complianceRouter } from './admin/compliance.js';
import { logger } from '../lib/logger.js';
import { requireScopes } from '../middleware/apiKeyAuth.js';
import { z } from 'zod';

export const adminRouter: Router = Router();

// === Tenant Management ===

const CreateTenantSchema = z.object({
    name: z.string().min(1).max(100),
    domain: z.string().min(1).max(255).toLowerCase(),
    config: z.object({
        fhirEndpoint: z.string().url().optional(),
        consentTimeoutSeconds: z.number().min(30).max(300).optional()
    }).optional()
});

/**
 * POST /api/admin/tenants
 * Create a new tenant
 */
adminRouter.post('/tenants', requireScopes('admin:write'), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const input = CreateTenantSchema.parse(req.body);
        const tenant = await tenantService.createTenant(input);
        res.status(201).json({ tenant });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/admin/tenants
 * List all tenants
 */
adminRouter.get('/tenants', requireScopes('admin:read'), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const status = req.query.status as 'active' | 'suspended' | 'pending' | undefined;
        const result = await tenantService.listTenants({ status });
        res.json(result);
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/admin/tenants/:tenantId
 * Get tenant details
 */
adminRouter.get('/tenants/:tenantId', requireScopes('admin:read'), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const tenant = await tenantService.getTenant(req.params.tenantId);
        if (!tenant) {
            return res.status(404).json({ error: 'Tenant not found' });
        }
        res.json({ tenant });
    } catch (error) {
        next(error);
    }
});

// === API Key Management ===

const CreateAPIKeySchema = z.object({
    name: z.string().min(1).max(100),
    scopes: z.array(z.enum([
        'fhir:read', 'fhir:write',
        'consent:read', 'consent:write',
        'audit:read',
        'break_glass:read', 'break_glass:write',
        'admin:read', 'admin:write'
    ])),
    expiresInDays: z.number().min(1).max(365).optional()
});

/**
 * POST /api/admin/api-keys
 * Create a new API key for the current tenant
 */
adminRouter.post('/api-keys', requireScopes('admin:write'), async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (!req.tenantId) {
            return res.status(400).json({ error: 'Tenant required' });
        }

        const input = CreateAPIKeySchema.parse(req.body);
        const result = await apiKeyService.createKey(req.tenantId, {
            name: input.name,
            scopes: input.scopes as APIScope[],
            expiresInDays: input.expiresInDays
        });

        // Return the key - ONLY SHOWN ONCE
        res.status(201).json({
            key: result.key,
            info: result.info,
            warning: 'Save this key now. It will not be shown again.'
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/admin/api-keys
 * List all API keys for the current tenant
 */
adminRouter.get('/api-keys', requireScopes('admin:read'), async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (!req.tenantId) {
            return res.status(400).json({ error: 'Tenant required' });
        }

        const keys = await apiKeyService.listKeys(req.tenantId);
        const stats = await apiKeyService.getKeyStats(req.tenantId);

        res.json({ keys, stats });
    } catch (error) {
        next(error);
    }
});

/**
 * DELETE /api/admin/api-keys/:keyId
 * Revoke an API key
 */
adminRouter.delete('/api-keys/:keyId', requireScopes('admin:write'), async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (!req.tenantId) {
            return res.status(400).json({ error: 'Tenant required' });
        }

        await apiKeyService.revokeKey(req.tenantId, req.params.keyId);
        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/admin/api-keys/:keyId/rotate
 * Rotate an API key (revoke old, create new)
 */
adminRouter.post('/api-keys/:keyId/rotate', requireScopes('admin:write'), async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (!req.tenantId) {
            return res.status(400).json({ error: 'Tenant required' });
        }

        const result = await apiKeyService.rotateKey(req.tenantId, req.params.keyId);

        res.json({
            newKey: result.newKey,
            info: result.info,
            oldKeyId: result.oldKeyId,
            warning: 'Save this key now. It will not be shown again.'
        });
    } catch (error) {
        next(error);
    }
});

// === Webhook Management ===

const CreateWebhookSchema = z.object({
    url: z.string().url(),
    events: z.array(z.enum([
        'consent.requested', 'consent.approved', 'consent.denied', 'consent.timeout', 'consent.revoked',
        'access.granted', 'access.denied',
        'break_glass.initiated', 'break_glass.closed',
        'audit.verified', 'alert.created'
    ])),
    description: z.string().max(500).optional()
});

/**
 * POST /api/admin/webhooks
 * Create a webhook endpoint
 */
adminRouter.post('/webhooks', requireScopes('admin:write'), async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (!req.tenantId) {
            return res.status(400).json({ error: 'Tenant required' });
        }

        const input = CreateWebhookSchema.parse(req.body);
        const endpoint = await webhookService.createEndpoint(req.tenantId, {
            url: input.url,
            events: input.events as WebhookEventType[],
            description: input.description
        });

        res.status(201).json({
            endpoint,
            warning: 'Save the secret now. It will not be shown again.'
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/admin/webhooks
 * List webhook endpoints
 */
adminRouter.get('/webhooks', requireScopes('admin:read'), async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (!req.tenantId) {
            return res.status(400).json({ error: 'Tenant required' });
        }

        const endpoints = await webhookService.listEndpoints(req.tenantId);
        res.json({ endpoints });
    } catch (error) {
        next(error);
    }
});

/**
 * DELETE /api/admin/webhooks/:endpointId
 * Delete a webhook endpoint
 */
adminRouter.delete('/webhooks/:endpointId', requireScopes('admin:write'), async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (!req.tenantId) {
            return res.status(400).json({ error: 'Tenant required' });
        }

        await webhookService.deleteEndpoint(req.tenantId, req.params.endpointId);
        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/admin/webhooks/:endpointId/deliveries
 * Get delivery history for a webhook
 */
adminRouter.get('/webhooks/:endpointId/deliveries', requireScopes('admin:read'), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const deliveries = await webhookService.getDeliveries(req.params.endpointId);
        res.json({ deliveries });
    } catch (error) {
        next(error);
    }
});

// === Key Management ===
adminRouter.use('/keys', keysRouter);

// === Compliance Dashboard ===
adminRouter.use('/compliance', complianceRouter);

export default adminRouter;
