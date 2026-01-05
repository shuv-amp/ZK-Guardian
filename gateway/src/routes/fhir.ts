
import { Router } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { zkAuthMiddleware } from '../middleware/zkAuthMiddleware.js';

export const fhirRouter: Router = Router();

const HAPI_FHIR_URL = process.env.HAPI_FHIR_URL || "http://localhost:8080/fhir";

// 1. ZK Audit Layer: Enforce privacy policy before touching the upstream server
fhirRouter.use(zkAuthMiddleware);

// 2. Proxy Layer: Forward to HAPI FHIR
const proxy = createProxyMiddleware({
    target: HAPI_FHIR_URL,
    changeOrigin: true,
    pathRewrite: {
        // If the router is mounted at /fhir, req.url is /Patient/123.
        // If target is .../fhir, we simply append.
        // No rewrite needed if HAPI expects /Patient/123 relative to its base.
    },
    on: {
        proxyRes: (proxyRes, req: any, res) => {
            // Attach audit headers to the response for client verification
            if (req.zkAudit) {
                proxyRes.headers['X-ZK-Reference'] = req.zkAudit.txHash;
                proxyRes.headers['X-ZK-Proof-Hash'] = req.zkAudit.proofHash;
                proxyRes.headers['X-ZK-Access-Event'] = req.zkAudit.accessEventHash;
            }
        }
    }
});

// Forward all requests
fhirRouter.use('/', proxy);
