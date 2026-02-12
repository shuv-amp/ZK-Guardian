import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import request from 'supertest';
import express, { Express } from 'express';

const mockGenerate = vi.fn();
const mockRequestConsent = vi.fn();
const mockAxiosPut = vi.fn();
const mockRedisGet = vi.fn();
const mockRedisSetex = vi.fn();
const mockReplayCheckAndReserve = vi.fn();
const mockReplayConfirm = vi.fn();
const mockReplayFailed = vi.fn();
const mockRecordAccessEvent = vi.fn();
const mockWebhookEmit = vi.fn();
const mockVerifyAndAudit = vi.fn();

vi.mock('../modules/security/zkProofService.js', () => ({
    zkProofService: {
        generateAccessProof: (...args: any[]) => mockGenerate(...args)
    }
}));

vi.mock('../modules/consent/consentHandshake.js', () => ({
    consentHandshakeService: {
        requestConsent: (...args: any[]) => mockRequestConsent(...args)
    }
}));

vi.mock('../modules/security/replayProtection.js', () => ({
    replayProtection: {
        checkAndReserve: (...args: any[]) => mockReplayCheckAndReserve(...args),
        confirmProof: (...args: any[]) => mockReplayConfirm(...args),
        markFailed: (...args: any[]) => mockReplayFailed(...args)
    }
}));

vi.mock('../routes/patientAudit.js', () => ({
    recordAccessEvent: (...args: any[]) => mockRecordAccessEvent(...args)
}));

vi.mock('../modules/notification/webhookService.js', () => ({
    webhookService: {
        emit: (...args: any[]) => mockWebhookEmit(...args)
    }
}));

vi.mock('../db/redis.js', () => ({
    getRedis: () => ({
        get: (...args: any[]) => mockRedisGet(...args),
        setex: (...args: any[]) => mockRedisSetex(...args)
    })
}));

vi.mock('axios', () => ({
    default: {
        put: (...args: any[]) => mockAxiosPut(...args),
        get: vi.fn(),
        post: vi.fn()
    }
}));

vi.mock('ethers', () => ({
    ethers: {
        JsonRpcProvider: class MockProvider {
            constructor(_rpc: string) { }
        },
        Wallet: class MockWallet {
            constructor(_pk: string, _provider: any) { }
        },
        Contract: class MockContract {
            verifyAndAudit(...args: any[]) {
                return mockVerifyAndAudit(...args);
            }
        }
    }
}));

vi.mock('http-proxy-middleware', () => ({
    responseInterceptor: (handler: any) => handler,
    createProxyMiddleware: () => (_req: any, res: any) => {
        res.status(200).send('Proxied Response');
    }
}));

const createMockProof = (eventHash = '123456'): any => ({
    proofHash: '0xproofhash',
    proof: {
        a: ['1', '2'],
        b: [['1', '2'], ['3', '4']],
        c: ['5', '6']
    },
    publicSignals: ['1', '111', '222', '333', '444', '555', eventHash]
});

describe('FHIR Proxy Routes', () => {
    let app: Express;
    let fhirRouter: any;

    beforeAll(async () => {
        ({ fhirRouter } = await import('./fhir.js'));
    });

    beforeEach(() => {
        vi.clearAllMocks();

        mockRedisGet.mockResolvedValue('123456789');
        mockRedisSetex.mockResolvedValue('OK');
        mockAxiosPut.mockResolvedValue({ status: 200 });
        mockGenerate.mockResolvedValue(createMockProof());
        mockRequestConsent.mockResolvedValue({
            approved: true,
            nullifier: '999999',
            sessionNonce: '777777'
        });
        mockReplayCheckAndReserve.mockResolvedValue({ isNew: true });
        mockReplayConfirm.mockResolvedValue(undefined);
        mockReplayFailed.mockResolvedValue(undefined);
        mockRecordAccessEvent.mockResolvedValue(undefined);
        mockWebhookEmit.mockResolvedValue(undefined);
        mockVerifyAndAudit.mockResolvedValue({
            wait: async () => ({ hash: '0xmocktx', blockNumber: 123 })
        });

        app = express();
        app.use(express.json());

        app.use((req, _res, next) => {
            (req as any).smartContext = {
                sub: 'practitioner-456',
                patient: '123',
                practitioner: 'practitioner-456',
                scope: 'patient/*.read user/*.read'
            };
            next();
        });

        app.use('/fhir', fhirRouter);
    });

    it('should trigger ZK Audit for clinical resources (Observation)', async () => {
        const res = await request(app).get('/fhir/Observation/obs-1');

        expect(res.status).toBe(200);
        expect(res.text).toBe('Proxied Response');
        expect(mockGenerate).toHaveBeenCalledWith(expect.objectContaining({
            resourceType: 'Observation',
            resourceId: 'obs-1',
            patientId: '123'
        }));
        expect(mockVerifyAndAudit).toHaveBeenCalledTimes(1);
    });

    it('should trigger ZK Audit for search requests', async () => {
        const res = await request(app).get('/fhir/Observation?code=123');

        expect(res.status).toBe(200);
        expect(mockGenerate).toHaveBeenCalledTimes(1);
        expect(mockVerifyAndAudit).toHaveBeenCalledTimes(1);
    });

    it('should bypass ZK Audit for non-clinical resources', async () => {
        const res = await request(app).get('/fhir/Metadata');

        expect(res.status).toBe(200);
        expect(mockGenerate).not.toHaveBeenCalled();
        expect(mockVerifyAndAudit).not.toHaveBeenCalled();
    });

    it('should trigger JIT Handshake when consent is missing', async () => {
        mockRedisGet.mockResolvedValueOnce(null);

        const res = await request(app).get('/fhir/Patient/123');

        expect(res.status).toBe(200);
        expect(mockRequestConsent).toHaveBeenCalledWith('123', expect.objectContaining({
            practitioner: 'practitioner-456',
            resourceType: 'Patient',
            resourceId: '123'
        }));
        expect(mockAxiosPut).toHaveBeenCalledTimes(1);
        expect(mockRedisSetex).toHaveBeenCalledTimes(1);
        expect(mockGenerate).toHaveBeenCalledTimes(1);
    });

    it('should deny access if JIT Handshake is refused', async () => {
        mockRedisGet.mockResolvedValueOnce(null);
        mockRequestConsent.mockResolvedValueOnce({
            approved: false
        });

        const res = await request(app).get('/fhir/Patient/123');

        expect(res.status).toBe(403);
        expect(res.body.error).toBe('CONSENT_DENIED');
        expect(mockGenerate).not.toHaveBeenCalled();
    });

    it('should deny access if Handshake fails/times out', async () => {
        mockRedisGet.mockResolvedValueOnce(null);
        mockRequestConsent.mockRejectedValueOnce(new Error('Timeout'));

        const res = await request(app).get('/fhir/Patient/123');

        expect(res.status).toBe(403);
        expect(res.body.error).toBe('CONSENT_TIMEOUT');
    });

    it('should return 500 if ZK Service fails generically', async () => {
        mockGenerate.mockRejectedValueOnce(new Error('Circuit Error'));

        const res = await request(app).get('/fhir/Patient/123');

        expect(res.status).toBe(500);
        expect(res.body.error).toBe('AUDIT_FAILED');
    });
});
