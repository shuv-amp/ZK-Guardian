import pino from 'pino';

/**
 * Structured Logger for ZK Guardian
 * 
 * Production-ready logging with:
 * - JSON format for log aggregation
 * - Request ID tracking
 * - Audit-specific logs
 */

const isDevelopment = process.env.NODE_ENV === 'development';

// Configure transport (Console or Rotating File)
const transport = process.env.LOG_FILE
    ? {
        target: 'pino-roll',
        options: {
            file: process.env.LOG_FILE,
            frequency: 'daily',
            retention: process.env.LOG_RETENTION_DAYS || 14,
            mkdir: true
        }
    }
    : isDevelopment
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined;

export const logger = pino({
    level: process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info'),
    transport,
    base: {
        service: 'zk-guardian-gateway',
        version: process.env.npm_package_version || '1.0.0'
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
        paths: [
            'req.headers.authorization',
            'req.headers["x-break-glass"]',
            'nullifier',
            'privateKey'
        ],
        censor: '[REDACTED]'
    }
});

// Specialized Loggers

/**
 * Audit logger for HIPAA compliance
 * These logs are critical and should be persisted
 */
export const auditLogger = logger.child({ stream: 'audit' });

/**
 * Log an access event (for compliance)
 */
export function logAccessEvent(data: {
    patientId: string;
    clinicianId: string;
    resourceType: string;
    action: 'ACCESS_REQUESTED' | 'ACCESS_GRANTED' | 'ACCESS_DENIED' | 'BREAK_GLASS';
    proofHash?: string;
    txHash?: string;
}) {
    auditLogger.info(data, `[AUDIT] ${data.action}`);
}

/**
 * Log a security event
 */
export function logSecurityEvent(data: {
    event: 'RATE_LIMIT' | 'AUTH_FAILURE' | 'INVALID_INPUT' | 'BREAK_GLASS_ATTEMPT';
    ip?: string;
    userId?: string;
    details?: string;
}) {
    logger.warn(data, `[SECURITY] ${data.event}`);
}

/**
 * Log a system event
 */
export function logSystemEvent(data: {
    event: 'STARTUP' | 'SHUTDOWN' | 'DB_CONNECTED' | 'REDIS_CONNECTED' | 'BATCH_FLUSH' |
    'CIRCUIT_VERIFIED' | 'TRACING_ENABLED' | 'KEY_MANAGER_READY' | 'COMPLIANCE_SERVICE_READY' |
    'WORKER_POOL_READY' | 'CONFIG_LOADED' | 'HEALTH_CHECK';
    details?: string;
}) {
    logger.info(data, `[SYSTEM] ${data.event}`);
}

/**
 * Create child logger with request context
 */
export function createRequestLogger(requestId: string) {
    return logger.child({ requestId });
}

export { pino };
