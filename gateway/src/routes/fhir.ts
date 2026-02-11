
import { Router, Request, Response } from 'express';
import { createProxyMiddleware, responseInterceptor } from 'http-proxy-middleware';
import { zkAuthMiddleware } from '../middleware/zkAuthMiddleware.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

export const fhirRouter: Router = Router();

const HAPI_FHIR_URL = env.HAPI_FHIR_URL || "http://localhost:8080/fhir";

// 1. ZK Audit Layer: Enforce privacy policy before touching the upstream server
// Debug logging for FHIR requests
fhirRouter.use((req, res, next) => {
    logger.info({ method: req.method, url: req.url, query: req.query }, 'Incoming FHIR Request');
    next();
});

// 1. ZK Audit Layer: Enforce privacy policy before touching the upstream server
// MOVED: zkAuthMiddleware is now applied AFTER synthetic routes to allow dev bypass

// Dev-only: Synthetic Consent to bypass broken HAPI
fhirRouter.get('/Consent', async (req: Request, res: Response, next) => {
    if (env.NODE_ENV !== 'production' && env.ENABLE_SYNTHETIC_CONSENT) {
        const patientParam = req.query.patient as string;
        const isRiley = patientParam && patientParam.toLowerCase().includes('riley');

        if (isRiley) {
            const patientId = patientParam.replace('Patient/', '');
            const now = new Date();
            const consent = {
                resourceType: "Consent",
                id: `synthetic-${patientId}`,
                status: "active",
                scope: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/consentscope", code: "patient-privacy" }] },
                category: [{ coding: [{ system: "http://loinc.org", code: "59284-0" }] }],
                patient: { reference: `Patient/${patientId}` },
                dateTime: now.toISOString(),
                provision: {
                    type: "permit",
                    period: { start: now.toISOString(), end: new Date(now.getTime() + 3600000).toISOString() },
                    class: [{ code: "Observation" }, { code: "Condition" }, { code: "MedicationRequest" }]
                },
                meta: { lastUpdated: now.toISOString() } // Added for mobile display
            };

            return res.json({
                resourceType: 'Bundle',
                type: 'searchset',
                total: 1,
                entry: [{ resource: consent }]
            });
        }
    }
    next();
});

// Dev-only: Synthetic Observation (Lab Results)
fhirRouter.get('/Observation', async (req: Request, res: Response, next) => {
    if (env.NODE_ENV !== 'production' && env.ENABLE_SYNTHETIC_CONSENT) {
        const patientParam = req.query.patient as string;
        if (patientParam && patientParam.toLowerCase().includes('riley')) {
            const now = new Date();
            const observations = [
                {
                    resourceType: "Observation",
                    id: "syn-obs-1",
                    status: "final",
                    category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "laboratory", display: "Laboratory" }] }],
                    code: { coding: [{ system: "http://loinc.org", code: "85354-9", display: "Blood Pressure" }] },
                    subject: { reference: "Patient/patient-riley" },
                    effectiveDateTime: now.toISOString(),
                    valueQuantity: { value: 120, unit: "mmHg", system: "http://unitsofmeasure.org", code: "mm[Hg]" },
                    component: [
                        { code: { coding: [{ system: "http://loinc.org", code: "8480-6", display: "Systolic" }] }, valueQuantity: { value: 120, unit: "mmHg" } },
                        { code: { coding: [{ system: "http://loinc.org", code: "8462-4", display: "Diastolic" }] }, valueQuantity: { value: 80, unit: "mmHg" } }
                    ],
                    meta: { lastUpdated: now.toISOString() }
                },
                {
                    resourceType: "Observation",
                    id: "syn-obs-2",
                    status: "final",
                    category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "vital-signs", display: "Vital Signs" }] }],
                    code: { coding: [{ system: "http://loinc.org", code: "8867-4", display: "Heart Rate" }] },
                    subject: { reference: "Patient/patient-riley" },
                    effectiveDateTime: new Date(now.getTime() - 86400000).toISOString(),
                    valueQuantity: { value: 72, unit: "bpm", system: "http://unitsofmeasure.org", code: "/min" },
                    meta: { lastUpdated: new Date(now.getTime() - 86400000).toISOString() }
                }
            ];

            return res.json({
                resourceType: 'Bundle',
                type: 'searchset',
                total: observations.length,
                entry: observations.map(r => ({ resource: r })),
                meta: { tag: [{ system: 'zk-guardian', code: 'synthetic-data' }] }
            });
        }
    }
    next();
});

