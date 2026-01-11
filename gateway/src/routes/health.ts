/**
 * Health Check Router
 * 
 * Provides health and readiness endpoints for orchestration.
 * Implements actual dependency checks per SECURITY_AUDIT_CHECKLIST.md
 */

import { Router } from 'express';
import axios from 'axios';
import { ethers } from 'ethers';
import { env } from '../config/env.js';
import { prisma } from '../db/client.js';
import { getRedis } from '../db/redis.js';
import { logger } from '../lib/logger.js';
import { zkProofService } from '../modules/security/zkProofService.js';
import os from 'os';

export const healthRouter: Router = Router();

interface HealthStatus {
    status: 'healthy' | 'degraded' | 'unhealthy';
    version: string;
    uptime: number;
    timestamp: string;
    environment: string;
    services: {
        fhir: ServiceStatus;
        blockchain: ServiceStatus;
        database: ServiceStatus;
        redis: ServiceStatus;
        zkProver: ServiceStatus;
        memory: ServiceStatus;
    };
}

interface ServiceStatus {
    status: 'connected' | 'disconnected' | 'degraded';
    latency?: number;
    details?: Record<string, any>;
    error?: string;
}

/**
 * GET /health
 * Basic health check - returns 200 if service is running
 */
healthRouter.get('/', async (_req, res) => {
    const health = await getHealthStatus();

    const statusCode = health.status === 'healthy' ? 200
        : health.status === 'degraded' ? 200
            : 503;

    res.status(statusCode).json(health);
});

/**
 * GET /ready
 * Readiness check - returns 200 only if all critical dependencies are available
 */
healthRouter.get('/ready', async (_req, res) => {
    const health = await getHealthStatus();

    // Critical dependencies for readiness
    const criticalServices = ['database', 'zkProver'] as const;
    const allCriticalReady = criticalServices.every(
        svc => health.services[svc].status === 'connected'
    );

    if (allCriticalReady) {
        res.json({
            ready: true,
            services: health.services
        });
    } else {
        res.status(503).json({
            ready: false,
            services: health.services,
            message: 'Critical dependencies not ready'
        });
    }
});

/**
 * GET /health/live
 * Liveness check - returns 200 if process is alive
 */
healthRouter.get('/live', (_req, res) => {
    res.json({ alive: true, timestamp: new Date().toISOString() });
});

/**
 * Gather health status from all dependencies
 */
async function getHealthStatus(): Promise<HealthStatus> {
    const startTime = Date.now();

    // Check all services in parallel
    const [fhir, blockchain, database, redis, zkProver, memory] = await Promise.all([
        checkFhirHealth(),
        checkBlockchainHealth(),
        checkDatabaseHealth(),
        checkRedisHealth(),
        checkZkProverHealth(),
        checkMemoryHealth()
    ]);

    // Determine overall status
    const services = { fhir, blockchain, database, redis, zkProver, memory };
    const statuses = Object.values(services).map(s => s.status);

    let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    if (statuses.includes('disconnected')) {
        overallStatus = statuses.every(s => s === 'disconnected') ? 'unhealthy' : 'degraded';
    }

    return {
        status: overallStatus,
        version: env.npm_package_version || '1.0.0',
        uptime: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
        environment: env.NODE_ENV,
        services
    };
}

/**
 * Check HAPI FHIR server health
 */
async function checkFhirHealth(): Promise<ServiceStatus> {
    const start = Date.now();
    try {
        const response = await axios.get(`${env.HAPI_FHIR_URL}/metadata`, {
            timeout: 5000,
            headers: { Accept: 'application/fhir+json' }
        });

        return {
            status: response.status === 200 ? 'connected' : 'degraded',
            latency: Date.now() - start,
            details: {
                fhirVersion: response.data?.fhirVersion,
                software: response.data?.software?.name
            }
        };
    } catch (error: any) {
        return {
            status: 'disconnected',
            latency: Date.now() - start,
            error: error.message
        };
    }
}

/**
 * Check Polygon blockchain connection
 */
async function checkBlockchainHealth(): Promise<ServiceStatus> {
    const start = Date.now();

    if (!env.POLYGON_AMOY_RPC) {
        return {
            status: 'disconnected',
            error: 'POLYGON_AMOY_RPC not configured'
        };
    }

    try {
        const provider = new ethers.JsonRpcProvider(env.POLYGON_AMOY_RPC);
        const [blockNumber, network] = await Promise.all([
            provider.getBlockNumber(),
            provider.getNetwork()
        ]);

        return {
            status: 'connected',
            latency: Date.now() - start,
            details: {
                blockNumber,
                chainId: network.chainId.toString(),
                name: network.name
            }
        };
    } catch (error: any) {
        return {
            status: 'disconnected',
            latency: Date.now() - start,
            error: error.message
        };
    }
}

/**
 * Check PostgreSQL database connection
 */
async function checkDatabaseHealth(): Promise<ServiceStatus> {
    const start = Date.now();
    try {
        await prisma.$queryRaw`SELECT 1`;

        return {
            status: 'connected',
            latency: Date.now() - start
        };
    } catch (error: any) {
        return {
            status: 'disconnected',
            latency: Date.now() - start,
            error: error.message
        };
    }
}

/**
 * Check Redis connection
 */
async function checkRedisHealth(): Promise<ServiceStatus> {
    const start = Date.now();
    try {
        const redis = getRedis();
        const pong = await redis.ping();

        return {
            status: pong === 'PONG' ? 'connected' : 'degraded',
            latency: Date.now() - start
        };
    } catch (error: any) {
        return {
            status: 'disconnected',
            latency: Date.now() - start,
            error: error.message
        };
    }
}

/**
 * Check ZK prover readiness
 */
/**
 * Check ZK prover readiness via centralized service
 */
async function checkZkProverHealth(): Promise<ServiceStatus> {
    const start = Date.now();
    try {
        const integrity = await zkProofService.verifyCircuitIntegrity();

        return {
            status: integrity.valid ? 'connected' : 'degraded',
            latency: Date.now() - start,
            details: {
                valid: integrity.valid,
                checksums: integrity.checksums,
                errors: integrity.errors
            },
            error: integrity.valid ? undefined : 'Circuit integrity check failed'
        };
    } catch (error: any) {
        return {
            status: 'disconnected',
            latency: Date.now() - start,
            error: error.message
        };
    }
}

/**
 * Check System Memory Health
 */
async function checkMemoryHealth(): Promise<ServiceStatus> {
    const start = Date.now();
    const freeMem = os.freemem();
    const totalMem = os.totalmem();
    const freeMemMB = Math.round(freeMem / 1024 / 1024);
    const usedMemPercentage = ((totalMem - freeMem) / totalMem) * 100;

    // Warn if free memory is less than 512MB (ZK requirement)
    const status = freeMemMB < 512 ? 'degraded' : 'connected';

    return {
        status,
        latency: Date.now() - start,
        details: {
            freeMemMB,
            totalMemMB: Math.round(totalMem / 1024 / 1024),
            usedMemPercentage: Math.round(usedMemPercentage)
        }
    };
}

