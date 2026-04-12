import express, { Router } from 'express';
import { z } from 'zod';
import { SignJWT, importJWK } from 'jose';
import { randomUUID, createHash } from 'crypto';
import { env } from '../config/env.js';
import { getRedis } from '../db/redis.js';
import { logger } from '../lib/logger.js';
import { getSmartKeys } from '../lib/smartKeys.js';
import { revokeToken } from '../lib/tokenRevocation.js';
import { validateSmartToken } from '../middleware/smartAuth.js';

export const oauthRouter: Router = Router();

const AUTH_CODE_TTL_MS = 5 * 60 * 1000;
const ACCESS_TOKEN_TTL_SEC = 3600;

interface AuthCodeEntry {
    clientId: string;
    redirectUri: string;
    scope: string;
    patient?: string;
    practitioner?: string;
    codeChallenge: string;
    codeChallengeMethod: 'S256';
    expiresAt: number;
}

// In-memory code store (short-lived auth codes)
const authCodes = new Map<string, AuthCodeEntry>();
const AUTH_CODE_PREFIX = 'oauth:code:';

oauthRouter.use((_req, res, next) => {
    if (env.SMART_AUTH_MODE !== 'local') {
        return res.status(404).json({
            error: 'LOCAL_SMART_AUTH_DISABLED',
            message: 'Local SMART authorization endpoints are disabled'
        });
    }

    next();
});

// Custom scheme redirects (zkguardian://) don't play nice with CSP.
// So we drop the headers here.
oauthRouter.use((_req, res, next) => {
    res.removeHeader('Content-Security-Policy');
    next();
});

const authorizeQuerySchema = z.object({
    response_type: z.literal('code'),
    client_id: z.string().min(1),
    redirect_uri: z.string().url(),
    state: z.string().min(1),
    scope: z.string().optional().default(''),
    code_challenge: z.string().min(20),
    code_challenge_method: z.literal('S256').optional().default('S256'),
    role_hint: z.enum(['patient', 'clinician']).optional()
});

const authorizeBodySchema = z.object({
    client_id: z.string().min(1),
    redirect_uri: z.string().url(),
    state: z.string().min(1),
    scope: z.string().optional().default(''),
    code_challenge: z.string().min(20),
    code_challenge_method: z.literal('S256').optional().default('S256'),
    role: z.enum(['patient', 'clinician']),
    role_hint: z.enum(['patient', 'clinician']).optional(),
    patient_id: z.string().optional(),
    clinician_id: z.string().optional()
});

const tokenBodySchema = z.object({
    grant_type: z.literal('authorization_code'),
    code: z.string().min(1),
    redirect_uri: z.string().url(),
    client_id: z.string().min(1),
    code_verifier: z.string().min(32),
    client_secret: z.string().optional()
});

const introspectSchema = z.object({
    token: z.string().min(1)
});

const revokeSchema = z.object({
    token: z.string().min(1)
});

function base64UrlEncode(buffer: Buffer): string {
    return buffer
        .toString('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
}

function verifyPkce(codeVerifier: string, codeChallenge: string): boolean {
    const hashed = createHash('sha256').update(codeVerifier).digest();
    const expected = base64UrlEncode(hashed);
    return expected === codeChallenge;
}

function getIssuer(req: express.Request): string {
    return env.SMART_ISSUER || `${req.protocol}://${req.get('host')}`;
}

function isRedirectUriAllowed(redirectUri: string): boolean {
    if (!env.SMART_REDIRECT_URIS) {
        return true;
    }

    const allowed = env.SMART_REDIRECT_URIS.split(',').map(uri => uri.trim()).filter(Boolean);
    return allowed.includes(redirectUri);
}

function enforceClientId(clientId: string): void {
    if (env.SMART_CLIENT_ID && clientId !== env.SMART_CLIENT_ID) {
        throw new Error('Invalid client_id');
    }
}

function extractClientCredentials(req: express.Request): { clientId?: string; clientSecret?: string } {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Basic ')) {
        const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
        const [clientId, clientSecret] = decoded.split(':');
        return { clientId, clientSecret };
    }

    return {
        clientId: typeof req.body.client_id === 'string' ? req.body.client_id : undefined,
        clientSecret: typeof req.body.client_secret === 'string' ? req.body.client_secret : undefined
    };
}

