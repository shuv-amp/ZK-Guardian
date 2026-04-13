import process from 'node:process';
import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import WebSocket from 'ws';
import { startMockSmartIdpServer, type MockSmartIdpServer } from './mock-smart-idp.js';

type CheckStatus = 'pass' | 'fail' | 'skip';

type CheckRecord = {
    name: string;
    status: CheckStatus;
    required: boolean;
    details: Record<string, unknown>;
};

type Options = {
    baseUrl?: string;
    wsUrl?: string;
    outputPath: string;
    timeoutMs: number;
    patientId: string;
    clinicianId: string;
    mockBaseUrl?: string;
    mockPort: number;
    mockAudience: string;
    publicClientId: string;
    confidentialClientId: string;
    confidentialClientSecret: string;
};

type TokenBundle = {
    patientToken: string;
    clinicianToken: string;
    revokedToken: string;
};

type FetchResult = {
    status: number;
    ok: boolean;
    url: string;
    text: string;
    json: any;
};

const DEFAULT_OUTPUT_PATH = path.resolve('.artifacts/mock-smart-validation/latest.json');
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_PATIENT_ID = 'mock-patient-123';
const DEFAULT_CLINICIAN_ID = 'mock-clinician-456';
const DEFAULT_AUDIENCE = process.env.MOCK_SMART_AUDIENCE || 'http://localhost:8080/fhir';
const DEFAULT_PUBLIC_CLIENT_ID = process.env.MOCK_SMART_PUBLIC_CLIENT_ID || 'zk-guardian-mobile';
const DEFAULT_CONFIDENTIAL_CLIENT_ID = process.env.MOCK_SMART_CONFIDENTIAL_CLIENT_ID || 'zk-guardian-gateway';
const DEFAULT_CONFIDENTIAL_CLIENT_SECRET = process.env.MOCK_SMART_CONFIDENTIAL_CLIENT_SECRET || 'mock-smart-secret';
const DEFAULT_MOCK_PORT = Number(process.env.MOCK_SMART_PORT || '4010');

const PATIENT_SCOPE = 'openid fhirUser offline_access patient/*.read patient/*.write launch/patient';
const CLINICIAN_SCOPE = 'openid fhirUser offline_access user/*.read patient/*.read';

function printHelp(): void {
    console.log(`Mock external SMART validation

Usage:
  pnpm --filter gateway verify:mock-smart -- [options]

Options:
  --base-url <url>               Gateway base URL for integration checks
  --ws-url <url>                 Gateway WebSocket URL. Default: derived from base URL
  --patient-id <id>              Mock patient ID. Default: mock-patient-123
  --clinician-id <id>            Mock clinician ID. Default: mock-clinician-456
  --mock-base-url <url>          Reuse an already-running mock SMART issuer
  --mock-port <port>             Start an in-process mock issuer on this port if mock-base-url is not set
  --mock-audience <value>        Audience claim to issue
  --output <path>                Evidence output path
  --timeout-ms <ms>              Per-check timeout. Default: 10000
  --help                         Show this help

Environment inputs:
  BASE_URL
  WS_URL
  PATIENT_ID
  CLINICIAN_ID
  MOCK_SMART_BASE_URL
  MOCK_SMART_PORT
  MOCK_SMART_AUDIENCE
`);
}

