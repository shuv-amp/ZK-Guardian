/**
 * SMART on FHIR Configuration Endpoint
 * 
 * Provides discovery information for SMART apps.
 * Must be served at /.well-known/smart-configuration
 */

import { Router } from 'express';
import { env } from '../config/env.js';
import { getSmartKeys } from '../lib/smartKeys.js';

export const smartConfigRouter: Router = Router();

smartConfigRouter.get('/jwks.json', async (_req, res) => {
    if (env.SMART_AUTH_MODE !== 'local') {
        return res.status(404).json({
            error: 'LOCAL_SMART_AUTH_DISABLED',
            message: 'JWKS is managed by the external authorization server'
        });
    }

    try {
        const { publicJwk, kid } = await getSmartKeys();

        res.json({
            keys: [
                {
                    ...publicJwk,
                    kid,
                    use: 'sig',
                    alg: 'RS256'
                }
            ]
        });
    } catch (error: any) {
        res.status(500).json({ error: 'JWKS_UNAVAILABLE', message: error.message });
    }
});

smartConfigRouter.get('/smart-configuration', (req, res) => {
    const protocol = req.protocol;
    const host = req.get('host');
    const issuer = env.SMART_ISSUER || `${protocol}://${host}`;
    const isExternalAuth = env.SMART_AUTH_MODE === 'external';

    const authorizationEndpoint = isExternalAuth
        ? env.SMART_AUTHORIZATION_ENDPOINT
        : `${issuer}/oauth/authorize`;
    const tokenEndpoint = isExternalAuth
        ? env.SMART_TOKEN_ENDPOINT
        : `${issuer}/oauth/token`;
    const introspectionEndpoint = isExternalAuth
        ? env.SMART_INTROSPECTION_ENDPOINT
        : `${issuer}/oauth/introspect`;
    const revocationEndpoint = isExternalAuth
        ? env.SMART_REVOCATION_ENDPOINT
        : `${issuer}/oauth/revoke`;
    const jwksUri = isExternalAuth
        ? env.SMART_JWKS_URI
        : `${issuer}/.well-known/jwks.json`;

    res.json({
        issuer,
        authorization_endpoint: authorizationEndpoint,
        token_endpoint: tokenEndpoint,
        introspection_endpoint: introspectionEndpoint,
        revocation_endpoint: revocationEndpoint,
        jwks_uri: jwksUri,
        token_endpoint_auth_methods_supported: [
            'none',
            'client_secret_basic',
            'client_secret_post',
            'private_key_jwt'
        ],
        grant_types_supported: [
            'authorization_code',
            'refresh_token',
            'client_credentials'
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
        response_types_supported: ['code'],
        capabilities: [
            'launch-ehr',
            'launch-standalone',
            'client-public',
            'client-confidential-symmetric',
            'context-ehr-patient',
            'context-standalone-patient',
            'permission-patient',
            'permission-user'
        ],
        code_challenge_methods_supported: ['S256']
    });
});
