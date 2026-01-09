/**
 * Webhook Service
 * 
 * Enterprise-grade webhook delivery with:
 * - HMAC-SHA256 signature verification
 * - Exponential backoff retry logic
 * - At-least-once delivery guarantee
 * - Idempotency keys
 * - Dead letter queue for failed deliveries
 */

import { prisma } from '../db/client.js';
import { logger } from '../lib/logger.js';
import crypto from 'crypto';
import axios, { AxiosError } from 'axios';

// Types
export type WebhookEventType =
    | 'consent.requested'
    | 'consent.approved'
    | 'consent.denied'
    | 'consent.timeout'
    | 'consent.revoked'
    | 'access.granted'
    | 'access.denied'
    | 'break_glass.initiated'
    | 'break_glass.closed'
    | 'audit.verified'
    | 'alert.created';

export interface WebhookPayload {
    id: string;
    timestamp: string;
    type: WebhookEventType;
    tenantId: string;
    data: Record<string, unknown>;
}

export interface WebhookDeliveryResult {
    success: boolean;
    statusCode?: number;
    error?: string;
    duration: number;
}

// Configuration
const RETRY_DELAYS = [10000, 30000, 60000, 300000, 900000]; // 10s, 30s, 1m, 5m, 15m
const MAX_RETRIES = 5;
const DELIVERY_TIMEOUT_MS = 10000;

/**
 * Webhook Service
 * 
 * Manages webhook endpoint registration and event delivery.
 */
class WebhookService {
    private processing = false;
    private processingInterval: NodeJS.Timeout | null = null;

    /**
     * Start the webhook delivery processor
     */
    start(): void {
        if (this.processingInterval) return;

        this.processingInterval = setInterval(() => {
            this.processQueue();
        }, 5000); // Check every 5 seconds

        logger.info('Webhook delivery processor started');
    }

    /**
     * Stop the webhook delivery processor
     */
    stop(): void {
        if (this.processingInterval) {
            clearInterval(this.processingInterval);
            this.processingInterval = null;
        }
        logger.info('Webhook delivery processor stopped');
    }

    /**
     * Emit a webhook event to all subscribed endpoints
     */
    async emit(tenantId: string, eventType: WebhookEventType, data: Record<string, unknown>): Promise<void> {
        // Find all active endpoints subscribed to this event
        const endpoints = await prisma.webhookEndpoint.findMany({
            where: {
                tenantId,
                active: true,
                events: { has: eventType }
            }
        });

        if (endpoints.length === 0) {
            logger.debug({ tenantId, eventType }, 'No webhook endpoints for event');
            return;
        }

        // Create payload
        const payload: WebhookPayload = {
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            type: eventType,
            tenantId,
            data
        };

        // Queue deliveries for each endpoint
        for (const endpoint of endpoints) {
            await prisma.webhookDelivery.create({
                data: {
                    endpointId: endpoint.id,
                    eventType,
                    payload: JSON.stringify(payload),
                    status: 'pending'
                }
            });
        }

        logger.info({ tenantId, eventType, endpointCount: endpoints.length }, 'Webhook event queued');

        // Trigger immediate processing
        this.processQueue();
    }

    /**
     * Process pending webhook deliveries
     */
    private async processQueue(): Promise<void> {
        if (this.processing) return;
        this.processing = true;

        try {
            // Get pending deliveries (or failed ones ready for retry)
            const deliveries = await prisma.webhookDelivery.findMany({
                where: {
                    OR: [
                        { status: 'pending' },
                        {
                            status: 'failed',
                            attempts: { lt: MAX_RETRIES },
                            nextRetryAt: { lte: new Date() }
                        }
                    ]
                },
                include: {
                    endpoint: true
                },
                take: 50,
                orderBy: { createdAt: 'asc' }
            });

            for (const delivery of deliveries) {
                await this.deliver(delivery);
            }
        } catch (error: any) {
            logger.error({ error: error.message }, 'Webhook queue processing error');
        } finally {
            this.processing = false;
        }
    }

