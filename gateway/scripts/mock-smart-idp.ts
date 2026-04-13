import http from 'node:http';
import process from 'node:process';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import express, { type Express, type Request, type Response } from 'express';
import { exportJWK, generateKeyPair, type JWK, type KeyLike, SignJWT } from 'jose';

type MockRole = 'patient' | 'clinician';

type MockAuthorizeRequest = {
    role: MockRole;
    subjectId: string;
    name: string;
    department?: string;
};

type AuthorizationCodeRecord = {
    code: string;
    clientId: string;
    redirectUri: string;
    scope: string;
    codeChallenge?: string;
    codeChallengeMethod?: string;
    audience: string;
    mockUser: MockAuthorizeRequest;
    expiresAt: number;
};

type TokenRecord = {
    token: string;
    tokenType: 'access_token' | 'refresh_token';
    active: boolean;
    clientId: string;
    scope: string;
    audience: string;
    issuer: string;
    subject: string;
    expiresAt: number;
    issuedAt: number;
    jti?: string;
    patient?: string;
    practitioner?: string;
    name?: string;
    department?: string;
    fhirUser?: string;
};

export type MockSmartIdpOptions = {
    host?: string;
    port?: number;
    issuer?: string;
    audience?: string;
    publicClientId?: string;
    confidentialClientId?: string;
    confidentialClientSecret?: string;
    tokenTtlSeconds?: number;
};

export type MockSmartIdpServer = {
    app: Express;
    server: http.Server;
    baseUrl: string;
    issuer: string;
    audience: string;
    publicClientId: string;
    confidentialClientId: string;
    confidentialClientSecret: string;
    close: () => Promise<void>;
};

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 4010;
const DEFAULT_AUDIENCE = 'http://localhost:8080/fhir';
const DEFAULT_PUBLIC_CLIENT_ID = 'zk-guardian-mobile';
const DEFAULT_CONFIDENTIAL_CLIENT_ID = 'zk-guardian-gateway';
const DEFAULT_CONFIDENTIAL_CLIENT_SECRET = 'mock-smart-secret';
const DEFAULT_TOKEN_TTL_SECONDS = 3600;
const AUTHORIZATION_CODE_TTL_MS = 5 * 60 * 1000;

function printHelp(): void {
    console.log(`Mock SMART/OIDC identity provider

Usage:
  pnpm --filter gateway mock:smart-idp -- [options]

Options:
  --host <host>                 Host to bind. Default: 127.0.0.1
  --port <port>                 Port to bind. Default: 4010
  --issuer <url>                Explicit issuer/base URL
  --audience <value>            Audience claim to issue
  --public-client-id <id>       Public OAuth client for auth code exchange
  --confidential-client-id <id> Confidential client for introspection/revocation
  --confidential-client-secret <secret>
                               Confidential client secret
  --help                        Show this help

Environment inputs:
  MOCK_SMART_HOST
  MOCK_SMART_PORT
  MOCK_SMART_ISSUER
  MOCK_SMART_AUDIENCE
  MOCK_SMART_PUBLIC_CLIENT_ID
  MOCK_SMART_CONFIDENTIAL_CLIENT_ID
  MOCK_SMART_CONFIDENTIAL_CLIENT_SECRET
`);
}

function normalizeUrl(value: string): string {
    return value.replace(/\/$/, '');
}

