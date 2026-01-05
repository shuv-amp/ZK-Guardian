
import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { v4 as uuidv4 } from 'uuid';
import { getRedis } from '../db/redis.js';
import { logger } from '../lib/logger.js';
import Redis from 'ioredis';

interface PendingRequest {
    resolve: (granted: boolean) => void;
    reject: (reason: any) => void;
    timer: NodeJS.Timeout;
}

interface SessionInfo {
    patientId: string;
    instanceId: string;
    connectedAt: number;
    deviceInfo?: string;
}

// Unique identifier for this gateway instance (for distributed coordination)
const INSTANCE_ID = process.env.DYNO || process.env.HOSTNAME || uuidv4();

// Redis keys
const REDIS_SESSION_PREFIX = 'ws:session:';
const REDIS_PATIENT_SESSIONS = 'ws:patient:sessions:';
const REDIS_PUBSUB_CHANNEL = 'ws:consent:pubsub';
const SESSION_TTL_SECONDS = 3600; // 1 hour

// ioredis type
const RedisClient = (Redis as any).default || Redis;

export class ConsentHandshakeService {
    // Local map: sessionId -> WebSocket (only for connections on THIS instance)
    private localSockets: Map<string, WebSocket> = new Map();
    // Map requestId -> Pending Promise handlers
    private pendingRequests: Map<string, PendingRequest> = new Map();
    // Redis pub/sub subscriber client (separate from main client for ioredis)
    private subscriber: InstanceType<typeof RedisClient> | null = null;
    private initialized = false;

    constructor() {
        // Singleton pattern usually managed by module exports
    }

    /**
     * Initialize Redis pub/sub for cross-instance messaging
     */
    async initialize(): Promise<void> {
        if (this.initialized) return;

        try {
            // Create dedicated subscriber connection (Redis requirement for pub/sub)
            const url = process.env.REDIS_URL || 'redis://localhost:6379';
            this.subscriber = new RedisClient(url, {
                maxRetriesPerRequest: 3,
                enableReadyCheck: true,
                lazyConnect: true
            });

            await this.subscriber.connect();

            // Subscribe to consent channel for cross-instance coordination
            await this.subscriber.subscribe(REDIS_PUBSUB_CHANNEL, (err: Error | null) => {
                if (err) {
                    logger.error({ error: err.message }, 'Failed to subscribe to consent channel');
                }
            });

            this.subscriber.on('message', (channel: string, message: string) => {
                if (channel === REDIS_PUBSUB_CHANNEL) {
                    this.handlePubSubMessage(message);
                }
            });

            logger.info({
                instanceId: INSTANCE_ID
            }, 'ConsentHandshake service initialized with Redis pub/sub');
            this.initialized = true;
        } catch (error: any) {
            logger.error({ error: error.message }, 'Failed to initialize ConsentHandshake pub/sub');
            // Continue without pub/sub - single instance mode
            this.initialized = true;
        }
    }

    /**
     * Handle messages from Redis pub/sub (from other instances)
     */
    private async handlePubSubMessage(message: string): Promise<void> {
        try {
            const data = JSON.parse(message);

            // Ignore messages from this instance
            if (data.sourceInstance === INSTANCE_ID) return;

            if (data.type === 'CONSENT_REQUEST_FORWARD') {
                // Another instance needs us to forward a consent request to local sockets
                await this.forwardToLocalSockets(data.patientId, data.payload);
            } else if (data.type === 'CONSENT_RESPONSE_FORWARD') {
                // Response received on another instance, resolve our pending request
                const pending = this.pendingRequests.get(data.requestId);
                if (pending) {
                    clearTimeout(pending.timer);
                    pending.resolve(!!data.approved);
                    this.pendingRequests.delete(data.requestId);
                }
            }
        } catch (e) {
            logger.error({ error: (e as Error).message }, 'Failed to handle pub/sub message');
        }
    }

