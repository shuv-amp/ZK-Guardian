
import express, { Router } from 'express';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export const oauthRouter: Router = Router();

// Custom scheme redirects (zkguardian://) don't play nice with CSP.
// So we drop the headers here.
oauthRouter.use((_req, res, next) => {
    res.removeHeader('Content-Security-Policy');
    next();
});

// In-memory code store (for demo purposes)
const authCodes = new Map<string, { patient?: string, practitioner?: string, scopes: string }>();

// 1. Authorization Page
// Where the user picks their role and says "let me in".
oauthRouter.get('/authorize', (req, res) => {
    const { client_id, redirect_uri, state, scope } = req.query;

    if (!client_id || !redirect_uri || !state) {
        return res.status(400).send('Missing required parameters');
    }

    // Basic HTML login form. Nothing fancy, just gets the job done.
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
        </style>
    </head>
    <body>
        <div class="card">
            <h1>ZK Guardian Login</h1>
            
            <form action="/oauth/authorize-submit" method="POST">
                <input type="hidden" name="client_id" value="${client_id}">
                <input type="hidden" name="redirect_uri" value="${redirect_uri}">
                <input type="hidden" name="state" value="${state}">
                <input type="hidden" name="scope" value="${scope || ''}">
                
                <div class="section">
                    <h2>Login as Patient</h2>
                    <select name="patient_id">
                        <option value="53783066">Sagar Thapa</option>
                        <option value="53783073">Anisha Gurung</option>
                        <option value="53783083">Bikash Sharma</option>
                        <option value="53783097">Priya Adhikari</option>
                    </select>
                    <button type="submit" name="role" value="patient" class="btn btn-patient">Login as Patient</button>
                </div>
            </form>
            
            <div class="divider">— or —</div>
            
            <form action="/oauth/authorize-submit" method="POST">
                <input type="hidden" name="client_id" value="${client_id}">
                <input type="hidden" name="redirect_uri" value="${redirect_uri}">
                <input type="hidden" name="state" value="${state}">
                <input type="hidden" name="scope" value="${scope || ''}">
                
                <div class="section">
                    <h2>Login as Clinician</h2>
                    <select name="clinician_id">
                        <option value="practitioner-rajesh">Dr. Rajesh Shrestha</option>
                        <option value="practitioner-sunita">Dr. Sunita Maharjan</option>
                        <option value="practitioner-arun">Dr. Arun Rai</option>
                    </select>
                    <button type="submit" name="role" value="clinician" class="btn btn-clinician">Login as Clinician</button>
                </div>
            </form>
        </div>
    </body>
    </html>
    `;

    res.send(html);
});

// 2. Process Login
// Values come from the form above.
oauthRouter.post('/authorize-submit', express.urlencoded({ extended: true }), (req, res) => {
    console.log('[OAuth] POST /authorize-submit received');
    const { redirect_uri, state, role, scope, patient_id, clinician_id } = req.body;
    console.log('[OAuth] Body:', { redirect_uri, state, role, scope, patient_id, clinician_id });

    // Generate Auth Code
    const code = Math.random().toString(36).substring(7);

    // Store session details using selected user IDs from form
    authCodes.set(code, {
        patient: role === 'patient' ? (patient_id || '123') : undefined,
        practitioner: role === 'clinician' ? (clinician_id || 'practitioner-456') : undefined,
        scopes: scope
    });

    try {
        // Redirect back to App
        const target = new URL(redirect_uri);
        target.searchParams.set('code', code);
        target.searchParams.set('state', state);

        console.log('[OAuth] Redirecting to:', target.toString());
        res.redirect(target.toString());
    } catch (err) {
        console.error('[OAuth] Redirect Error:', err);
        res.status(500).send('Invalid Redirect URI');
    }
});

// 3. Token Exchange
// Trade valid code for a fresh token.
oauthRouter.post('/token', express.urlencoded({ extended: true }), (req, res) => {
    const { code, grant_type } = req.body;

    if (grant_type !== 'authorization_code') {
        return res.status(400).json({ error: 'unsupported_grant_type' });
    }

    const session = authCodes.get(code as string);
    if (!session) {
        return res.status(400).json({ error: 'invalid_grant' });
    }

    // Clean up code (one-time use)
    authCodes.delete(code as string);

    // Create JWT
    // In a real app, sign with a real secret
    const token = jwt.sign({
        sub: session.patient || session.practitioner,
        patient: session.patient,
        practitioner: session.practitioner,
        scope: session.scopes,
        iss: env.SMART_ISSUER // 'http://192.168.31.173:3000'
    }, env.GATEWAY_PRIVATE_KEY || 'dev-secret', { expiresIn: '1h' });

    res.json({
        access_token: token,
        token_type: 'Bearer',
        expires_in: 3600,
        scope: session.scopes,
        patient: session.patient, // FHIR context
        practitioner: session.practitioner, // FHIR context for clinician
        need_patient_banner: true,
        smart_style_url: "http://fhir-registry.smarthealthit.org/structure"
    });
});
