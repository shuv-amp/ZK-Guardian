/**
 * SMART on FHIR OAuth2 Authentication Middleware
 * 
 * Validates JWT tokens according to SMART on FHIR specification.
 * Supports RS256 signature verification with JWKS.
 * 
 * Security Requirements (SECURITY_AUDIT_CHECKLIST.md BA1-BA5):
 * - BA1: SMART on FHIR OAuth 2.0 validated ✅
 * - BA2: JWT signature verification (RS256) ✅
 * - BA3: Token expiration enforced ✅
 * - BA4: Scope-based authorization ✅
 * - BA5: Patient can only access own data ✅
 */

import { Request, Response, NextFunction } from 'express';
import { createRemoteJWKSet, jwtVerify, JWTPayload, JWTVerifyResult } from 'jose';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { isTokenRevoked } from '../lib/tokenRevocation.js';

// Types

export interface SMARTContext {
    /** Subject identifier (user ID) */
    sub: string;
    /** Patient ID from launch context */
    patient?: string;
    /** Practitioner ID if clinician */
    practitioner?: string;
    /** Granted scopes */
    scope: string;
    /** Issuer URL */
    iss: string;
    /** Token expiration timestamp */
    exp: number;
    /** Token ID for revocation tracking */
    jti?: string;
    /** User's display name */
    name?: string;
    /** User's department (if available in claims) */
    department?: string;
    /** FHIR User reference */
    fhirUser?: string;
}

// JWKS Cache (Simple Map with TTL)

interface CachedJWKS {
    jwks: ReturnType<typeof createRemoteJWKSet>;
    expiresAt: number;
}

// Cache JWKS for 1 hour to reduce network calls
const jwksCache = new Map<string, CachedJWKS>();
const JWKS_CACHE_TTL = 60 * 60 * 1000; // 1 hour

/**
 * Get or create JWKS function for issuer
 */
function normalizeIssuerForJwks(issuer: string): string {
    try {
        const url = new URL(issuer);
        if (url.hostname === '10.0.2.2' || url.hostname === '10.0.3.2') {
            url.hostname = 'localhost';
            return url.toString().replace(/\/$/, '');
        }
        return issuer.replace(/\/$/, '');
    } catch {
        return issuer.replace(/\/$/, '');
    }
}

function getJWKS(issuer: string): ReturnType<typeof createRemoteJWKSet> {
    const jwksIssuer = normalizeIssuerForJwks(issuer);
    const cached = jwksCache.get(jwksIssuer);
    const now = Date.now();

    if (cached && cached.expiresAt > now) {
        return cached.jwks;
    }

    // Standard OIDC JWKS endpoint
    const jwksUrl = new URL('/.well-known/jwks.json', jwksIssuer);
    const jwks = createRemoteJWKSet(jwksUrl);

    jwksCache.set(jwksIssuer, {
        jwks,
        expiresAt: now + JWKS_CACHE_TTL
    });

    return jwks;
}

// Token Validation

/**
 * Validates a SMART on FHIR access token
 */
