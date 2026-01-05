
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express, { Express } from 'express';
// Note: We use the .js extension because we are using ESM in the actual code
import { fhirRouter } from './fhir.js';

// --- Mocks ---

// Mock ZK Proof Service
const mockGenerate = vi.fn();
vi.mock('../services/zkProofService', () => ({
    zkProofService: {
        generateAccessProof: (...args: any[]) => mockGenerate(...args)
    }
}));

// Mock Consent Handshake
const mockRequestConsent = vi.fn();
vi.mock('../services/consentHandshake', () => ({
    consentHandshakeService: {
        requestConsent: (...args: any[]) => mockRequestConsent(...args)
    }
}));

// Mock Axios (for Consent Creation)
const mockAxiosPut = vi.fn();
vi.mock('axios', () => ({
    default: {
        put: (...args: any[]) => mockAxiosPut(...args),
        get: vi.fn(),
        post: vi.fn()
    }
}));

// Mock http-proxy-middleware
vi.mock('http-proxy-middleware', () => ({
    createProxyMiddleware: () => (req: any, res: any, next: any) => {
        res.status(200).send("Proxied Response");
    }
}));

describe('FHIR Proxy Routes', () => {
    let app: Express;

    beforeEach(() => {
        vi.clearAllMocks();
        app = express();
        app.use(express.json());

        // Simulate Upstream SMART Context
        app.use((req, res, next) => {
            (req as any).smartContext = {
                patient: "123",
                practitioner: "practitioner-456"
            };
            next();
        });

        app.use('/fhir', fhirRouter);
    });

    it('should trigger ZK Audit for clinical resources (Observation)', async () => {
        mockGenerate.mockResolvedValue({
            proofHash: "0xProof",
            publicSignals: ["0xPolicy", "123456", "0xEventHash"]
        });

        const res = await request(app).get('/fhir/Observation/obs-1');

        expect(res.status).toBe(200);
        expect(res.text).toBe("Proxied Response");

        expect(mockGenerate).toHaveBeenCalledWith(expect.objectContaining({
            resourceType: "Observation",
            resourceId: "obs-1",
            patientId: "123"
        }));
    });

    it('should trigger ZK Audit for search requests', async () => {
        mockGenerate.mockResolvedValue({
            proofHash: "0xProof",
            publicSignals: ["0xPolicy", "123456", "0xEventHash"]
        });

        const res = await request(app).get('/fhir/Observation?code=123');

        expect(res.status).toBe(200);
        expect(mockGenerate).toHaveBeenCalled();
    });

    it('should bypass ZK Audit for non-clinical resources', async () => {
        const res = await request(app).get('/fhir/Metadata');
        expect(res.status).toBe(200);
        expect(mockGenerate).not.toHaveBeenCalled();
    });

    // --- JIT Consent Handshake Tests ---

    it('should trigger JIT Handshake when consent is missing', async () => {
        // First call fails
        mockGenerate.mockRejectedValueOnce(new Error("NO_ACTIVE_CONSENT"));
        // Handshake succeeds
        mockRequestConsent.mockResolvedValue(true);
        // Axios creates consent
        mockAxiosPut.mockResolvedValue({ status: 200 });
        // Second call (Retry) succeeds
        mockGenerate.mockResolvedValueOnce({
            proofHash: "0xProofRetry",
            publicSignals: ["0xPolicy", "123456", "0xEventRetry"]
        });

        const res = await request(app).get('/fhir/Patient/123');

        expect(res.status).toBe(200);
        expect(mockRequestConsent).toHaveBeenCalledWith("123", expect.any(Object));
        expect(mockAxiosPut).toHaveBeenCalled(); // Consent creation
        expect(mockGenerate).toHaveBeenCalledTimes(2); // Initial fail + Retry
    });

    it('should deny access if JIT Handshake is refused', async () => {
        mockGenerate.mockRejectedValueOnce(new Error("NO_ACTIVE_CONSENT"));
        mockRequestConsent.mockResolvedValue(false); // Denied

        const res = await request(app).get('/fhir/Patient/123');

        expect(res.status).toBe(403);
        expect(res.body.error).toContain("Access Denied");
        expect(mockGenerate).toHaveBeenCalledTimes(1); // No retry
    });

    it('should deny access if Handshake fails/times out', async () => {
        mockGenerate.mockRejectedValueOnce(new Error("NO_ACTIVE_CONSENT"));
        mockRequestConsent.mockRejectedValue(new Error("Timeout"));

        const res = await request(app).get('/fhir/Patient/123');

        expect(res.status).toBe(403);
        expect(res.body.error).toContain("Consent handshake failed");
    });

    it('should return 500 if ZK Service fails generically', async () => {
        mockGenerate.mockRejectedValue(new Error("Circuit Error"));

        const res = await request(app).get('/fhir/Patient/123');

        expect(res.status).toBe(500);
    });
});
