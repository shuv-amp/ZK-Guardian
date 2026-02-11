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
    // If SMART_ISSUER is not set, dynamically determine it from the request headers
    // This ensures it works for localhost, 10.0.2.2 (Android), and other network configurations
    const protocol = req.protocol;
    const host = req.get('host');
    const issuer = env.SMART_ISSUER || `${protocol}://${host}`;

    res.json({
        authorization_endpoint: `${issuer}/oauth/authorize`,
        token_endpoint: `${issuer}/oauth/token`,
        introspection_endpoint: `${issuer}/oauth/introspect`,
        revocation_endpoint: `${issuer}/oauth/revoke`,
        jwks_uri: `${issuer}/.well-known/jwks.json`,
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