async function validateToken(token: string): Promise<SMARTContext> {
    // First, decode header to get issuer (without verification)
    const [headerB64] = token.split('.');
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString());

    if (header.alg !== 'RS256' && header.alg !== 'RS384' && header.alg !== 'RS512') {
        throw new TokenValidationError('UNSUPPORTED_ALGORITHM', `Algorithm ${header.alg} not supported. Use RS256/RS384/RS512.`);
    }

    // Decode payload to get issuer for JWKS lookup
    const [, payloadB64] = token.split('.');
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString()) as JWTPayload;

    if (!payload.iss) {
        throw new TokenValidationError('MISSING_ISSUER', 'Token missing issuer (iss) claim');
    }

    if (env.NODE_ENV === 'production' && !payload.iss.startsWith('https://')) {
        throw new TokenValidationError('INSECURE_ISSUER', 'Issuer must use HTTPS in production');
    }

    // Validate issuer against allowed list (if configured)
    if (env.SMART_ISSUER && payload.iss !== env.SMART_ISSUER) {
        throw new TokenValidationError('INVALID_ISSUER', `Issuer ${payload.iss} not allowed`);
    }

    // Get JWKS and verify signature
    const jwks = getJWKS(payload.iss);

    let result: JWTVerifyResult;
    try {
        result = await jwtVerify(token, jwks, {
            issuer: payload.iss,
            audience: env.SMART_AUDIENCE || env.HAPI_FHIR_URL || undefined,
            clockTolerance: 30, // 30 second tolerance for clock skew
        });
    } catch (error: any) {
        if (error.code === 'ERR_JWT_EXPIRED') {
            throw new TokenValidationError('TOKEN_EXPIRED', 'Access token has expired');
        }
        if (error.code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED') {
            throw new TokenValidationError('INVALID_SIGNATURE', 'Token signature verification failed');
        }
        throw new TokenValidationError('VERIFICATION_FAILED', error.message);
    }

    const claims = result.payload;

    if (await isTokenRevoked(claims.jti as string | undefined)) {
        throw new TokenValidationError('TOKEN_REVOKED', 'Access token has been revoked');
    }

    // Validate required claims
    if (!claims.sub) {
        throw new TokenValidationError('MISSING_SUBJECT', 'Token missing subject (sub) claim');
    }

    // Build SMART context
    const smartContext: SMARTContext = {
        sub: claims.sub as string,
        patient: claims.patient as string | undefined,
        practitioner: claims.practitioner as string | undefined,
        scope: (claims.scope as string) || '',
        iss: claims.iss as string,
        exp: claims.exp as number,
        jti: claims.jti as string | undefined,
        name: claims.name as string | undefined,
        fhirUser: claims.fhirUser as string | undefined,
    };

    // Extract practitioner from fhirUser if not directly available
    if (!smartContext.practitioner && smartContext.fhirUser) {
        const match = smartContext.fhirUser.match(/Practitioner\/([^/]+)/);
        if (match) {
            smartContext.practitioner = match[1];
        }
    }

    return smartContext;
}

// Scope Validation

/**
 * Check if the token has required scope
 */
function hasScope(smartContext: SMARTContext, required: string): boolean {
    const scopes = smartContext.scope.split(' ');

    // Check exact match
    if (scopes.includes(required)) return true;

    // Check wildcard patterns (e.g., patient/*.read covers patient/Observation.read)
    const [resourcePart, actionPart] = required.split('.');
    const [namespace] = resourcePart.split('/');

    // Check for wildcard resource (e.g., patient/*.read)
    if (scopes.includes(`${namespace}/*.${actionPart}`)) return true;

    // Check for wildcard action (e.g., patient/Observation.*)
    if (scopes.includes(`${resourcePart}.*`)) return true;

    // Check for full wildcard (e.g., patient/*.*)
    if (scopes.includes(`${namespace}/*.*`)) return true;

    return false;
}

/**
 * Determine required scope based on request
 */
function getRequiredScope(req: Request): string | null {
    const method = req.method.toUpperCase();
    const pathParts = req.path.split('/').filter(Boolean);

    // Determine resource type from path
    const resourceType = pathParts[0];
    if (!resourceType) return null;

    // Skip non-clinical resources
    const clinicalResources = [
        'Patient', 'Observation', 'Condition', 'MedicationRequest',
        'DiagnosticReport', 'Encounter', 'Procedure', 'Immunization',
        'AllergyIntolerance', 'Consent', 'CarePlan', 'Goal'
    ];
    if (!clinicalResources.includes(resourceType)) return null;

    // Map HTTP method to FHIR scope action
    const action = method === 'GET' || method === 'HEAD' ? 'read' : 'write';

    return `patient/${resourceType}.${action}`;
}

// Middleware

/**
 * Custom error class for token validation
 */
export class TokenValidationError extends Error {
    constructor(
        public readonly code: string,
        message: string
    ) {
        super(message);
        this.name = 'TokenValidationError';
    }
}

/**
 * SMART on FHIR Authentication Middleware
 * 
 * Validates Bearer token and populates req.smartContext
 */
