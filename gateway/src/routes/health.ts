/**
 * Health Check Router
 */

import { Router } from 'express';
import { env } from '../config/env.js';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
    res.json({
        status: 'healthy',
        version: '0.0.1',
        uptime: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
        environment: env.NODE_ENV,
    });
});

healthRouter.get('/ready', async (_req, res) => {
    // TODO: Add dependency checks (FHIR, blockchain)
    const checks = {
        fhir: 'pending',
        blockchain: 'pending',
        zkProver: 'ready',
    };

    res.json({
        ready: true,
        checks,
    });
});