function parseNumber(value: string | undefined, fallback: number): number {
    if (!value) {
        return fallback;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeUrl(value: string): string {
    return value.replace(/\/$/, '');
}

function deriveWsUrl(baseUrl: string): string {
    const url = new URL(baseUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = '/ws/consent';
    url.search = '';
    url.hash = '';
    return url.toString();
}

function parseArgs(argv: string[]): Options {
    let baseUrl = process.env.BASE_URL;
    let wsUrl = process.env.WS_URL;
    let outputPath = process.env.OUTPUT_PATH || DEFAULT_OUTPUT_PATH;
    let timeoutMs = parseNumber(process.env.REQUEST_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
    let patientId = process.env.PATIENT_ID || DEFAULT_PATIENT_ID;
    let clinicianId = process.env.CLINICIAN_ID || DEFAULT_CLINICIAN_ID;
    let mockBaseUrl = process.env.MOCK_SMART_BASE_URL;
    let mockPort = DEFAULT_MOCK_PORT;
    let mockAudience = DEFAULT_AUDIENCE;

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--help') {
            printHelp();
            process.exit(0);
        }
        if (arg === '--base-url') {
            baseUrl = argv[i + 1] || baseUrl;
            i += 1;
            continue;
        }
        if (arg === '--ws-url') {
            wsUrl = argv[i + 1] || wsUrl;
            i += 1;
            continue;
        }
        if (arg === '--patient-id') {
            patientId = argv[i + 1] || patientId;
            i += 1;
            continue;
        }
        if (arg === '--clinician-id') {
            clinicianId = argv[i + 1] || clinicianId;
            i += 1;
            continue;
        }
        if (arg === '--mock-base-url') {
            mockBaseUrl = argv[i + 1] || mockBaseUrl;
            i += 1;
            continue;
        }
        if (arg === '--mock-port') {
            mockPort = parseNumber(argv[i + 1], mockPort);
            i += 1;
            continue;
        }
        if (arg === '--mock-audience') {
            mockAudience = argv[i + 1] || mockAudience;
            i += 1;
            continue;
        }
        if (arg === '--output') {
            outputPath = argv[i + 1] || outputPath;
            i += 1;
            continue;
        }
        if (arg === '--timeout-ms') {
            timeoutMs = parseNumber(argv[i + 1], timeoutMs);
            i += 1;
            continue;
        }
    }

    return {
        baseUrl: baseUrl ? normalizeUrl(baseUrl) : undefined,
        wsUrl: wsUrl ? normalizeUrl(wsUrl) : (baseUrl ? deriveWsUrl(baseUrl) : undefined),
        outputPath: path.isAbsolute(outputPath) ? outputPath : path.resolve(outputPath),
        timeoutMs,
        patientId,
        clinicianId,
        mockBaseUrl: mockBaseUrl ? normalizeUrl(mockBaseUrl) : undefined,
        mockPort,
        mockAudience,
        publicClientId: DEFAULT_PUBLIC_CLIENT_ID,
        confidentialClientId: DEFAULT_CONFIDENTIAL_CLIENT_ID,
        confidentialClientSecret: DEFAULT_CONFIDENTIAL_CLIENT_SECRET
    };
}

async function fetchWithTimeout(url: string, timeoutMs: number, init?: RequestInit): Promise<FetchResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            ...init,
            signal: controller.signal
        });
        const text = await response.text();
        let json: any = null;
        try {
            json = text ? JSON.parse(text) : null;
        } catch {
            json = null;
        }

        return {
            status: response.status,
            ok: response.ok,
            url,
            text,
            json
        };
    } finally {
        clearTimeout(timer);
    }
}

async function postForm(url: string, data: Record<string, string | undefined>, timeoutMs: number, headers: Record<string, string> = {}): Promise<Response> {
    const form = new URLSearchParams();
    for (const [key, value] of Object.entries(data)) {
        if (value !== undefined) {
            form.set(key, value);
        }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, {
            method: 'POST',
            headers: {
                'content-type': 'application/x-www-form-urlencoded',
                ...headers
            },
            body: form.toString(),
            redirect: 'manual',
            signal: controller.signal
        });
    } finally {
        clearTimeout(timer);
    }
}

function logCheck(checks: CheckRecord[], name: string, status: CheckStatus, required: boolean, details: Record<string, unknown>): void {
    const record = { name, status, required, details };
    checks.push(record);
    console.log(`${status.toUpperCase().padEnd(4, ' ')} ${name}`);
    if (Object.keys(details).length > 0) {
        console.log(JSON.stringify(details, null, 2));
    }
}

function buildBasicAuth(clientId: string, clientSecret: string): string {
    return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
}