function parseNumber(value: string | undefined, fallback: number): number {
    if (!value) {
        return fallback;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function parseArgs(argv: string[]): MockSmartIdpOptions {
    let host = process.env.MOCK_SMART_HOST || DEFAULT_HOST;
    let port = parseNumber(process.env.MOCK_SMART_PORT, DEFAULT_PORT);
    let issuer = process.env.MOCK_SMART_ISSUER;
    let audience = process.env.MOCK_SMART_AUDIENCE || DEFAULT_AUDIENCE;
    let publicClientId = process.env.MOCK_SMART_PUBLIC_CLIENT_ID || DEFAULT_PUBLIC_CLIENT_ID;
    let confidentialClientId = process.env.MOCK_SMART_CONFIDENTIAL_CLIENT_ID || DEFAULT_CONFIDENTIAL_CLIENT_ID;
    let confidentialClientSecret = process.env.MOCK_SMART_CONFIDENTIAL_CLIENT_SECRET || DEFAULT_CONFIDENTIAL_CLIENT_SECRET;

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--help') {
            printHelp();
            process.exit(0);
        }
        if (arg === '--host') {
            host = argv[i + 1] || host;
            i += 1;
            continue;
        }
        if (arg === '--port') {
            port = parseNumber(argv[i + 1], port);
            i += 1;
            continue;
        }
        if (arg === '--issuer') {
            issuer = argv[i + 1] || issuer;
            i += 1;
            continue;
        }
        if (arg === '--audience') {
            audience = argv[i + 1] || audience;
            i += 1;
            continue;
        }
        if (arg === '--public-client-id') {
            publicClientId = argv[i + 1] || publicClientId;
            i += 1;
            continue;
        }
        if (arg === '--confidential-client-id') {
            confidentialClientId = argv[i + 1] || confidentialClientId;
            i += 1;
            continue;
        }
        if (arg === '--confidential-client-secret') {
            confidentialClientSecret = argv[i + 1] || confidentialClientSecret;
            i += 1;
            continue;
        }
    }

    return {
        host,
        port,
        issuer,
        audience,
        publicClientId,
        confidentialClientId,
        confidentialClientSecret
    };
}

function redirectWithParams(res: Response, redirectUri: string, params: Record<string, string | undefined>): void {
    const url = new URL(redirectUri);
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
            url.searchParams.set(key, value);
        }
    }
    res.redirect(url.toString());
}

function parseMockUser(source: URLSearchParams): MockAuthorizeRequest {
    const loginHint = source.get('login_hint');
    if (loginHint?.startsWith('patient:')) {
        const subjectId = loginHint.slice('patient:'.length);
        return {
            role: 'patient',
            subjectId,
            name: source.get('name') || `Mock Patient ${subjectId}`
        };
    }
    if (loginHint?.startsWith('clinician:')) {
        const subjectId = loginHint.slice('clinician:'.length);
        return {
            role: 'clinician',
            subjectId,
            name: source.get('name') || `Mock Clinician ${subjectId}`,
            department: source.get('department') || 'Emergency'
        };
    }

    const role = source.get('mock_role');
    const patientId = source.get('patient') || source.get('patient_id');
    const practitionerId = source.get('practitioner') || source.get('practitioner_id') || source.get('clinician_id');

    if (role === 'patient' && patientId) {
        return {
            role: 'patient',
            subjectId: patientId,
            name: source.get('name') || `Mock Patient ${patientId}`
        };
    }

    if (role === 'clinician' && practitionerId) {
        return {
            role: 'clinician',
            subjectId: practitionerId,
            name: source.get('name') || `Mock Clinician ${practitionerId}`,
            department: source.get('department') || 'Emergency'
        };
    }

    throw new Error('Missing mock user context. Use login_hint=patient:<id> or clinician:<id>, or supply mock_role with patient_id/clinician_id.');
}

function verifyPkce(codeChallenge: string | undefined, method: string | undefined, verifier: string | undefined): boolean {
    if (!codeChallenge) {
        return true;
    }
    if (!verifier) {
        return false;
    }
    if (!method || method === 'plain') {
        return verifier === codeChallenge;
    }
    if (method !== 'S256') {
        return false;
    }
    const digest = createHash('sha256').update(verifier).digest('base64url');
    return digest === codeChallenge;
}

function readConfidentialCredentials(req: Request): { clientId?: string; clientSecret?: string } {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Basic ')) {
        const decoded = Buffer.from(authHeader.slice('Basic '.length), 'base64').toString('utf8');
        const separatorIndex = decoded.indexOf(':');
        if (separatorIndex !== -1) {
            return {
                clientId: decoded.slice(0, separatorIndex),
                clientSecret: decoded.slice(separatorIndex + 1)
            };
        }
    }

    const body = req.body as Record<string, unknown> | undefined;
    return {
        clientId: typeof body?.client_id === 'string' ? body.client_id : undefined,
        clientSecret: typeof body?.client_secret === 'string' ? body.client_secret : undefined
    };
}

