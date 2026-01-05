
import { Router, Request, Response } from 'express';
import { createProxyMiddleware, responseInterceptor } from 'http-proxy-middleware';
import { zkAuthMiddleware } from '../middleware/zkAuthMiddleware.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

export const fhirRouter: Router = Router();

const HAPI_FHIR_URL = env.HAPI_FHIR_URL || "http://localhost:8080/fhir";

// 1. ZK Audit Layer: Enforce privacy policy before touching the upstream server
fhirRouter.use(zkAuthMiddleware);

// 2. Proxy Layer: Forward to HAPI FHIR with proper ZK headers
const proxy = createProxyMiddleware({
    target: HAPI_FHIR_URL,
    changeOrigin: true,
    selfHandleResponse: false,
    on: {
        proxyReq: (proxyReq, req: any) => {
            // Forward request ID for correlation
            const requestId = req.requestId;
            if (requestId) {
                proxyReq.setHeader('X-Request-ID', requestId);
            }
            
            // Log the proxy request
            logger.debug({
                target: HAPI_FHIR_URL,
                path: req.path,
                method: req.method
            }, 'Proxying FHIR request');
        },
        proxyRes: (proxyRes, req: any, res: any) => {
            // Attach ZK audit headers to the response
            if (req.zkAudit) {
                res.setHeader('X-ZK-Audit-Hash', req.zkAudit.proofHash);
                res.setHeader('X-ZK-Tx-Hash', req.zkAudit.txHash);
                res.setHeader('X-ZK-Access-Event', req.zkAudit.accessEventHash);
                
                // Calculate proof generation time if available
                const startTime = req._zkStartTime;
                if (startTime) {
                    const proofTimeMs = Date.now() - startTime;
                    res.setHeader('X-ZK-Proof-Time-Ms', proofTimeMs.toString());
                }
            }
            
            // Always add security headers
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.setHeader('X-Frame-Options', 'DENY');
        },
        error: (err, req, res: any) => {
            logger.error({ error: err.message, path: req.url }, 'FHIR proxy error');
            
            if (!res.headersSent) {
                res.status(502).json({
                    error: 'FHIR_PROXY_ERROR',
                    message: 'Failed to connect to upstream FHIR server'
                });
            }
        }
    }
});

// Forward all requests
fhirRouter.use('/', proxy);