function pkcePair(): { verifier: string; challenge: string } {
    const verifier = createHash('sha256').update(randomUUID()).digest('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    return { verifier, challenge };
}

async function issueMockToken(
    mockBaseUrl: string,
    publicClientId: string,
    role: 'patient' | 'clinician',
    subjectId: string,
    scope: string,
    timeoutMs: number
): Promise<string> {
    const { verifier, challenge } = pkcePair();
    const authorizeUrl = new URL(`${mockBaseUrl}/authorize`);
    authorizeUrl.searchParams.set('client_id', publicClientId);
    authorizeUrl.searchParams.set('redirect_uri', 'zkguardian://auth');
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('scope', scope);
    authorizeUrl.searchParams.set('state', randomUUID());
    authorizeUrl.searchParams.set('code_challenge', challenge);
    authorizeUrl.searchParams.set('code_challenge_method', 'S256');
    authorizeUrl.searchParams.set('login_hint', `${role}:${subjectId}`);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let manualAuthorize: Response;
    try {
        manualAuthorize = await fetch(authorizeUrl.toString(), {
            redirect: 'manual',
            signal: controller.signal
        });
    } finally {
        clearTimeout(timer);
    }

    const redirectHeader = manualAuthorize.headers.get('location');
    if (!redirectHeader) {
        const errorText = await manualAuthorize.text();
        throw new Error(`Mock authorize did not return redirect. HTTP ${manualAuthorize.status} ${errorText}`);
    }

    const code = new URL(redirectHeader).searchParams.get('code');
    if (!code) {
        throw new Error('Mock authorize redirect missing code');
    }

    const tokenResponse = await postForm(`${mockBaseUrl}/token`, {
        grant_type: 'authorization_code',
        client_id: publicClientId,
        redirect_uri: 'zkguardian://auth',
        code,
        code_verifier: verifier
    }, timeoutMs);

    const tokenJson = await tokenResponse.json() as { access_token?: string };
    if (!tokenResponse.ok || !tokenJson.access_token) {
        throw new Error(`Mock token exchange failed with HTTP ${tokenResponse.status}`);
    }

    return tokenJson.access_token;
}

async function introspectToken(
    mockBaseUrl: string,
    clientId: string,
    clientSecret: string,
    token: string,
    timeoutMs: number
): Promise<any> {
    const response = await postForm(
        `${mockBaseUrl}/introspect`,
        { token, token_type_hint: 'access_token' },
        timeoutMs,
        { Authorization: buildBasicAuth(clientId, clientSecret) }
    );

    return response.json();
}

async function revokeToken(
    mockBaseUrl: string,
    clientId: string,
    clientSecret: string,
    token: string,
    timeoutMs: number
): Promise<number> {
    const response = await postForm(
        `${mockBaseUrl}/revoke`,
        { token, token_type_hint: 'access_token' },
        timeoutMs,
        { Authorization: buildBasicAuth(clientId, clientSecret) }
    );
    return response.status;
}

async function waitForWsAuthSuccess(wsUrl: string, token: string, timeoutMs: number): Promise<Record<string, unknown>> {
    return await new Promise((resolve, reject) => {
        let settled = false;
        const socket = new WebSocket(wsUrl, {
            headers: {
                Authorization: `Bearer ${token}`
            }
        });

        const timer = setTimeout(() => {
            if (settled) {
                return;
            }
            settled = true;
            socket.terminate();
            reject(new Error(`Timed out after ${timeoutMs}ms waiting for AUTH_SUCCESS`));
        }, timeoutMs);

        const finish = (fn: () => void): void => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            fn();
        };

        socket.once('message', (raw) => {
            finish(() => {
                const text = raw.toString();
                let payload: any = null;
                try {
                    payload = JSON.parse(text);
                } catch {
                    payload = null;
                }
                socket.close();
                if (payload?.type !== 'AUTH_SUCCESS') {
                    reject(new Error(`Unexpected WebSocket message ${text}`));
                    return;
                }
                resolve({
                    messageType: payload.type,
                    sessionId: payload.sessionId ?? null
                });
            });
        });

        socket.once('error', (error) => {
            finish(() => reject(error));
        });

        socket.once('close', (code, reason) => {
            finish(() => reject(new Error(`WebSocket closed early: ${code} ${reason.toString()}`)));
        });
    });
}

