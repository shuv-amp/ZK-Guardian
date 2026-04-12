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
import { getGatewayPrivateKey, getSecretsManagerStatus } from '../config/secrets.js';
import { prisma } from '../db/client.js';
import { getRedis } from '../db/redis.js';
import { zkProofService } from '../modules/security/zkProofService.js';
import os from 'os';

export const healthRouter: Router = Router();

let cachedZkStatus: ServiceStatus | null = null;
let cachedZkStatusAt = 0;

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
        auth: ServiceStatus;
        secrets: ServiceStatus;
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
    const criticalServices: Array<keyof HealthStatus['services']> = env.NODE_ENV === 'production'
        ? ['database', 'zkProver', 'fhir', 'blockchain', 'auth', 'secrets']
        : ['database', 'zkProver'];
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
    // Check all services in parallel
    const [fhir, blockchain, database, redis, zkProver, auth, secrets, memory] = await Promise.all([
        checkFhirHealth(),
        checkBlockchainHealth(),
        checkDatabaseHealth(),
        checkRedisHealth(),
        checkZkProverHealth(),
        checkAuthHealth(),
        checkSecretsHealth(),
        checkMemoryHealth()
    ]);

    // Determine overall status
    const services = { fhir, blockchain, database, redis, zkProver, auth, secrets, memory };
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
        const [blockNumber, network] = await withTimeout(Promise.all([
            provider.getBlockNumber(),
            provider.getNetwork()
        ]), 5000);

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

async function checkAuthHealth(): Promise<ServiceStatus> {
    const start = Date.now();

    if (env.SMART_AUTH_MODE === 'local') {
        return {
            status: 'connected',
            latency: Date.now() - start,
            details: {
                mode: 'local',
                issuer: env.SMART_ISSUER || 'gateway-local'
            }
        };
    }

    if (!env.SMART_ISSUER || !env.SMART_JWKS_URI || !env.SMART_AUTHORIZATION_ENDPOINT || !env.SMART_TOKEN_ENDPOINT || !env.SMART_INTROSPECTION_ENDPOINT) {
        return {
            status: 'disconnected',
            latency: Date.now() - start,
            error: 'External SMART/OIDC endpoints are not fully configured'
        };
    }

    try {
        const response = await axios.get(env.SMART_JWKS_URI, {
            timeout: 5000,
            headers: { Accept: 'application/json' }
        });

        const jwkCount = Array.isArray(response.data?.keys) ? response.data.keys.length : 0;
        const clientCredentialsConfigured = !!env.SMART_CLIENT_ID && !!env.SMART_CLIENT_SECRET;
        const connected = response.status === 200 && jwkCount > 0 && clientCredentialsConfigured;

        return {
            status: connected ? 'connected' : 'degraded',
            latency: Date.now() - start,
            details: {
                mode: 'external',
                issuer: env.SMART_ISSUER,
                jwksUri: env.SMART_JWKS_URI,
                jwkCount,
                introspectionConfigured: true,
                clientCredentialsConfigured
            },
            error: clientCredentialsConfigured ? undefined : 'SMART client credentials missing for introspection'
        };
    } catch (error: any) {
        return {
            status: 'disconnected',
            latency: Date.now() - start,
            error: error.message
        };
    }
}

async function checkSecretsHealth(): Promise<ServiceStatus> {
    const start = Date.now();
    const managerStatus = getSecretsManagerStatus();

    try {
        const privateKey = await getGatewayPrivateKey();

        return {
            status: privateKey ? 'connected' : 'degraded',
            latency: Date.now() - start,
            details: {
                backend: managerStatus.backend,
                initialized: managerStatus.initialized
            },
            error: privateKey ? undefined : 'Gateway signing key missing'
        };
    } catch (error: any) {
        return {
            status: env.NODE_ENV === 'production' ? 'disconnected' : 'degraded',
            latency: Date.now() - start,
            details: {
                backend: managerStatus.backend,
                initialized: managerStatus.initialized
            },
            error: error.message
        };
    }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error('Timeout')); 
        }, timeoutMs);

        promise
            .then((result) => {
                clearTimeout(timer);
                resolve(result);
            })
            .catch((error) => {
                clearTimeout(timer);
                reject(error);
            });
    });
}

/**
 * Check PostgreSQL database connection
 */
async function checkDatabaseHealth(): Promise<ServiceStatus> {
    const start = Date.now();
    try {
        await withTimeout(prisma.$queryRaw`SELECT 1`, 3000);

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
        const pong = await withTimeout(redis.ping(), 3000);

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

    if (cachedZkStatus && Date.now() - cachedZkStatusAt < 60000) {
        return cachedZkStatus;
    }

    const cachedIntegrity = zkProofService.getCachedIntegrity?.();
    if (cachedIntegrity) {
        const status: ServiceStatus = {
            status: cachedIntegrity.valid ? 'connected' : 'degraded',
            latency: Date.now() - start,
            details: {
                valid: cachedIntegrity.valid,
                checksums: cachedIntegrity.checksums,
                errors: cachedIntegrity.errors
            },
            error: cachedIntegrity.valid ? undefined : 'Circuit integrity check failed'
        };

        cachedZkStatus = status;
        cachedZkStatusAt = Date.now();

        return status;
    }

    try {
        const integrity = await zkProofService.verifyCircuitIntegrity();

        const status: ServiceStatus = {
            status: integrity.valid ? 'connected' : 'degraded',
            latency: Date.now() - start,
            details: {
                valid: integrity.valid,
                checksums: integrity.checksums,
                errors: integrity.errors
            },
            error: integrity.valid ? undefined : 'Circuit integrity check failed'
        };

        cachedZkStatus = status;
        cachedZkStatusAt = Date.now();

        return status;
    } catch (error: any) {
        const status: ServiceStatus = {
            status: 'disconnected',
            latency: Date.now() - start,
            error: error.message
        };

        cachedZkStatus = status;
        cachedZkStatusAt = Date.now();

        return status;
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