    /**
     * Attempt to deliver a webhook
     */
    private async deliver(delivery: any): Promise<void> {
        const { endpoint, id, payload } = delivery;
        const startTime = Date.now();

        try {
            // Generate signature
            const signature = this.sign(payload, endpoint.secret);

            // Deliver
            const response = await axios.post(endpoint.url, JSON.parse(payload), {
                headers: {
                    'Content-Type': 'application/json',
                    'X-Webhook-Signature': signature,
                    'X-Webhook-Event': delivery.eventType,
                    'X-Webhook-Delivery-ID': id,
                    'User-Agent': 'ZK-Guardian-Webhooks/1.0'
                },
                timeout: DELIVERY_TIMEOUT_MS
            });

            // Success
            await prisma.webhookDelivery.update({
                where: { id },
                data: {
                    status: 'delivered',
                    responseCode: response.status,
                    deliveredAt: new Date(),
                    attempts: { increment: 1 }
                }
            });

            logger.info({
                deliveryId: id,
                endpointUrl: endpoint.url,
                statusCode: response.status,
                duration: Date.now() - startTime
            }, 'Webhook delivered');

        } catch (error: any) {
            const isAxiosError = axios.isAxiosError(error);
            const statusCode = isAxiosError ? error.response?.status : undefined;
            const errorMessage = isAxiosError ? error.message : 'Unknown error';

            const attempts = delivery.attempts + 1;
            const shouldRetry = attempts < MAX_RETRIES;

            await prisma.webhookDelivery.update({
                where: { id },
                data: {
                    status: shouldRetry ? 'failed' : 'dead',
                    responseCode: statusCode,
                    responseBody: isAxiosError ? JSON.stringify(error.response?.data).slice(0, 1000) : undefined,
                    error: errorMessage,
                    attempts,
                    nextRetryAt: shouldRetry ? new Date(Date.now() + RETRY_DELAYS[Math.min(attempts, RETRY_DELAYS.length - 1)]) : null
                }
            });

            logger.warn({
                deliveryId: id,
                endpointUrl: endpoint.url,
                statusCode,
                attempts,
                retrying: shouldRetry,
                duration: Date.now() - startTime
            }, 'Webhook delivery failed');
        }
    }

    /**
     * Generate HMAC-SHA256 signature
     */
    private sign(payload: string, secret: string): string {
        const timestamp = Math.floor(Date.now() / 1000);
        const signaturePayload = `${timestamp}.${payload}`;
        const signature = crypto
            .createHmac('sha256', secret)
            .update(signaturePayload)
            .digest('hex');
        return `t=${timestamp},v1=${signature}`;
    }

    /**
     * Verify webhook signature (for documentation/SDK)
     */
    static verifySignature(payload: string, signature: string, secret: string, toleranceSeconds = 300): boolean {
        const parts = signature.split(',');
        const tPart = parts.find(p => p.startsWith('t='));
        const vPart = parts.find(p => p.startsWith('v1='));

        if (!tPart || !vPart) return false;

        const timestamp = parseInt(tPart.slice(2), 10);
        const expectedSignature = vPart.slice(3);

        // Check timestamp tolerance
        const now = Math.floor(Date.now() / 1000);
        if (Math.abs(now - timestamp) > toleranceSeconds) return false;

        // Verify signature
        const signaturePayload = `${timestamp}.${payload}`;
        const computed = crypto
            .createHmac('sha256', secret)
            .update(signaturePayload)
            .digest('hex');

        return crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(computed));
    }

    // === Endpoint Management ===

    /**
     * Create a webhook endpoint
     */
    async createEndpoint(tenantId: string, input: {
        url: string;
        events: WebhookEventType[];
        description?: string;
    }): Promise<any> {
        // Generate secret
        const secret = 'whsec_' + crypto.randomBytes(24).toString('base64url');

        const endpoint = await prisma.webhookEndpoint.create({
            data: {
                tenantId,
                url: input.url,
                events: input.events,
                secret,
                description: input.description
            }
        });

        logger.info({ tenantId, endpointId: endpoint.id, url: input.url }, 'Webhook endpoint created');

        // Return with secret (only shown once)
        return { ...endpoint, secret };
    }

    /**
     * List endpoints for tenant
     */
    async listEndpoints(tenantId: string): Promise<any[]> {
        return prisma.webhookEndpoint.findMany({
            where: { tenantId },
            select: {
                id: true,
                url: true,
                events: true,
                active: true,
                description: true,
                createdAt: true
                // Note: secret is NOT returned
            }
        });
    }

    /**
     * Delete an endpoint
     */
    async deleteEndpoint(tenantId: string, endpointId: string): Promise<void> {
        await prisma.webhookEndpoint.deleteMany({
            where: { id: endpointId, tenantId }
        });
        logger.info({ tenantId, endpointId }, 'Webhook endpoint deleted');
    }

    /**
     * Get delivery history for endpoint
     */
    async getDeliveries(endpointId: string, options: { limit?: number } = {}): Promise<any[]> {
        return prisma.webhookDelivery.findMany({
            where: { endpointId },
            take: options.limit || 50,
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                eventType: true,
                status: true,
                attempts: true,
                responseCode: true,
                error: true,
                createdAt: true,
                deliveredAt: true
            }
        });
    }
}

// Singleton
export const webhookService = new WebhookService();

export default webhookService;