async function writeEvidence(outputPath: string, payload: Record<string, unknown>): Promise<void> {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

async function mintMockTokens(options: Options, mockBaseUrl: string): Promise<TokenBundle> {
    const patientToken = await issueMockToken(
        mockBaseUrl,
        options.publicClientId,
        'patient',
        options.patientId,
        PATIENT_SCOPE,
        options.timeoutMs
    );

    const clinicianToken = await issueMockToken(
        mockBaseUrl,
        options.publicClientId,
        'clinician',
        options.clinicianId,
        CLINICIAN_SCOPE,
        options.timeoutMs
    );

    const revokedToken = await issueMockToken(
        mockBaseUrl,
        options.publicClientId,
        'patient',
        options.patientId,
        PATIENT_SCOPE,
        options.timeoutMs
    );

    const revokeStatus = await revokeToken(
        mockBaseUrl,
        options.confidentialClientId,
        options.confidentialClientSecret,
        revokedToken,
        options.timeoutMs
    );

    if (revokeStatus !== 200) {
        throw new Error(`Failed to revoke mock token. HTTP ${revokeStatus}`);
    }

    return {
        patientToken,
        clinicianToken,
        revokedToken
    };
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    const checks: CheckRecord[] = [];
    let startedServer: MockSmartIdpServer | null = null;
    if (!options.mockBaseUrl) {
        startedServer = await startMockSmartIdpServer({
            port: options.mockPort,
            audience: options.mockAudience,
            publicClientId: options.publicClientId,
            confidentialClientId: options.confidentialClientId,
            confidentialClientSecret: options.confidentialClientSecret
        });
    }

    const mockBaseUrl = options.mockBaseUrl || startedServer!.baseUrl;
    try {
        console.log('Mock SMART validation configuration');
        console.log(JSON.stringify({
            mockBaseUrl,
            mockAudience: options.mockAudience,
            baseUrl: options.baseUrl || null,
            wsUrl: options.wsUrl || null,
            patientId: options.patientId,
            clinicianId: options.clinicianId,
            publicClientId: options.publicClientId,
            confidentialClientId: options.confidentialClientId,
            outputPath: options.outputPath
        }, null, 2));

        logCheck(checks, 'gateway_env_snippet', 'pass', false, {
            SMART_AUTH_MODE: 'external',
            SMART_ISSUER: mockBaseUrl,
            SMART_AUTHORIZATION_ENDPOINT: `${mockBaseUrl}/authorize`,
            SMART_TOKEN_ENDPOINT: `${mockBaseUrl}/token`,
            SMART_INTROSPECTION_ENDPOINT: `${mockBaseUrl}/introspect`,
            SMART_REVOCATION_ENDPOINT: `${mockBaseUrl}/revoke`,
            SMART_JWKS_URI: `${mockBaseUrl}/.well-known/jwks.json`,
            SMART_CLIENT_ID: options.confidentialClientId,
            SMART_CLIENT_SECRET: options.confidentialClientSecret,
            SMART_AUDIENCE: options.mockAudience
        });

        const discovery = await fetchWithTimeout(`${mockBaseUrl}/.well-known/smart-configuration`, options.timeoutMs);
        logCheck(
            checks,
            'mock_discovery',
            discovery.status === 200 && discovery.json?.issuer === mockBaseUrl ? 'pass' : 'fail',
            true,
            {
                httpStatus: discovery.status,
                issuer: discovery.json?.issuer ?? null,
                discovery: discovery.json ?? discovery.text
            }
        );

        const jwks = await fetchWithTimeout(`${mockBaseUrl}/.well-known/jwks.json`, options.timeoutMs);
        logCheck(
            checks,
            'mock_jwks',
            jwks.status === 200 && Array.isArray(jwks.json?.keys) && jwks.json.keys.length > 0 ? 'pass' : 'fail',
            true,
            {
                httpStatus: jwks.status,
                keyCount: Array.isArray(jwks.json?.keys) ? jwks.json.keys.length : 0
            }
        );

        const tokens = await mintMockTokens(options, mockBaseUrl);
        logCheck(checks, 'mock_tokens_issued', 'pass', true, {
            patientTokenLength: tokens.patientToken.length,
            clinicianTokenLength: tokens.clinicianToken.length,
            revokedTokenLength: tokens.revokedToken.length
        });

        const activeIntrospection = await introspectToken(
            mockBaseUrl,
            options.confidentialClientId,
            options.confidentialClientSecret,
            tokens.patientToken,
            options.timeoutMs
        );
        logCheck(
            checks,
            'mock_introspection_active',
            activeIntrospection?.active === true && activeIntrospection?.patient === options.patientId ? 'pass' : 'fail',
            true,
            {
                introspection: activeIntrospection
            }
        );

        const revokedIntrospection = await introspectToken(
            mockBaseUrl,
            options.confidentialClientId,
            options.confidentialClientSecret,
            tokens.revokedToken,
            options.timeoutMs
        );
        logCheck(
            checks,
            'mock_revocation',
            revokedIntrospection?.active === false ? 'pass' : 'fail',
            true,
            {
                introspection: revokedIntrospection
            }
        );

        if (options.baseUrl) {
            const gatewayDiscovery = await fetchWithTimeout(`${options.baseUrl}/.well-known/smart-configuration`, options.timeoutMs);
            const gatewayDiscoveryPass = gatewayDiscovery.status === 200
                && gatewayDiscovery.json?.issuer === mockBaseUrl
                && gatewayDiscovery.json?.introspection_endpoint === `${mockBaseUrl}/introspect`
                && gatewayDiscovery.json?.jwks_uri === `${mockBaseUrl}/.well-known/jwks.json`;

            logCheck(checks, 'gateway_external_discovery', gatewayDiscoveryPass ? 'pass' : 'fail', true, {
                httpStatus: gatewayDiscovery.status,
                discovery: gatewayDiscovery.json ?? gatewayDiscovery.text
            });

            const patientPrefs = await fetchWithTimeout(`${options.baseUrl}/api/patient/preferences`, options.timeoutMs, {
                headers: {
                    Authorization: `Bearer ${tokens.patientToken}`
                }
            });
            logCheck(checks, 'gateway_patient_token', patientPrefs.status === 200 ? 'pass' : 'fail', true, {
                httpStatus: patientPrefs.status,
                body: patientPrefs.json ?? patientPrefs.text
            });

            const clinicianStatus = await fetchWithTimeout(
                `${options.baseUrl}/api/break-glass/${encodeURIComponent(options.patientId)}/status`,
                options.timeoutMs,
                {
                    headers: {
                        Authorization: `Bearer ${tokens.clinicianToken}`
                    }
                }
            );
            logCheck(
                checks,
                'gateway_clinician_token',
                clinicianStatus.status === 200 && typeof clinicianStatus.json?.hasActiveSession === 'boolean' ? 'pass' : 'fail',
                true,
                {
                    httpStatus: clinicianStatus.status,
                    body: clinicianStatus.json ?? clinicianStatus.text
                }
            );

            const revokedAttempt = await fetchWithTimeout(`${options.baseUrl}/api/patient/preferences`, options.timeoutMs, {
                headers: {
                    Authorization: `Bearer ${tokens.revokedToken}`
                }
            });
            logCheck(
                checks,
                'gateway_revoked_token_rejected',
                revokedAttempt.status === 401 || revokedAttempt.status === 403 ? 'pass' : 'fail',
                true,
                {
                    httpStatus: revokedAttempt.status,
                    body: revokedAttempt.json ?? revokedAttempt.text
                }
            );

            if (options.wsUrl) {
                try {
                    const wsResult = await waitForWsAuthSuccess(options.wsUrl, tokens.patientToken, options.timeoutMs);
                    logCheck(checks, 'gateway_ws_bearer_auth', 'pass', true, wsResult);
                } catch (error) {
                    logCheck(checks, 'gateway_ws_bearer_auth', 'fail', true, {
                        error: error instanceof Error ? error.message : String(error)
                    });
                }
            } else {
                logCheck(checks, 'gateway_ws_bearer_auth', 'skip', false, {
                    reason: 'WS_URL not provided'
                });
            }
        } else {
            logCheck(checks, 'gateway_external_discovery', 'skip', false, {
                reason: 'BASE_URL not provided; ran mock IdP self-test only'
            });
        }

        const summary = checks.reduce(
            (acc, check) => {
                acc[check.status] += 1;
                if (check.required && check.status === 'fail') {
                    acc.requiredFailures += 1;
                }
                return acc;
            },
            { pass: 0, fail: 0, skip: 0, requiredFailures: 0 }
        );

        await writeEvidence(options.outputPath, {
            generatedAt: new Date().toISOString(),
            options: {
                baseUrl: options.baseUrl ?? null,
                wsUrl: options.wsUrl ?? null,
                mockBaseUrl,
                patientId: options.patientId,
                clinicianId: options.clinicianId,
                mockAudience: options.mockAudience,
                outputPath: options.outputPath
            },
            summary,
            checks
        });

        console.log(`Evidence written to ${options.outputPath}`);
        console.log(JSON.stringify(summary, null, 2));

        if (summary.requiredFailures > 0) {
            process.exitCode = 1;
        }
    } finally {
        if (startedServer) {
            await startedServer.close();
        }
    }
}

main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exit(1);
});