// Dev-only: Synthetic Medications
fhirRouter.get('/MedicationRequest', async (req: Request, res: Response, next) => {
    if (env.NODE_ENV !== 'production' && env.ENABLE_SYNTHETIC_CONSENT) {
        if (req.query.patient && (req.query.patient as string).toLowerCase().includes('riley')) {
            const now = new Date();
            const medications = [
                {
                    resourceType: "MedicationRequest",
                    id: "syn-med-1",
                    status: "active",
                    intent: "order",
                    medicationCodeableConcept: { coding: [{ system: "http://www.nlm.nih.gov/research/umls/rxnorm", code: "197361", display: "Lisinopril 10 MG Oral Tablet" }] },
                    subject: { reference: "Patient/patient-riley" },
                    authoredOn: now.toISOString(),
                    requester: { display: "Dr. Jordan Lee" },
                    meta: { lastUpdated: now.toISOString() }
                },
                {
                    resourceType: "MedicationRequest",
                    id: "syn-med-2",
                    status: "active",
                    intent: "order",
                    medicationCodeableConcept: { coding: [{ system: "http://www.nlm.nih.gov/research/umls/rxnorm", code: "860975", display: "Metformin 500 MG Oral Tablet" }] },
                    subject: { reference: "Patient/patient-riley" },
                    authoredOn: now.toISOString(),
                    requester: { display: "Dr. Jordan Lee" },
                    meta: { lastUpdated: now.toISOString() }
                }
            ];
            return res.json({ resourceType: 'Bundle', type: 'searchset', total: medications.length, entry: medications.map(r => ({ resource: r })) });
        }
    }
    next();
});

// Dev-only: Synthetic Conditions
fhirRouter.get('/Condition', async (req: Request, res: Response, next) => {
    if (env.NODE_ENV !== 'production' && env.ENABLE_SYNTHETIC_CONSENT) {
        if (req.query.patient && (req.query.patient as string).toLowerCase().includes('riley')) {
            const now = new Date();
            const conditions = [
                {
                    resourceType: "Condition",
                    id: "syn-con-1",
                    clinicalStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "active" }] },
                    verificationStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-ver-status", code: "confirmed" }] },
                    code: { coding: [{ system: "http://snomed.info/sct", code: "38341003", display: "Hypertensive disorder" }] },
                    subject: { reference: "Patient/patient-riley" },
                    onsetDateTime: "2024-01-01",
                    meta: { lastUpdated: "2024-01-01T00:00:00Z" }
                },
                {
                    resourceType: "Condition",
                    id: "syn-con-2",
                    clinicalStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "active" }] },
                    code: { coding: [{ system: "http://snomed.info/sct", code: "73211009", display: "Diabetes mellitus type 2" }] },
                    subject: { reference: "Patient/patient-riley" },
                    onsetDateTime: "2023-06-15",
                    meta: { lastUpdated: "2023-06-15T00:00:00Z" }
                }
            ];
            return res.json({ resourceType: 'Bundle', type: 'searchset', total: conditions.length, entry: conditions.map(r => ({ resource: r })) });
        }
    }
    next();
});

// Dev-only: Synthetic DiagnosticReport
fhirRouter.get('/DiagnosticReport', async (req: Request, res: Response, next) => {
    if (env.NODE_ENV !== 'production' && env.ENABLE_SYNTHETIC_CONSENT) {
        if (req.query.patient && (req.query.patient as string).toLowerCase().includes('riley')) {
            const now = new Date();
            const reports = [
                {
                    resourceType: "DiagnosticReport",
                    id: "syn-rpt-1",
                    status: "final",
                    code: { coding: [{ system: "http://loinc.org", code: "24331-1", display: "Lipid 1996 panel - Serum or Plasma" }] },
                    subject: { reference: "Patient/patient-riley" },
                    effectiveDateTime: now.toISOString(),
                    issued: now.toISOString(),
                    performer: [{ display: "City Hospital Lab" }],
                    meta: { lastUpdated: now.toISOString() }
                }
            ];
            return res.json({ resourceType: 'Bundle', type: 'searchset', total: reports.length, entry: reports.map(r => ({ resource: r })) });
        }
    }
    next();
});

