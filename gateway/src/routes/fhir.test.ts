
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express, { Express } from 'express';
import { fhirRouter } from './fhir.js';

// Mock ZK Proof Service
const mockGenerate = vi.fn();
vi.mock('../services/zkProofService', () => ({
    zkProofService: {
        generateAccessProof: (...args: any[]) => mockGenerate(...args)
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
            req.smartContext = {
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
        // search query hash check logic is internal, but we know it calls generate
    });

    it('should bypass ZK Audit for non-clinical resources', async () => {
        const res = await request(app).get('/fhir/Metadata');
        expect(res.status).toBe(200);
        expect(mockGenerate).not.toHaveBeenCalled();
    });

    it('should return 403 if ZK Service throws NO_ACTIVE_CONSENT', async () => {
        mockGenerate.mockRejectedValue(new Error("NO_ACTIVE_CONSENT"));

        const res = await request(app).get('/fhir/Patient/123');

        expect(res.status).toBe(403);
        expect(res.body.error).toContain("Access Denied");
    });

    it('should return 500 if ZK Service fails generically', async () => {
        mockGenerate.mockRejectedValue(new Error("Circuit Error"));

        const res = await request(app).get('/fhir/Patient/123');

        expect(res.status).toBe(500);
    });
});
