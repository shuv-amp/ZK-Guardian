import { Request, Response, Router } from 'express';
import { register, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

/**
 * Prometheus Metrics
 * 
 * Exposes metrics for monitoring per API_REFERENCE spec:
 * 
 * - zk_proof_generation_seconds: Time to generate ZK proof
 * - zk_access_requests_total: Total access requests by type/status
 * - zk_consent_denials_total: Consent denials by reason
 * - zk_break_glass_total: Emergency access count
 * - zk_batch_queue_size: Current batch queue size
 * - zk_gas_used: Gas used per verification
 */

// Collect default Node.js metrics
collectDefaultMetrics({ prefix: 'zk_guardian_' });

// === Custom Metrics ===

// ZK Proof generation time
export const proofGenerationHistogram = new Histogram({
    name: 'zk_proof_generation_seconds',
    help: 'Time to generate ZK proof',
    buckets: [0.5, 1, 2, 3, 5, 10, 30]
});

// Access requests counter
export const accessRequestsCounter = new Counter({
    name: 'zk_access_requests_total',
    help: 'Total access requests',
    labelNames: ['resource_type', 'status']
});

// Consent denials counter
export const consentDenialsCounter = new Counter({
    name: 'zk_consent_denials_total',
    help: 'Consent denials by reason',
    labelNames: ['reason']
});

// Break-glass counter
export const breakGlassCounter = new Counter({
    name: 'zk_break_glass_total',
    help: 'Emergency access count',
    labelNames: ['reason']
});

// Batch queue size gauge
export const batchQueueGauge = new Gauge({
    name: 'zk_batch_queue_size',
    help: 'Current batch queue size'
});

// Gas usage histogram
export const gasUsedHistogram = new Histogram({
    name: 'zk_gas_used',
    help: 'Gas used per verification',
    buckets: [50000, 100000, 150000, 200000, 250000, 300000]
});

// WebSocket connections gauge
export const wsConnectionsGauge = new Gauge({
    name: 'zk_websocket_connections',
    help: 'Active WebSocket connections'
});

// FHIR request latency
export const fhirLatencyHistogram = new Histogram({
    name: 'zk_fhir_request_seconds',
    help: 'FHIR request latency',
    labelNames: ['resource_type', 'operation'],
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5]
});

// Alert count gauge
export const alertsGauge = new Gauge({
    name: 'zk_alerts_unacknowledged',
    help: 'Unacknowledged alerts count'
});

// Blockchain transaction counter
export const blockchainTransactionsCounter = new Counter({
    name: 'zk_blockchain_transactions_total',
    help: 'Total blockchain transactions',
    labelNames: ['method', 'status']
});

// Blockchain latency histogram
export const blockchainLatencyHistogram = new Histogram({
    name: 'zk_blockchain_latency_seconds',
    help: 'Blockchain transaction latency',
    labelNames: ['method'],
    buckets: [1, 2, 5, 10, 20, 60]
});

// === NEW: SLO-Critical Metrics ===

// Consent handshake metrics
export const consentHandshakeCounter = new Counter({
    name: 'consent_handshake_total',
    help: 'Total consent handshakes',
    labelNames: ['status'] // success, denied, timeout
});

export const consentHandshakeDuration = new Histogram({
    name: 'consent_handshake_duration_seconds',
    help: 'Consent handshake duration',
    buckets: [1, 5, 10, 15, 20, 30]
});

// Nullifier replay detection
export const nullifierReplayCounter = new Counter({
    name: 'nullifier_replay_attempts_total',
    help: 'Nullifier replay attempts detected'
});

// Rate limit exceeded counter
export const rateLimitCounter = new Counter({
    name: 'rate_limit_exceeded_total',
    help: 'Rate limit exceeded events',
    labelNames: ['endpoint_type']
});

// Authentication failures
export const authFailureCounter = new Counter({
    name: 'auth_failure_total',
    help: 'Authentication failures',
    labelNames: ['reason']
});

// Circuit integrity gauge (1 = valid, 0 = invalid)
export const circuitIntegrityGauge = new Gauge({
    name: 'circuit_checksum_valid',
    help: 'Circuit file integrity (1=valid, 0=invalid)',
    labelNames: ['circuit']
});

// Proof verification results
export const proofVerificationCounter = new Counter({
    name: 'zk_proof_verification_total',
    help: 'Proof verification results',
    labelNames: ['result'] // success, failed
});

// Export grouped object for easier imports
export const prometheusMetrics = {
    proofGenerationHistogram,
    accessRequestsCounter,
    consentDenialsCounter,
    breakGlassCounter,
    batchQueueGauge,
    gasUsedHistogram,
    wsConnectionsGauge,
    fhirLatencyHistogram,
    alertsGauge,
    blockchainTransactions: blockchainTransactionsCounter,
    blockchainLatency: blockchainLatencyHistogram,
    // New metrics
    consentHandshake: consentHandshakeCounter,
    consentHandshakeDuration,
    nullifierReplay: nullifierReplayCounter,
    rateLimit: rateLimitCounter,
    authFailure: authFailureCounter,
    circuitIntegrity: circuitIntegrityGauge,
    proofVerification: proofVerificationCounter
};

// === Metrics Router ===

export const metricsRouter: Router = Router();

/**
 * GET /metrics
 * 
 * Returns Prometheus-format metrics
 */
metricsRouter.get('/', async (req: Request, res: Response) => {
    try {
        res.set('Content-Type', register.contentType);
        res.end(await register.metrics());
    } catch (error) {
        res.status(500).json({ error: 'METRICS_ERROR', message: 'Failed to collect metrics' });
    }
});

// === Helper Functions ===

/**
 * Record proof generation time
 */
export function recordProofGeneration(durationSeconds: number): void {
    proofGenerationHistogram.observe(durationSeconds);
}

/**
 * Record access request
 */
export function recordAccessRequest(resourceType: string, status: 'success' | 'denied' | 'error'): void {
    accessRequestsCounter.inc({ resource_type: resourceType, status });
}

/**
 * Record consent denial
 */
export function recordConsentDenial(reason: string): void {
    consentDenialsCounter.inc({ reason });
}

/**
 * Record break-glass access
 */
export function recordBreakGlass(reason: string): void {
    breakGlassCounter.inc({ reason });
}

/**
 * Update batch queue size
 */
export function updateBatchQueueSize(size: number): void {
    batchQueueGauge.set(size);
}

/**
 * Record gas usage
 */
export function recordGasUsed(gas: number): void {
    gasUsedHistogram.observe(gas);
}

/**
 * Update WebSocket connections
 */
export function updateWsConnections(delta: number): void {
    wsConnectionsGauge.inc(delta);
}

/**
 * Record FHIR request latency
 */
export function recordFhirLatency(resourceType: string, operation: string, durationSeconds: number): void {
    fhirLatencyHistogram.observe({ resource_type: resourceType, operation }, durationSeconds);
}

/**
 * Update alerts count
 */
export function updateAlertsCount(count: number): void {
    alertsGauge.set(count);
}