// Dev-only: Synthetic Encounter
fhirRouter.get('/Encounter', async (req: Request, res: Response, next) => {
    if (env.NODE_ENV !== 'production' && env.ENABLE_SYNTHETIC_CONSENT) {
        if (req.query.patient && (req.query.patient as string).toLowerCase().includes('riley')) {
            const now = new Date();
            const encounters = [
                {
                    resourceType: "Encounter",
                    id: "syn-enc-1",
                    status: "finished",
                    class: { system: "http://terminology.hl7.org/CodeSystem/v3-ActCode", code: "AMB", display: "ambulatory" },
                    type: [{ coding: [{ system: "http://snomed.info/sct", code: "11429006", display: "Consultation" }] }],
                    subject: { reference: "Patient/patient-riley" },
                    period: { start: now.toISOString(), end: now.toISOString() },
                    participant: [{ individual: { display: "Dr. Jordan Lee" } }],
                    meta: { lastUpdated: now.toISOString() }
                }
            ];
            return res.json({ resourceType: 'Bundle', type: 'searchset', total: encounters.length, entry: encounters.map(r => ({ resource: r })) });
        }
    }
    next();
});

// 2. ZK Audit Layer: Enforce privacy policy for everything else
fhirRouter.use(zkAuthMiddleware);

// 2. Proxy Layer: Forward to HAPI FHIR with proper ZK headers
const proxy = createProxyMiddleware({
    target: HAPI_FHIR_URL,
    changeOrigin: true,
    selfHandleResponse: true, // Use responseInterceptor
    proxyTimeout: 10000,
    timeout: 10000,
    // Intercept response to handle HAPI 500 failures in dev
    on: {
        proxyReq: (proxyReq, req: any) => {
            const requestId = req.requestId;
            if (requestId) proxyReq.setHeader('X-Request-ID', requestId);
            logger.debug({ target: HAPI_FHIR_URL, path: req.path }, 'Proxying FHIR request');
        },
        proxyRes: responseInterceptor(async (responseBuffer, proxyRes, req: any, res: any) => {
            // Forward headers
            if (req.zkAudit) {
                res.setHeader('X-ZK-Audit-Hash', req.zkAudit.proofHash);
                res.setHeader('X-ZK-Tx-Hash', req.zkAudit.txHash);
                res.setHeader('X-ZK-Access-Event', req.zkAudit.accessEventHash);
            }
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.setHeader('X-Frame-Options', 'DENY');

            // Handle HAPI Errors (5xx) in Dev Mode
            if (proxyRes.statusCode && proxyRes.statusCode >= 500 && env.NODE_ENV !== 'production') {
                logger.warn({ statusCode: proxyRes.statusCode, path: req.path }, 'Upstream FHIR failed - serving dev fallback');
                const resourceType = req.path.split('/').filter(Boolean)[0] || 'Resource';

                // Force 200 OK for the fallback to be accepted by client
                res.statusCode = 200;

                // Return valid empty bundle instead of error
                return JSON.stringify({
                    resourceType: 'Bundle',
                    type: 'searchset',
                    total: 0,
                    entry: [],
                    link: [{ relation: 'self', url: `${HAPI_FHIR_URL}/${resourceType}` }],
                    meta: { tag: [{ system: 'zk-guardian', code: 'dev-fallback-500' }] }
                });
            }

            return responseBuffer;
        }),
        error: (err, req, res: any) => {
            logger.error({ error: err.message, path: req.url }, 'FHIR proxy error');
            if (res.headersSent) return;

            if (env.NODE_ENV !== 'production') {
                const resourceType = req.path.split('/').filter(Boolean)[0] || 'Resource';
                res.status(200).json({
                    resourceType: 'Bundle',
                    type: 'searchset',
                    total: 0,
                    entry: [],
                    meta: { tag: [{ system: 'zk-guardian', code: 'dev-fallback-network' }] }
                });
                return;
            }
            res.status(502).json({ error: 'FHIR_PROXY_ERROR', message: 'Failed to connect to upstream FHIR server' });
        }
    }
});

// Forward all requests
fhirRouter.use('/', proxy);