function validateClientAuth(clientId: string, clientSecret?: string): void {
    if (env.NODE_ENV === 'production' && !env.SMART_CLIENT_ID) {
        if (!env.ALLOW_DEV_BYPASS) {
            throw new Error('SMART_CLIENT_ID required in production');
        }
        return;
    }

    enforceClientId(clientId);

    if (!env.SMART_CLIENT_SECRET) {
        return;
    }

    if (!clientSecret || clientSecret !== env.SMART_CLIENT_SECRET) {
        throw new Error('Invalid client_secret');
    }
}

async function storeAuthCode(code: string, entry: AuthCodeEntry): Promise<void> {
    try {
        const redis = getRedis();
        await redis.set(`${AUTH_CODE_PREFIX}${code}`, JSON.stringify(entry), 'PX', AUTH_CODE_TTL_MS);
        return;
    } catch (error) {
        logger.warn({ error }, 'Failed to store auth code in Redis, using memory fallback');
    }

    authCodes.set(code, entry);
}

async function loadAuthCode(code: string): Promise<AuthCodeEntry | null> {
    try {
        const redis = getRedis();
        const payload = await redis.get(`${AUTH_CODE_PREFIX}${code}`);
        if (!payload) {
            return null;
        }
        return JSON.parse(payload) as AuthCodeEntry;
    } catch (error) {
        logger.warn({ error }, 'Failed to load auth code from Redis, using memory fallback');
    }

    return authCodes.get(code) || null;
}

async function removeAuthCode(code: string): Promise<void> {
    try {
        const redis = getRedis();
        await redis.del(`${AUTH_CODE_PREFIX}${code}`);
    } catch (error) {
        logger.warn({ error }, 'Failed to delete auth code from Redis, using memory fallback');
    }

    authCodes.delete(code);
}

