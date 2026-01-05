/**
 * ZK Guardian Gateway - Entry Point
 * Privacy-preserving FHIR proxy with ZK proof generation
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';

import { env } from './config/env.js';
import { healthRouter } from './routes/health.js';
import { fhirRouter } from './routes/fhir.js';
import { patientAuditRouter } from './routes/patientAudit.js';
import { smartAuthMiddleware } from './middleware/smartAuth.js';
import { setupConsentWebSocket } from './services/consentHandshake.js';
import { setupMetrics } from './metrics/prometheus.js';

const app = express();
const server = createServer(app);

// Security middleware
app.use(helmet());
app.use(cors({
    origin: env.CORS_ORIGINS,
    credentials: true,
}));
app.use(express.json());

// Health check (no auth)
app.use('/health', healthRouter);
app.use('/ready', healthRouter);

// Metrics endpoint (restricted in production)
if (env.PROMETHEUS_ENABLED) {
    setupMetrics(app);
}

// SMART on FHIR authentication for all /fhir and /api routes
app.use('/fhir', smartAuthMiddleware, fhirRouter);
app.use('/api/patient', smartAuthMiddleware, patientAuditRouter);

// WebSocket for consent handshake
const wss = new WebSocketServer({ server, path: '/ws/consent' });
setupConsentWebSocket(wss);

// 404 handler
app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
        error: 'Internal server error',
        ...(env.NODE_ENV === 'development' && { message: err.message })
    });
});

// Start server
server.listen(env.PORT, () => {
    console.log(`🚀 ZK Guardian Gateway running on port ${env.PORT}`);
    console.log(`📡 WebSocket: ws://localhost:${env.PORT}/ws/consent`);
    console.log(`🔬 Environment: ${env.NODE_ENV}`);
});

export { app, server };
