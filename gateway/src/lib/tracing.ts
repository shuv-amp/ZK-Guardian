/**
 * OpenTelemetry Distributed Tracing
 * 
 * Self-hosted tracing with Jaeger (Docker).
 * No cloud dependencies - runs entirely local.
 * 
 * Features:
 * - Automatic HTTP/Express instrumentation
 * - Custom spans for ZK proof generation
 * - Database query tracing
 * - Correlation ID propagation
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { SpanStatusCode, trace, Span, SpanKind, context as otelContext } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { env } from '../config/env.js';

// Configuration
const SERVICE_NAME = 'zk-guardian-gateway';
const JAEGER_ENDPOINT = process.env.JAEGER_ENDPOINT || 'http://localhost:4318/v1/traces';

let sdk: NodeSDK | null = null;

/**
 * Initialize OpenTelemetry tracing
 * 
 * Call this at the very start of the application, before any imports.
 */
export function initTracing(): void {
    if (sdk) {
        console.log('[Tracing] Already initialized');
        return;
    }

    // Skip in test environment
    if (env.NODE_ENV === 'test') {
        console.log('[Tracing] Skipped in test environment');
        return;
    }

    const exporter = new OTLPTraceExporter({
        url: JAEGER_ENDPOINT,
        headers: {},
    });

    sdk = new NodeSDK({
        resource: resourceFromAttributes({
            [SemanticResourceAttributes.SERVICE_NAME]: SERVICE_NAME,
            [SemanticResourceAttributes.SERVICE_VERSION]: env.npm_package_version || '1.0.0',
            [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: env.NODE_ENV,
        }),
        spanProcessor: new BatchSpanProcessor(exporter, {
            maxQueueSize: 1000,
            maxExportBatchSize: 100,
            scheduledDelayMillis: 5000,
        }),
        textMapPropagator: new W3CTraceContextPropagator(),
        instrumentations: [
            getNodeAutoInstrumentations({
                '@opentelemetry/instrumentation-http': {
                    ignoreIncomingRequestHook: (req) => {
                        const url = req.url || '';
                        return ['/health', '/ready', '/metrics'].some(path => url.includes(path));
                    },
                },
                '@opentelemetry/instrumentation-express': {
                    enabled: true,
                },
                '@opentelemetry/instrumentation-pg': {
                    enabled: true,
                },
                '@opentelemetry/instrumentation-redis': {
                    enabled: true,
                },
            }),
        ],
    });

    sdk.start();

    console.log(`[Tracing] Initialized - exporting to ${JAEGER_ENDPOINT}`);

    // Graceful shutdown
    process.on('SIGTERM', () => {
        sdk?.shutdown()
            .then(() => console.log('[Tracing] Shutdown complete'))
            .catch((err: Error) => console.error('[Tracing] Shutdown error', err));
    });
}

/**
 * Get the current tracer
 */
export function getTracer() {
    return trace.getTracer(SERVICE_NAME);
}

/**
 * Create a custom span for ZK proof operations
 */
export async function traceZKProof<T>(
    operationName: string,
    attributes: Record<string, string | number>,
    operation: () => Promise<T>
): Promise<T> {
    const tracer = getTracer();

    return tracer.startActiveSpan(`zk.${operationName}`, {
        kind: SpanKind.INTERNAL,
        attributes: {
            'zk.operation': operationName,
            ...attributes,
        },
    }, async (span: Span) => {
        try {
            const result = await operation();
            span.setStatus({ code: SpanStatusCode.OK });
            return result;
        } catch (error: any) {
            span.setStatus({
                code: SpanStatusCode.ERROR,
                message: error.message,
            });
            span.recordException(error);
            throw error;
        } finally {
            span.end();
        }
    });
}

/**
 * Create a custom span for consent handshake
 */
export async function traceConsent<T>(
    phase: 'request' | 'approve' | 'deny' | 'timeout',
    patientId: string,
    operation: () => Promise<T>
): Promise<T> {
    return traceZKProof(
        `consent.${phase}`,
        {
            'consent.phase': phase,
            'consent.patient_id_hash': hashForTracing(patientId),
        },
        operation
    );
}

/**
 * Create a custom span for blockchain operations
 */
export async function traceBlockchain<T>(
    operationName: string,
    attributes: {
        method?: string;
        contractAddress?: string;
        gasLimit?: number;
    },
    operation: () => Promise<T>
): Promise<T> {
    const tracer = getTracer();

    return tracer.startActiveSpan(`blockchain.${operationName}`, {
        kind: SpanKind.CLIENT,
        attributes: {
            'blockchain.method': attributes.method || operationName,
            'blockchain.contract': attributes.contractAddress || 'unknown',
            'blockchain.gas_limit': attributes.gasLimit || 0,
            'blockchain.network': 'polygon-amoy',
        },
    }, async (span: Span) => {
        try {
            const result = await operation();
            span.setStatus({ code: SpanStatusCode.OK });
            return result;
        } catch (error: any) {
            span.setStatus({
                code: SpanStatusCode.ERROR,
                message: error.message,
            });
            span.recordException(error);
            throw error;
        } finally {
            span.end();
        }
    });
}

/**
 * Add custom attributes to current span
 */
export function addSpanAttributes(attributes: Record<string, string | number | boolean>): void {
    const span = trace.getActiveSpan();
    if (span) {
        span.setAttributes(attributes);
    }
}

/**
 * Record an event in the current span
 */
export function recordSpanEvent(name: string, attributes?: Record<string, string | number>): void {
    const span = trace.getActiveSpan();
    if (span) {
        span.addEvent(name, attributes);
    }
}

/**
 * Get current trace ID for correlation
 */
export function getTraceId(): string | null {
    const span = trace.getActiveSpan();
    if (span) {
        return span.spanContext().traceId;
    }
    return null;
}

/**
 * Hash sensitive data for tracing (privacy-preserving)
 */
function hashForTracing(value: string): string {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(value).digest('hex').slice(0, 8);
}

/**
 * Express middleware to add trace context to request
 */
export function tracingMiddleware() {
    return (req: any, res: any, next: any) => {
        const traceId = getTraceId();
        if (traceId) {
            req.traceId = traceId;
            res.setHeader('X-Trace-Id', traceId);
        }
        next();
    };
}

export default {
    initTracing,
    getTracer,
    traceZKProof,
    traceConsent,
    traceBlockchain,
    addSpanAttributes,
    recordSpanEvent,
    getTraceId,
    tracingMiddleware,
};