function buildDiscovery(issuer: string) {
    return {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        introspection_endpoint: `${issuer}/introspect`,
        revocation_endpoint: `${issuer}/revoke`,
        jwks_uri: `${issuer}/.well-known/jwks.json`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_methods_supported: [
            'none',
            'client_secret_basic',
            'client_secret_post'
        ],
        scopes_supported: [
            'launch',
            'launch/patient',
            'patient/*.read',
            'patient/*.write',
            'user/*.read',
            'user/*.write',
            'openid',
            'fhirUser',
            'profile',
            'offline_access'
        ],
        code_challenge_methods_supported: ['S256']
    };
}

export async function startMockSmartIdpServer(options: MockSmartIdpOptions = {}): Promise<MockSmartIdpServer> {
    const host = options.host || DEFAULT_HOST;
    const requestedPort = options.port ?? DEFAULT_PORT;
    const audience = options.audience || DEFAULT_AUDIENCE;
    const publicClientId = options.publicClientId || DEFAULT_PUBLIC_CLIENT_ID;
    const confidentialClientId = options.confidentialClientId || DEFAULT_CONFIDENTIAL_CLIENT_ID;
    const confidentialClientSecret = options.confidentialClientSecret || DEFAULT_CONFIDENTIAL_CLIENT_SECRET;
    const tokenTtlSeconds = options.tokenTtlSeconds || DEFAULT_TOKEN_TTL_SECONDS;

    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const publicJwk = await exportJWK(publicKey);
    const keyId = randomUUID();
    const jwk: JWK = {
        ...publicJwk,
        kid: keyId,
        alg: 'RS256',
        use: 'sig'
    };

    const app = express();
    const server = http.createServer(app);
    const authorizationCodes = new Map<string, AuthorizationCodeRecord>();
    const accessTokens = new Map<string, TokenRecord>();
    const refreshTokens = new Map<string, TokenRecord>();
    let issuer = options.issuer ? normalizeUrl(options.issuer) : '';

    const issueAccessToken = async (record: AuthorizationCodeRecord, clientId: string): Promise<{ accessToken: string; refreshToken: string; payload: TokenRecord }> => {
        const issuedAt = Math.floor(Date.now() / 1000);
        const expiresAt = issuedAt + tokenTtlSeconds;
        const jti = randomUUID();

        const baseClaims: Record<string, string> = {
            scope: record.scope,
            name: record.mockUser.name,
            fhirUser: record.mockUser.role === 'patient'
                ? `Patient/${record.mockUser.subjectId}`
                : `Practitioner/${record.mockUser.subjectId}`
        };

        if (record.mockUser.role === 'patient') {
            baseClaims.patient = record.mockUser.subjectId;
        } else {
            baseClaims.practitioner = record.mockUser.subjectId;
            if (record.mockUser.department) {
                baseClaims.department = record.mockUser.department;
            }
        }

        const accessToken = await new SignJWT(baseClaims)
            .setProtectedHeader({ alg: 'RS256', kid: keyId, typ: 'JWT' })
            .setIssuer(issuer)
            .setAudience(record.audience)
            .setSubject(`${record.mockUser.role}:${record.mockUser.subjectId}`)
            .setIssuedAt(issuedAt)
            .setExpirationTime(expiresAt)
            .setJti(jti)
            .sign(privateKey as KeyLike);

        const refreshToken = `refresh_${randomUUID()}`;
        const commonRecord = {
            clientId,
            scope: record.scope,
            audience: record.audience,
            issuer,
            subject: `${record.mockUser.role}:${record.mockUser.subjectId}`,
            expiresAt,
            issuedAt,
            name: record.mockUser.name,
            department: record.mockUser.department,
            fhirUser: record.mockUser.role === 'patient'
                ? `Patient/${record.mockUser.subjectId}`
                : `Practitioner/${record.mockUser.subjectId}`,
            patient: record.mockUser.role === 'patient' ? record.mockUser.subjectId : undefined,
            practitioner: record.mockUser.role === 'clinician' ? record.mockUser.subjectId : undefined
        };

        const accessRecord: TokenRecord = {
            token: accessToken,
            tokenType: 'access_token',
            active: true,
            jti,
            ...commonRecord
        };

        const refreshRecord: TokenRecord = {
            token: refreshToken,
            tokenType: 'refresh_token',
            active: true,
            ...commonRecord
        };

        accessTokens.set(accessToken, accessRecord);
        refreshTokens.set(refreshToken, refreshRecord);

        return {
            accessToken,
            refreshToken,
            payload: accessRecord
        };
    };

    app.disable('x-powered-by');
    app.use(express.urlencoded({ extended: false }));
    app.use(express.json());

    app.get('/health', (_req, res) => {
        res.json({
            status: 'ok',
            issuer,
            audience,
            publicClientId,
            confidentialClientId
        });
    });

    app.get('/.well-known/smart-configuration', (_req, res) => {
        res.json(buildDiscovery(issuer));
    });

    app.get('/.well-known/openid-configuration', (_req, res) => {
        res.json(buildDiscovery(issuer));
    });

    app.get('/.well-known/jwks.json', (_req, res) => {
        res.json({ keys: [jwk] });
    });

    app.get('/jwks.json', (_req, res) => {
        res.json({ keys: [jwk] });
    });

    const handleAuthorize = (req: Request, res: Response): void => {
        try {
            const params = new URLSearchParams();
            const source = req.method === 'GET'
                ? req.query
                : req.body as Record<string, string | undefined>;

            for (const [key, value] of Object.entries(source)) {
                if (typeof value === 'string') {
                    params.set(key, value);
                }
            }

            const clientId = params.get('client_id');
            const redirectUri = params.get('redirect_uri');
            const scope = params.get('scope') || '';
            const state = params.get('state') || undefined;
            const codeChallenge = params.get('code_challenge') || undefined;
            const codeChallengeMethod = params.get('code_challenge_method') || undefined;
            const requestedAudience = params.get('aud') || audience;

            if (!clientId) {
                res.status(400).json({ error: 'invalid_request', error_description: 'client_id is required' });
                return;
            }
            if (clientId !== publicClientId) {
                res.status(400).json({ error: 'unauthorized_client', error_description: `Unknown public client ${clientId}` });
                return;
            }
            if (!redirectUri) {
                res.status(400).json({ error: 'invalid_request', error_description: 'redirect_uri is required' });
                return;
            }

            const mockUser = parseMockUser(params);
            const code = randomUUID();

            authorizationCodes.set(code, {
                code,
                clientId,
                redirectUri,
                scope,
                codeChallenge,
                codeChallengeMethod,
                audience: requestedAudience,
                mockUser,
                expiresAt: Date.now() + AUTHORIZATION_CODE_TTL_MS
            });

            redirectWithParams(res, redirectUri, {
                code,
                state
            });
        } catch (error) {
            res.status(400).json({
                error: 'invalid_request',
                error_description: error instanceof Error ? error.message : String(error)
            });
        }
    };

    app.get('/authorize', handleAuthorize);
    app.post('/authorize', handleAuthorize);

    app.post('/token', async (req, res) => {
        const grantType = typeof req.body?.grant_type === 'string' ? req.body.grant_type : undefined;
        const clientId = typeof req.body?.client_id === 'string' ? req.body.client_id : undefined;

        if (clientId !== publicClientId) {
            res.status(401).json({ error: 'invalid_client', error_description: `Unknown public client ${clientId || ''}` });
            return;
        }

        if (grantType === 'authorization_code') {
            const code = typeof req.body?.code === 'string' ? req.body.code : undefined;
            const redirectUri = typeof req.body?.redirect_uri === 'string' ? req.body.redirect_uri : undefined;
            const codeVerifier = typeof req.body?.code_verifier === 'string' ? req.body.code_verifier : undefined;

            if (!code || !redirectUri) {
                res.status(400).json({ error: 'invalid_request', error_description: 'code and redirect_uri are required' });
                return;
            }

            const record = authorizationCodes.get(code);
            if (!record) {
                res.status(400).json({ error: 'invalid_grant', error_description: 'authorization code not found' });
                return;
            }
            if (record.expiresAt <= Date.now()) {
                authorizationCodes.delete(code);
                res.status(400).json({ error: 'invalid_grant', error_description: 'authorization code expired' });
                return;
            }
            if (record.redirectUri !== redirectUri) {
                res.status(400).json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' });
                return;
            }
            if (!verifyPkce(record.codeChallenge, record.codeChallengeMethod, codeVerifier)) {
                res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE verification failed' });
                return;
            }

            authorizationCodes.delete(code);
            const issued = await issueAccessToken(record, clientId);

            res.json({
                access_token: issued.accessToken,
                token_type: 'Bearer',
                expires_in: tokenTtlSeconds,
                scope: record.scope,
                refresh_token: issued.refreshToken,
                patient: issued.payload.patient,
                practitioner: issued.payload.practitioner,
                fhirUser: issued.payload.fhirUser
            });
            return;
        }

        if (grantType === 'refresh_token') {
            const refreshToken = typeof req.body?.refresh_token === 'string' ? req.body.refresh_token : undefined;
            if (!refreshToken) {
                res.status(400).json({ error: 'invalid_request', error_description: 'refresh_token is required' });
                return;
            }

            const record = refreshTokens.get(refreshToken);
            if (!record || !record.active || record.expiresAt <= Math.floor(Date.now() / 1000)) {
                res.status(400).json({ error: 'invalid_grant', error_description: 'refresh token inactive or expired' });
                return;
            }

            const authorizationRecord: AuthorizationCodeRecord = {
                code: randomUUID(),
                clientId,
                redirectUri: 'urn:refresh',
                scope: record.scope,
                audience: record.audience,
                mockUser: record.patient
                    ? {
                        role: 'patient',
                        subjectId: record.patient,
                        name: record.name || `Mock Patient ${record.patient}`
                    }
                    : {
                        role: 'clinician',
                        subjectId: record.practitioner || 'unknown-clinician',
                        name: record.name || 'Mock Clinician',
                        department: record.department
                    },
                expiresAt: Date.now() + AUTHORIZATION_CODE_TTL_MS
            };

            const issued = await issueAccessToken(authorizationRecord, clientId);
            res.json({
                access_token: issued.accessToken,
                token_type: 'Bearer',
                expires_in: tokenTtlSeconds,
                scope: authorizationRecord.scope,
                refresh_token: issued.refreshToken,
                patient: issued.payload.patient,
                practitioner: issued.payload.practitioner,
                fhirUser: issued.payload.fhirUser
            });
            return;
        }

        res.status(400).json({ error: 'unsupported_grant_type', error_description: `Unsupported grant type ${grantType || ''}` });
    });

    app.post('/introspect', (req, res) => {
        const { clientId, clientSecret } = readConfidentialCredentials(req);
        if (clientId !== confidentialClientId || clientSecret !== confidentialClientSecret) {
            res.status(401).json({ error: 'invalid_client' });
            return;
        }

        const token = typeof req.body?.token === 'string' ? req.body.token : undefined;
        if (!token) {
            res.status(400).json({ error: 'invalid_request', error_description: 'token is required' });
            return;
        }

        const record = accessTokens.get(token);
        const now = Math.floor(Date.now() / 1000);
        if (!record || !record.active || record.expiresAt <= now) {
            res.json({ active: false });
            return;
        }

        res.json({
            active: true,
            scope: record.scope,
            client_id: record.clientId,
            token_type: 'Bearer',
            exp: record.expiresAt,
            iat: record.issuedAt,
            sub: record.subject,
            aud: record.audience,
            iss: record.issuer,
            jti: record.jti,
            patient: record.patient,
            practitioner: record.practitioner,
            name: record.name,
            fhirUser: record.fhirUser
        });
    });

    app.post('/revoke', (req, res) => {
        const { clientId, clientSecret } = readConfidentialCredentials(req);
        if (clientId !== confidentialClientId || clientSecret !== confidentialClientSecret) {
            res.status(401).json({ error: 'invalid_client' });
            return;
        }

        const token = typeof req.body?.token === 'string' ? req.body.token : undefined;
        if (!token) {
            res.status(400).json({ error: 'invalid_request', error_description: 'token is required' });
            return;
        }

        const accessRecord = accessTokens.get(token);
        if (accessRecord) {
            accessRecord.active = false;
        }

        const refreshRecord = refreshTokens.get(token);
        if (refreshRecord) {
            refreshRecord.active = false;
        }

        res.status(200).send('');
    });

    app.get('/.mock/config', (_req, res) => {
        res.json({
            issuer,
            audience,
            publicClientId,
            confidentialClientId,
            confidentialClientSecret,
            gatewayEnv: {
                SMART_AUTH_MODE: 'external',
                SMART_ISSUER: issuer,
                SMART_AUTHORIZATION_ENDPOINT: `${issuer}/authorize`,
                SMART_TOKEN_ENDPOINT: `${issuer}/token`,
                SMART_INTROSPECTION_ENDPOINT: `${issuer}/introspect`,
                SMART_REVOCATION_ENDPOINT: `${issuer}/revoke`,
                SMART_JWKS_URI: `${issuer}/.well-known/jwks.json`,
                SMART_CLIENT_ID: confidentialClientId,
                SMART_CLIENT_SECRET: confidentialClientSecret,
                SMART_AUDIENCE: audience
            }
        });
    });

    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(requestedPort, host, () => {
            server.off('error', reject);
            resolve();
        });
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
        throw new Error('Failed to resolve mock SMART server address');
    }

    issuer = options.issuer ? normalizeUrl(options.issuer) : `http://${host}:${address.port}`;

    return {
        app,
        server,
        baseUrl: issuer,
        issuer,
        audience,
        publicClientId,
        confidentialClientId,
        confidentialClientSecret,
        close: async () => {
            await new Promise<void>((resolve, reject) => {
                server.close((error) => {
                    if (error) {
                        reject(error);
                        return;
                    }
                    resolve();
                });
            });
        }
    };
}

