/**
 * ZK Guardian Gateway - Entry Point
 * Privacy-preserving FHIR proxy with ZK proof generation
 */

import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { randomUUID } from 'crypto';

import { env } from './config/env.js';
import { prisma, testDatabaseConnection, disconnectDatabase } from './db/client.js';
import { testRedisConnection, disconnectRedis } from './db/redis.js';
import { healthRouter } from './routes/health.js';
import { fhirRouter } from './routes/fhir.js';
import { patientAuditRouter } from './routes/patientAudit.js';
import { consentsRouter } from './routes/consents.js';
import { breakGlassRouter } from './routes/breakGlass.js';
import { clinicianRouter } from './routes/clinician.js';
import { smartConfigRouter } from './routes/smartConfig.js';
import { oauthRouter } from './routes/oauth.js';
import { smartAuthMiddleware } from './middleware/smartAuth.js';
import { breakGlassMiddleware } from './middleware/breakGlass.js';
import { rateLimitMiddleware } from './middleware/rateLimit.js';
import { setupConsentWebSocket } from './services/consentHandshake.js';
import { batchAuditService } from './services/batchAuditService.js';
import { metricsRouter } from './metrics/prometheus.js';
import { logger, logSystemEvent, createRequestLogger } from './lib/logger.js';
import { isAppError, toErrorResponse } from './lib/errors.js';

const app: Express = express();
const server = createServer(app);

// Security & Parsing Middleware

app.use(helmet({
    contentSecurityPolicy: env.NODE_ENV === 'production',
    crossOriginEmbedderPolicy: false
}));

app.use(cors({
    origin: env.CORS_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Break-Glass', 'X-Request-ID']
}));

app.use(express.json({ limit: '10mb' }));

// Request ID Middleware

app.use((req: Request, res: Response, next: NextFunction) => {
    const requestId = req.headers['x-request-id'] as string || randomUUID();
    (req as any).requestId = requestId;
    (req as any).logger = createRequestLogger(requestId);
    res.setHeader('X-Request-ID', requestId);
    next();
});

// Rate Limiting (all routes)

app.use(rateLimitMiddleware);

// Health & Metrics (no auth)

app.use('/health', healthRouter);
app.use('/ready', healthRouter);
app.use('/metrics', metricsRouter);
app.use('/.well-known', smartConfigRouter);
console.log('[DEBUG] Mounting OAuth Routes at /oauth');
app.use('/oauth', oauthRouter);

// Authenticated Routes

// FHIR proxy with SMART auth + break-glass
app.use('/fhir', smartAuthMiddleware, breakGlassMiddleware, fhirRouter);

// Patient audit dashboard
app.use('/api/patient', smartAuthMiddleware, patientAuditRouter);

// Consent management API (mounted under patient routes with mergeParams)
app.use('/api/patient/:patientId/consents', smartAuthMiddleware, consentsRouter);

// Clinician dashboard
app.use('/api/clinician', smartAuthMiddleware, clinicianRouter);

// Break-glass emergency access
app.use('/api/break-glass', smartAuthMiddleware, breakGlassRouter);

// WebSocket for Consent Handshake

const wss = new WebSocketServer({ server, path: '/ws/consent' });
setupConsentWebSocket(wss);

// 404 Handler

app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Route not found' });
});

// Error Handler

app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    const requestId = (req as any).requestId || 'unknown';

    if (isAppError(err)) {
        logger.warn({ requestId, error: err.toJSON() }, 'Application error');
        return res.status(err.statusCode).json(err.toJSON());
    }

    // Unexpected error
    logger.error({ requestId, error: err.message, stack: err.stack }, 'Unhandled error');

    const response = toErrorResponse(err);
    res.status(response.statusCode).json(response);
});

// Startup

async function startup(): Promise<void> {
    try {
        logSystemEvent({ event: 'STARTUP', details: `Starting ZK Guardian Gateway v${env.npm_package_version || '1.0.0'}` });

        // Test database connection
        const dbConnected = await testDatabaseConnection();
        if (dbConnected) {
            logSystemEvent({ event: 'DB_CONNECTED' });
        } else {
            logger.warn('Database not connected - some features will be limited');
        }

        // Test Redis connection
        const redisConnected = await testRedisConnection();
        if (redisConnected) {
            logSystemEvent({ event: 'REDIS_CONNECTED' });
        } else {
            logger.warn('Redis not connected - using in-memory fallback for rate limiting');
        }

        // Initialize ZK proof service
        const { zkProofService } = await import('./services/zkProofService.js');
        await zkProofService.initialize();

        // Verify circuit integrity (ZK1)
        const integrity = await zkProofService.verifyCircuitIntegrity();
        if (!integrity.valid) {
            logger.error({ errors: integrity.errors }, 'Circuit integrity check failed');
            if (env.NODE_ENV === 'production') {
                throw new Error('Circuit integrity check failed: ' + integrity.errors.join(', '));
            }
        } else {
            logSystemEvent({ event: 'CIRCUIT_VERIFIED', details: 'ZK circuits integrity check passed' });
        }

        // Start batch audit processor
        await batchAuditService.initialize();
        batchAuditService.start();

        // Start HTTP server
        server.listen(env.PORT, '0.0.0.0', () => {
            logger.info({
                port: env.PORT,
                environment: env.NODE_ENV,
                database: dbConnected,
                redis: redisConnected
            }, '🚀 ZK Guardian Gateway running');

            console.log(`
╔══════════════════════════════════════════════════════════╗
║           ZK Guardian Gateway - Ready                    ║
╠══════════════════════════════════════════════════════════╣
║  HTTP:      http://localhost:${env.PORT}                       ║
║  WebSocket: ws://localhost:${env.PORT}/ws/consent              ║
║  Metrics:   http://localhost:${env.PORT}/metrics               ║
║  Env:       ${env.NODE_ENV.padEnd(46)}║
║  Database:  ${(dbConnected ? 'Connected' : 'Not connected').padEnd(46)}║
║  Redis:     ${(redisConnected ? 'Connected' : 'Not connected').padEnd(46)}║
╚══════════════════════════════════════════════════════════╝
            `);
        });

    } catch (error) {
        logger.fatal({ error }, 'Failed to start gateway');
        process.exit(1);
    }
}

// Graceful Shutdown

async function shutdown(signal: string): Promise<void> {
    logger.info({ signal }, 'Shutdown signal received');
    logSystemEvent({ event: 'SHUTDOWN', details: signal });

    // Stop accepting new connections
    server.close();

    // Flush batch queue
    await batchAuditService.forceFlush();
    batchAuditService.stop();

    // Disconnect databases
    await disconnectDatabase();
    await disconnectRedis();

    logger.info('Shutdown complete');
    process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Start the server
startup();

export { app, server };