export async function smartAuthMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    const authHeader = req.headers.authorization;

    // Check for Authorization header
    if (!authHeader) {
        res.status(401).json({
            error: 'MISSING_AUTHORIZATION',
            message: 'Authorization header required'
        });
        return;
    }

    // Check Bearer scheme
    if (!authHeader.startsWith('Bearer ')) {
        res.status(401).json({
            error: 'INVALID_AUTH_SCHEME',
            message: 'Authorization must use Bearer scheme'
        });
        return;
    }

    const token = authHeader.slice(7);

    try {
        // In development mode, allow bypass ONLY when explicitly enabled.
        // Synthetic Riley requests may use a bypass token, but revoked/invalid JWTs
        // must not silently pass authentication.
        const isFhirRequest = req.originalUrl.toLowerCase().startsWith('/fhir');
        const isRileyRequest = isFhirRequest &&
            (req.url.toLowerCase().includes('riley') || (req.query.patient as string)?.toLowerCase().includes('riley'));
        const isSyntheticBypassToken = token === 'dev-bypass';

        if (env.NODE_ENV !== 'production' && (env.ALLOW_DEV_BYPASS || (env.ENABLE_SYNTHETIC_CONSENT && isRileyRequest && isSyntheticBypassToken))) {
            logger.debug({ url: req.url }, 'SMART auth bypassed for synthetic/dev request');
            req.smartContext = {
                sub: 'dev-clinician',
                patient: 'patient-riley',
                practitioner: 'dr-demo-456',
                scope: 'patient/*.read patient/*.write user/*.read launch/patient',
                iss: env.SMART_ISSUER || `${req.protocol}://${req.get('host')}`,
                exp: Math.floor(Date.now() / 1000) + 3600,
            };
            return next();
        }

        // Validate token
        const smartContext = await validateToken(token);

        // Check scope for the requested resource
        const requiredScope = getRequiredScope(req);
        const acceptableScopes = requiredScope
            ? (smartContext.practitioner
                ? [requiredScope, requiredScope.replace(/^patient\//, 'user/')]
                : [requiredScope])
            : [];
        const hasRequiredScope = acceptableScopes.length === 0 || acceptableScopes.some((scope) => hasScope(smartContext, scope));

        if (!hasRequiredScope) {
            logger.warn({
                sub: smartContext.sub,
                required: acceptableScopes,
                granted: smartContext.scope
            }, 'Insufficient scope');

            res.status(403).json({
                error: 'INSUFFICIENT_SCOPE',
                message: `Required scope: ${acceptableScopes.join(' or ')}`,
                granted: smartContext.scope
            });
            return;
        }

        // Patient authorization check (BA5)
        // If accessing patient-specific resources, ensure patient matches
        const pathPatientId = extractPatientIdFromPath(req);
        if (pathPatientId && smartContext.patient && pathPatientId !== smartContext.patient) {
            // Check if user is a practitioner (allowed to access other patients)
            if (!smartContext.practitioner) {
                logger.warn({
                    sub: smartContext.sub,
                    requestedPatient: pathPatientId,
                    tokenPatient: smartContext.patient
                }, 'Patient ID mismatch');

                res.status(403).json({
                    error: 'PATIENT_MISMATCH',
                    message: 'Cannot access data for another patient'
                });
                return;
            }
        }

        // Attach context to request
        req.smartContext = smartContext;

        logger.debug({
            sub: smartContext.sub,
            patient: smartContext.patient,
            practitioner: smartContext.practitioner
        }, 'SMART auth successful');

        next();

    } catch (error) {
        if (error instanceof TokenValidationError) {
            logger.warn({ code: error.code }, error.message);
            res.status(401).json({
                error: error.code,
                message: error.message
            });
            return;
        }

        logger.error({ error }, 'Unexpected auth error');
        res.status(500).json({
            error: 'AUTH_ERROR',
            message: 'Authentication failed'
        });
    }
}

export async function validateSmartToken(token: string): Promise<SMARTContext> {
    return validateToken(token);
}

/**
 * Extract patient ID from request path
 */
function extractPatientIdFromPath(req: Request): string | null {
    const path = req.path;

    // Direct patient access: /Patient/{id}
    const patientMatch = path.match(/^\/Patient\/([^/]+)/);
    if (patientMatch) return patientMatch[1];

    // Search with patient parameter: /Observation?patient=Patient/123
    const patientQuery = req.query.patient as string;
    if (patientQuery) {
        const match = patientQuery.match(/(?:Patient\/)?([^/]+)/);
        return match ? match[1] : patientQuery;
    }

    // Subject parameter (common in R4)
    const subjectQuery = req.query.subject as string;
    if (subjectQuery) {
        const match = subjectQuery.match(/(?:Patient\/)?([^/]+)/);
        return match ? match[1] : subjectQuery;
    }

    return null;
}

/**
 * Middleware factory for requiring specific scopes
 */
export function requireScope(...scopes: string[]) {
    return (req: Request, res: Response, next: NextFunction) => {
        if (!req.smartContext) {
            res.status(401).json({
                error: 'UNAUTHENTICATED',
                message: 'Authentication required'
            });
            return;
        }

        for (const scope of scopes) {
            if (!hasScope(req.smartContext, scope)) {
                res.status(403).json({
                    error: 'INSUFFICIENT_SCOPE',
                    message: `Required scope: ${scope}`,
                    granted: req.smartContext.scope
                });
                return;
            }
        }

        next();
    };
}