    /**
     * Forward consent request to local sockets for a patient
     */
    private async forwardToLocalSockets(patientId: string, payload: string): Promise<void> {
        const sessionIds = await this.getLocalSessionsForPatient(patientId);

        for (const sessionId of sessionIds) {
            const ws = this.localSockets.get(sessionId);
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(payload);
            }
        }
    }

    /**
     * Get session IDs for a patient that are connected to THIS instance
     */
    private async getLocalSessionsForPatient(patientId: string): Promise<string[]> {
        const result: string[] = [];
        const redis = getRedis();

        for (const [sessionId, ws] of this.localSockets.entries()) {
            try {
                const sessionData = await redis.get(`${REDIS_SESSION_PREFIX}${sessionId}`);
                if (sessionData) {
                    const session: SessionInfo = JSON.parse(sessionData);
                    if (session.patientId === patientId && session.instanceId === INSTANCE_ID) {
                        result.push(sessionId);
                    }
                }
            } catch (e) {
                // Session expired or invalid, clean up
                this.localSockets.delete(sessionId);
            }
        }

        return result;
    }

    /**
     * Handles new WebSocket connections.
     * Expects patientId in query params (e.g., ?patientId=123) to bind the socket.
     */
    public async handleConnection(ws: WebSocket, req: IncomingMessage): Promise<void> {
        if (!this.initialized) {
            await this.initialize();
        }

        // Parse patientId from URL parameters: /ws/consent?patientId=123
        const url = new URL(req.url || "", `http://${req.headers.host}`);
        const patientId = url.searchParams.get("patientId");

        if (!patientId) {
            logger.warn('WebSocket connection rejected: Missing patientId');
            ws.close(1008, "Missing patientId");
            return;
        }

        // Generate unique session ID
        const sessionId = uuidv4();
        const sessionInfo: SessionInfo = {
            patientId,
            instanceId: INSTANCE_ID,
            connectedAt: Date.now(),
            deviceInfo: req.headers['user-agent']
        };

        // Store session in Redis
        const redis = getRedis();
        try {
            await redis.setex(
                `${REDIS_SESSION_PREFIX}${sessionId}`,
                SESSION_TTL_SECONDS,
                JSON.stringify(sessionInfo)
            );

            // Add session to patient's session set
            await redis.sadd(`${REDIS_PATIENT_SESSIONS}${patientId}`, sessionId);
            await redis.expire(`${REDIS_PATIENT_SESSIONS}${patientId}`, SESSION_TTL_SECONDS);
        } catch (error: any) {
            logger.error({
                error: error.message,
                patientId,
                sessionId
            }, 'Failed to store WebSocket session in Redis');
            // Continue anyway - worst case is reduced multi-instance support
        }

        // Store local reference
        this.localSockets.set(sessionId, ws);

        logger.info({
            patientId,
            sessionId,
            instanceId: INSTANCE_ID
        }, 'Patient WebSocket connected');

        ws.on('message', (message) => this.handleMessage(patientId, sessionId, message));

        ws.on('close', async () => {
            logger.info({ patientId, sessionId }, 'Patient WebSocket disconnected');
            await this.cleanupSession(sessionId, patientId);
        });

        ws.on('error', async (err) => {
            logger.error({ patientId, sessionId, error: err.message }, 'WebSocket error');
            await this.cleanupSession(sessionId, patientId);
        });

        // Send acknowledgment
        ws.send(JSON.stringify({
            type: 'CONNECTED',
            sessionId,
            timestamp: Date.now()
        }));
    }

    /**
     * Clean up session data on disconnect
     */
    private async cleanupSession(sessionId: string, patientId: string): Promise<void> {
        this.localSockets.delete(sessionId);

        const redis = getRedis();
        try {
            await redis.del(`${REDIS_SESSION_PREFIX}${sessionId}`);
            await redis.srem(`${REDIS_PATIENT_SESSIONS}${patientId}`, sessionId);
        } catch (error: any) {
            logger.warn({
                error: error.message,
                sessionId
            }, 'Failed to cleanup session from Redis');
        }
    }

    /**
     * Router for incoming messages.
     * Currently only listens for CONSENT_RESPONSE to resolve pending promises.
     */
    private async handleMessage(patientId: string, sessionId: string, message: any): Promise<void> {
        const redis = getRedis();
        try {
            const data = JSON.parse(message.toString());
            // Expected format: { type: "CONSENT_RESPONSE", requestId: "...", approved: true }

            if (data.type === "CONSENT_RESPONSE" && data.requestId) {
                const request = this.pendingRequests.get(data.requestId);

                logger.info({
                    requestId: data.requestId,
                    approved: data.approved,
                    patientId,
                    sessionId
                }, 'Received consent response');

                if (request) {
                    // Local request - resolve directly
                    clearTimeout(request.timer);
                    request.resolve(!!data.approved);
                    this.pendingRequests.delete(data.requestId);
                } else {
                    // Request might be on another instance - publish response
                    try {
                        await redis.publish(REDIS_PUBSUB_CHANNEL, JSON.stringify({
                            type: 'CONSENT_RESPONSE_FORWARD',
                            requestId: data.requestId,
                            approved: data.approved,
                            sourceInstance: INSTANCE_ID,
                            patientId
                        }));
                    } catch (e) {
                        logger.warn({
                            requestId: data.requestId
                        }, 'Failed to publish consent response to pub/sub');
                    }
                }
            } else if (data.type === "HEARTBEAT") {
                // Refresh session TTL on heartbeat
                try {
                    await redis.expire(`${REDIS_SESSION_PREFIX}${sessionId}`, SESSION_TTL_SECONDS);
                    await redis.expire(`${REDIS_PATIENT_SESSIONS}${patientId}`, SESSION_TTL_SECONDS);
                } catch (e) {
                    // Non-critical
                }
            }
        } catch (e) {
            logger.error({
                error: (e as Error).message,
                patientId
            }, 'Failed to parse WebSocket message');
        }
    }

    /**
     * Check if a patient has any active WebSocket connections across all instances
     */
    public async isPatientOnline(patientId: string): Promise<boolean> {
        const redis = getRedis();
        try {
            const sessions = await redis.smembers(`${REDIS_PATIENT_SESSIONS}${patientId}`);

            // Verify at least one session is still valid
            for (const sessionId of sessions) {
                const sessionData = await redis.get(`${REDIS_SESSION_PREFIX}${sessionId}`);
                if (sessionData) {
                    return true;
                }
                // Clean up stale session reference
                await redis.srem(`${REDIS_PATIENT_SESSIONS}${patientId}`, sessionId);
            }

            return false;
        } catch (error) {
            logger.warn({ patientId }, 'Failed to check patient online status');
            // Fall back to local check
            for (const [, ws] of this.localSockets.entries()) {
                if (ws.readyState === WebSocket.OPEN) {
                    return true;
                }
            }
            return false;
        }
    }

    /**
     * Get count of active connections for a patient
     */
    public async getPatientConnectionCount(patientId: string): Promise<number> {
        const redis = getRedis();
        try {
            const sessions = await redis.smembers(`${REDIS_PATIENT_SESSIONS}${patientId}`);
            let count = 0;

            for (const sessionId of sessions) {
                const sessionData = await redis.get(`${REDIS_SESSION_PREFIX}${sessionId}`);
                if (sessionData) {
                    count++;
                }
            }

            return count;
        } catch (error) {
            return 0;
        }
    }

    /**
     * Initiates a real-time consent request to the patient.
     * Returns a Promise that resolves true (approved) or false (denied/timeout).
     * Works across multiple gateway instances via Redis pub/sub.
     */
    public async requestConsent(
        patientId: string,
        requestDetails: {
            practitioner: string,
            resourceType: string,
            resourceId: string
        },
        timeoutMs = 30000 // 30 second default timeout
    ): Promise<boolean> {
        if (!this.initialized) {
            await this.initialize();
        }

        // Check if patient has any active sessions
        const isOnline = await this.isPatientOnline(patientId);
        if (!isOnline) {
            logger.info({ patientId }, 'No active device found for patient');
            return false; // Patient offline
        }

        const requestId = uuidv4();
        logger.info({
            requestId,
            patientId,
            practitioner: requestDetails.practitioner,
            resourceType: requestDetails.resourceType
        }, 'Requesting real-time consent');

        // Prepare payload
        const payload = JSON.stringify({
            type: "CONSENT_REQUEST",
            requestId,
            details: requestDetails,
            timestamp: Date.now()
        });

        // Send to local sockets first
        const localSessions = await this.getLocalSessionsForPatient(patientId);
        for (const sessionId of localSessions) {
            const ws = this.localSockets.get(sessionId);
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(payload);
            }
        }

        // Publish to other instances via Redis pub/sub
        const redis = getRedis();
        try {
            await redis.publish(REDIS_PUBSUB_CHANNEL, JSON.stringify({
                type: 'CONSENT_REQUEST_FORWARD',
                patientId,
                payload,
                sourceInstance: INSTANCE_ID
            }));
        } catch (e) {
            logger.warn({ requestId }, 'Failed to publish consent request to pub/sub');
        }

        // Return a promise that waits for response
        return new Promise<boolean>((resolve, reject) => {
            const timer = setTimeout(() => {
                if (this.pendingRequests.has(requestId)) {
                    logger.info({ requestId, patientId }, 'Consent request timed out');
                    this.pendingRequests.delete(requestId);
                    resolve(false); // Default to deny on timeout
                }
            }, timeoutMs);

            this.pendingRequests.set(requestId, { resolve, reject, timer });
        });
    }

    /**
     * Graceful shutdown - clean up all sessions for this instance
     */
    async shutdown(): Promise<void> {
        logger.info({ instanceId: INSTANCE_ID }, 'Shutting down ConsentHandshake service');

        const redis = getRedis();
        // Close all local sockets
        for (const [sessionId, ws] of this.localSockets.entries()) {
            try {
                const sessionData = await redis.get(`${REDIS_SESSION_PREFIX}${sessionId}`);
                if (sessionData) {
                    const session: SessionInfo = JSON.parse(sessionData);
                    await this.cleanupSession(sessionId, session.patientId);
                }
                ws.close(1001, 'Server shutting down');
            } catch (e) {
                // Ignore cleanup errors during shutdown
            }
        }

        // Close subscriber connection
        if (this.subscriber) {
            await this.subscriber.unsubscribe(REDIS_PUBSUB_CHANNEL);
            await this.subscriber.quit();
        }
    }
}

// Singleton Instance
export const consentHandshakeService = new ConsentHandshakeService();

// Helper for index.ts to wire it up
export const setupConsentWebSocket = async (wss: WebSocketServer): Promise<void> => {
    await consentHandshakeService.initialize();

    wss.on('connection', (ws, req) => {
        consentHandshakeService.handleConnection(ws, req);
    });
};