async function runCli(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    const mockServer = await startMockSmartIdpServer(options);

    console.log(JSON.stringify({
        status: 'listening',
        issuer: mockServer.issuer,
        audience: mockServer.audience,
        publicClientId: mockServer.publicClientId,
        confidentialClientId: mockServer.confidentialClientId,
        gatewayEnv: {
            SMART_AUTH_MODE: 'external',
            SMART_ISSUER: mockServer.issuer,
            SMART_AUTHORIZATION_ENDPOINT: `${mockServer.issuer}/authorize`,
            SMART_TOKEN_ENDPOINT: `${mockServer.issuer}/token`,
            SMART_INTROSPECTION_ENDPOINT: `${mockServer.issuer}/introspect`,
            SMART_REVOCATION_ENDPOINT: `${mockServer.issuer}/revoke`,
            SMART_JWKS_URI: `${mockServer.issuer}/.well-known/jwks.json`,
            SMART_CLIENT_ID: mockServer.confidentialClientId,
            SMART_CLIENT_SECRET: mockServer.confidentialClientSecret,
            SMART_AUDIENCE: mockServer.audience
        }
    }, null, 2));

    const shutdown = async (): Promise<void> => {
        await mockServer.close();
        process.exit(0);
    };

    process.on('SIGINT', () => {
        void shutdown();
    });
    process.on('SIGTERM', () => {
        void shutdown();
    });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    runCli().catch((error) => {
        console.error(error instanceof Error ? error.stack || error.message : String(error));
        process.exit(1);
    });
}