// 1. Authorization Page
// Where the user picks their role and says "let me in".
oauthRouter.get('/authorize', (req, res) => {
    if (env.NODE_ENV === 'production' && !env.ALLOW_DEV_BYPASS) {
        return res.status(404).send('Not found');
    }

    const parsed = authorizeQuerySchema.safeParse(req.query);
    if (!parsed.success) {
        return res.status(400).send('Missing or invalid parameters');
    }

    try {
        enforceClientId(parsed.data.client_id);
    } catch {
        return res.status(400).send('Invalid client_id');
    }

    if (!isRedirectUriAllowed(parsed.data.redirect_uri)) {
        return res.status(400).send('Invalid redirect_uri');
    }

    const { client_id, redirect_uri, state, scope, code_challenge, code_challenge_method, role_hint } = parsed.data;
    const roleHintInput = role_hint ? `<input type="hidden" name="role_hint" value="${role_hint}">` : '';
    const showPatientSection = role_hint !== 'clinician';
    const showClinicianSection = role_hint !== 'patient';

    const patientSection = `
            <form action="/oauth/authorize-submit" method="POST">
                <input type="hidden" name="client_id" value="${client_id}">
                <input type="hidden" name="redirect_uri" value="${redirect_uri}">
                <input type="hidden" name="state" value="${state}">
                <input type="hidden" name="scope" value="${scope}">
                <input type="hidden" name="code_challenge" value="${code_challenge}">
                <input type="hidden" name="code_challenge_method" value="${code_challenge_method}">
                ${roleHintInput}
                <div class="section">
                    <h2>Login as Patient</h2>
                    <select name="patient_id">
                        <option value="patient-riley">Riley Patient (Simulation)</option>
                        <option value="patient-demo-456">Riley DemoPatient</option>
                        <option value="patient-123">Alice TestPatient</option>
                        <option value="patient-124">Sagar Thapa</option>
                        <option value="patient-125">Anisha Gurung</option>
                    </select>
                    <button type="submit" name="role" value="patient" class="btn btn-patient">Login as Patient</button>
                </div>
            </form>
    `;

    const clinicianSection = `
            <form action="/oauth/authorize-submit" method="POST">
                <input type="hidden" name="client_id" value="${client_id}">
                <input type="hidden" name="redirect_uri" value="${redirect_uri}">
                <input type="hidden" name="state" value="${state}">
                <input type="hidden" name="scope" value="${scope}">
                <input type="hidden" name="code_challenge" value="${code_challenge}">
                <input type="hidden" name="code_challenge_method" value="${code_challenge_method}">
                ${roleHintInput}
                <div class="section">
                    <h2>Login as Clinician</h2>
                    <select name="clinician_id">
                        <option value="practitioner-joden">Dr. Joden Lee</option>
                        <option value="dr-demo-456">Dr. Jordan Lee</option>
                        <option value="practitioner-rajesh">Dr. Rajesh Shrestha</option>
                        <option value="practitioner-sunita">Dr. Sunita Maharjan</option>
                        <option value="practitioner-arun">Dr. Arun Rai</option>
                    </select>
                    <button type="submit" name="role" value="clinician" class="btn btn-clinician">Login as Clinician</button>
                </div>
            </form>
    `;

    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>ZK Guardian Login</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            body { font-family: -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background: #f0f2f5; margin: 0; }
            .card { background: white; padding: 2rem; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); width: 100%; max-width: 360px; }
            h1 { text-align: center; color: #1a1a1a; margin-bottom: 1rem; font-size: 1.5rem; }
            .section { margin-bottom: 1.5rem; padding: 1rem; background: #f9fafb; border-radius: 8px; }
            .section h2 { font-size: 0.9rem; color: #6b7280; margin: 0 0 0.75rem 0; }
            select { width: 100%; padding: 0.5rem; margin-bottom: 0.5rem; border: 1px solid #d1d5db; border-radius: 6px; font-size: 0.95rem; }
            .btn { display: block; width: 100%; padding: 0.75rem; margin: 0.5rem 0 0 0; border: none; border-radius: 6px; font-size: 1rem; font-weight: 500; cursor: pointer; transition: 0.2s; }
            .btn-patient { background: #3b82f6; color: white; }
            .btn-clinician { background: #10b981; color: white; }
            .btn:hover { opacity: 0.9; }
            .divider { text-align: center; color: #9ca3af; margin: 1rem 0; }
            .hint { margin: 0 0 1rem 0; font-size: 0.9rem; color: #4b5563; text-align: center; }
        </style>
    </head>
    <body>
        <div class="card">
            <h1>ZK Guardian Login</h1>
            ${role_hint ? `<p class="hint">Role requested from app: <strong>${role_hint}</strong></p>` : ''}
            ${showPatientSection ? patientSection : ''}
            ${showPatientSection && showClinicianSection ? '<div class="divider">— or —</div>' : ''}
            ${showClinicianSection ? clinicianSection : ''}
        </div>
    </body>
    </html>
    `;

    res.send(html);
});

// 2. Process Login
// Values come from the form above.
oauthRouter.post('/authorize-submit', express.urlencoded({ extended: true }), (req, res) => {
    if (env.NODE_ENV === 'production' && !env.ALLOW_DEV_BYPASS) {
        return res.status(404).send('Not found');
    }

    const parsed = authorizeBodySchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).send('Invalid authorization request');
    }

    try {
        enforceClientId(parsed.data.client_id);
    } catch {
        return res.status(400).send('Invalid client_id');
    }

    if (!isRedirectUriAllowed(parsed.data.redirect_uri)) {
        return res.status(400).send('Invalid redirect_uri');
    }

    const { redirect_uri, state, role, role_hint, scope, patient_id, clinician_id, client_id, code_challenge, code_challenge_method } = parsed.data;

    if (role_hint && role_hint !== role) {
        return res.status(400).send('Role mismatch with requested role_hint');
    }

    const code = randomUUID();

    const authEntry: AuthCodeEntry = {
        clientId: client_id,
        redirectUri: redirect_uri,
        scope,
        patient: role === 'patient' ? (patient_id || 'patient-123') : undefined,
        practitioner: role === 'clinician' ? (clinician_id || 'practitioner-456') : undefined,
        codeChallenge: code_challenge,
        codeChallengeMethod: code_challenge_method,
        expiresAt: Date.now() + AUTH_CODE_TTL_MS
    };

    void storeAuthCode(code, authEntry);

    // Development-only direct mode for deterministic mobile QA and local automation.
    if (env.NODE_ENV !== 'production' && req.get('x-dev-direct') === 'true') {
        return res.json({
            code,
            state,
            redirect_uri
        });
    }

    try {
        const target = new URL(redirect_uri);
        target.searchParams.set('code', code);
        target.searchParams.set('state', state);
        res.redirect(target.toString());
    } catch (err) {
        res.status(500).send('Invalid Redirect URI');
    }
});

// 3. Token Exchange
// Trade valid code for a fresh token.
oauthRouter.post('/token', express.urlencoded({ extended: true }), async (req, res) => {
    const parsed = tokenBodySchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: 'invalid_request' });
    }

    const { code, redirect_uri, code_verifier } = parsed.data;
    const { clientId, clientSecret } = extractClientCredentials(req);

    if (!isRedirectUriAllowed(redirect_uri)) {
        return res.status(400).json({ error: 'invalid_grant', error_description: 'Invalid redirect_uri' });
    }

    if (!clientId) {
        return res.status(401).json({ error: 'invalid_client' });
    }

    try {
        validateClientAuth(clientId, clientSecret);
    } catch (error: any) {
        return res.status(401).json({ error: 'invalid_client', error_description: error.message });
    }

    const session = await loadAuthCode(code);
    if (!session) {
        return res.status(400).json({ error: 'invalid_grant' });
    }

    if (session.expiresAt < Date.now()) {
        await removeAuthCode(code);
        return res.status(400).json({ error: 'invalid_grant', error_description: 'Authorization code expired' });
    }

    if (session.clientId !== clientId || session.redirectUri !== redirect_uri) {
        return res.status(400).json({ error: 'invalid_grant', error_description: 'Client mismatch' });
    }

    if (!verifyPkce(code_verifier, session.codeChallenge)) {
        return res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE verification failed' });
    }

    await removeAuthCode(code);

    const issuer = getIssuer(req);
    const audience = env.SMART_AUDIENCE || env.HAPI_FHIR_URL || issuer;
    const { privateJwk, kid } = await getSmartKeys();
    const privateKey = await importJWK(privateJwk, 'RS256');

    const now = Math.floor(Date.now() / 1000);
    const jti = randomUUID();

    const claims: Record<string, string> = {
        scope: session.scope
    };

    if (session.patient) {
        claims.patient = session.patient;
        claims.fhirUser = `Patient/${session.patient}`;
    }

    if (session.practitioner) {
        claims.practitioner = session.practitioner;
        claims.fhirUser = `Practitioner/${session.practitioner}`;
    }

    const accessToken = await new SignJWT(claims)
        .setProtectedHeader({ alg: 'RS256', kid })
        .setIssuedAt(now)
        .setIssuer(issuer)
        .setAudience(audience)
        .setExpirationTime(now + ACCESS_TOKEN_TTL_SEC)
        .setSubject(session.patient || session.practitioner || 'user')
        .setJti(jti)
        .sign(privateKey);

    res.json({
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: ACCESS_TOKEN_TTL_SEC,
        scope: session.scope,
        patient: session.patient,
        practitioner: session.practitioner,
        need_patient_banner: true,
        smart_style_url: 'http://fhir-registry.smarthealthit.org/structure'
    });
});

// 4. Token Introspection
oauthRouter.post('/introspect', express.urlencoded({ extended: true }), async (req, res) => {
    const parsed = introspectSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ active: false });
    }

    try {
        const smartContext = await validateSmartToken(parsed.data.token);
        res.json({
            active: true,
            sub: smartContext.sub,
            iss: smartContext.iss,
            exp: smartContext.exp,
            scope: smartContext.scope,
            patient: smartContext.patient,
            practitioner: smartContext.practitioner
        });
    } catch {
        res.json({ active: false });
    }
});

// 5. Token Revocation
oauthRouter.post('/revoke', express.urlencoded({ extended: true }), async (req, res) => {
    const parsed = revokeSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ revoked: false });
    }

    try {
        const smartContext = await validateSmartToken(parsed.data.token);
        if (smartContext.jti) {
            await revokeToken(smartContext.jti, smartContext.exp);
        }
    } catch {
        // Intentionally return 200 per RFC 7009
    }

    res.json({ revoked: true });
});
