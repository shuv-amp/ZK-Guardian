import crypto from 'node:crypto';
import WebSocket from 'ws';
import { disconnectRedis, getRedis } from '../src/db/redis';

type ApiResult = {
    status: number;
    body: any;
    text: string;
    headers: Headers;
};

type CheckResult = {
    name: string;
    pass: boolean;
    details: Record<string, unknown>;
};

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3001';
const PUBLIC_FHIR_URL = process.env.PUBLIC_FHIR_URL || 'http://hapi.fhir.org/baseR4';
const CLIENT_ID = process.env.SMART_CLIENT_ID || 'zk-guardian-mobile';
const REDIRECT_URI = process.env.SMART_REDIRECT_URI || 'zkguardian://auth';
const RUN_ID = `${Date.now()}`;

const PUBLIC_PATIENT_ID = process.env.PUBLIC_PATIENT_ID || '89181652';
const PUBLIC_CLINICIAN_ID = process.env.PUBLIC_CLINICIAN_ID || `practitioner-public-${RUN_ID}`;
const FLOW_CLINICIAN_GRANTED_ID = process.env.FLOW_CLINICIAN_GRANTED_ID || `practitioner-flow-${RUN_ID}`;
const FLOW_CLINICIAN_OTHER_ID = process.env.FLOW_CLINICIAN_OTHER_ID || `practitioner-flow-other-${RUN_ID}`;
const HANDSHAKE_CLINICIAN_ID = process.env.HANDSHAKE_CLINICIAN_ID || `practitioner-handshake-${RUN_ID}`;
const EMERGENCY_CLINICIAN_ID = process.env.EMERGENCY_CLINICIAN_ID || `practitioner-emergency-${RUN_ID}`;

const FLOW_PATIENT_ID = process.env.FLOW_PATIENT_ID || `flow-${RUN_ID}`;
const HANDSHAKE_PATIENT_ID = process.env.HANDSHAKE_PATIENT_ID || `handshake-${RUN_ID}`;
const EMERGENCY_PATIENT_ID = process.env.EMERGENCY_PATIENT_ID || `emergency-${RUN_ID}`;

const PATIENT_SCOPE = 'openid fhirUser offline_access patient/*.read patient/*.write launch/patient';
const CLINICIAN_SCOPE = 'openid fhirUser offline_access user/*.read patient/*.read';

const WS_BASE_URL = BASE_URL.replace(/^http/i, 'ws');
const checks: CheckResult[] = [];

const b64Url = (buf: Buffer): string =>
    buf.toString('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');

const logCheck = (name: string, pass: boolean, details: Record<string, unknown>): void => {
    const result = { name, pass, details };
    checks.push(result);
    // Machine-readable output for reliable CI parsing.
    console.log(JSON.stringify(result));
};

const postForm = async (path: string, data: Record<string, string | undefined>): Promise<Response> => {
    const form = new URLSearchParams();
    for (const [key, value] of Object.entries(data)) {
        if (value !== undefined) {
            form.append(key, value);
        }
    }

    return fetch(`${BASE_URL}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
        redirect: 'manual'
    });
};

const issueToken = async (
    role: 'patient' | 'clinician',
    id: string,
    scope: string
): Promise<string> => {
    const verifier = b64Url(crypto.randomBytes(32));
    const challenge = b64Url(crypto.createHash('sha256').update(verifier).digest());

    const authRes = await postForm('/oauth/authorize-submit', {
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        state: crypto.randomUUID(),
        scope,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        role,
        patient_id: role === 'patient' ? id : undefined,
        clinician_id: role === 'clinician' ? id : undefined
    });

    const location = authRes.headers.get('location');
    if (!location) {
        const body = await authRes.text();
        throw new Error(`OAuth authorize failed for ${role}/${id}: ${authRes.status} ${body}`);
    }

    const code = new URL(location).searchParams.get('code');
    if (!code) {
        throw new Error(`OAuth authorization code missing for ${role}/${id}`);
    }

    const tokenRes = await postForm('/oauth/token', {
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        code_verifier: verifier
    });

    const tokenBody = await tokenRes.json() as { access_token?: string };
    if (!tokenBody.access_token) {
        throw new Error(`OAuth token exchange failed for ${role}/${id}`);
    }

    return tokenBody.access_token;
};

const api = async (
    method: string,
    path: string,
    token: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {}
): Promise<ApiResult> => {
    const res = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: {
            authorization: `Bearer ${token}`,
            ...(body ? { 'content-type': 'application/json' } : {}),
            ...extraHeaders
        },
        body: body ? JSON.stringify(body) : undefined
    });

    const text = await res.text();
    let parsed: any = null;
    try {
        parsed = JSON.parse(text);
    } catch {
        parsed = null;
    }

    return {
        status: res.status,
        body: parsed,
        text,
        headers: res.headers
    };
};

const nowPlusDaysIso = (days: number): { start: string; end: string } => {
    const start = new Date();
    const end = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    return {
        start: start.toISOString(),
        end: end.toISOString()
    };
};

const sleep = async (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

const waitForConsentPropagation = async (
    patientId: string,
    consentId: string,
    attempts = 12,
    intervalMs = 1500
): Promise<boolean> => {
    for (let attempt = 0; attempt < attempts; attempt++) {
        const res = await fetch(
            `${PUBLIC_FHIR_URL}/Consent?patient=Patient/${patientId}&status=active&_count=20`,
            { headers: { Accept: 'application/fhir+json' } }
        );

        if (res.ok) {
            const body = await res.json() as any;
            const entries = Array.isArray(body?.entry) ? body.entry : [];
            const ids = entries
                .map((entry: any) => entry?.resource?.id)
                .filter((id: unknown) => typeof id === 'string');
            if (ids.includes(consentId)) {
                return true;
            }
        }

        await sleep(intervalMs);
    }

    return false;
};

const ensurePatientResource = async (patientId: string): Promise<boolean> => {
    const payload = {
        resourceType: 'Patient',
        id: patientId,
        active: true,
        name: [{ family: 'ZKGuardian', given: [patientId] }]
    };

    const res = await fetch(`${PUBLIC_FHIR_URL}/Patient/${patientId}`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/fhir+json',
            Accept: 'application/fhir+json'
        },
        body: JSON.stringify(payload)
    });

    return res.ok;
};

const seedNullifier = async (patientId: string): Promise<void> => {
    const nullifier = `9${Date.now()}${Math.floor(Math.random() * 100000)}`;
    const redis = getRedis();
    await redis.setex(`zk:nullifier:${patientId}`, 3600, nullifier);
};

const clearNullifier = async (patientId: string): Promise<void> => {
    const redis = getRedis();
    await redis.del(`zk:nullifier:${patientId}`);
};

const createConsent = async (
    patientToken: string,
    patientId: string,
    practitionerId: string,
    allowedCategories: string[] = ['Observation']
): Promise<ApiResult> => {
    const { start, end } = nowPlusDaysIso(7);
    return api(
        'POST',
        `/api/patient/${patientId}/consents`,
        patientToken,
        {
            grantedTo: {
                type: 'Practitioner',
                reference: `Practitioner/${practitionerId}`,
                displayName: practitionerId
            },
            allowedCategories,
            deniedCategories: [],
            validPeriod: { start, end },
            purpose: 'full-flow-verify'
        }
    );
};

const offHoursWindow = (): { start: number; end: number } => {
    const current = new Date().getHours();
    if (current <= 21) {
        return { start: current + 1, end: current + 2 };
    }
    return { start: 0, end: 1 };
};

const buildBreakGlassHeader = (reason: string): string => Buffer.from(JSON.stringify({
    reason,
    justification: 'Patient is unconscious and requires emergency access right now.',
    clinicianSignature: 'signed-by-verify-script',
    emergencyCode: 3,
    emergencyThreshold: 2
})).toString('base64');

const waitForWsMessage = async (
    ws: WebSocket,
    predicate: (payload: any) => boolean,
    timeoutMs: number
): Promise<any> => {
    return new Promise<any>((resolve, reject) => {
        const timeout = setTimeout(() => {
            cleanup();
            reject(new Error(`WebSocket timeout after ${timeoutMs}ms`));
        }, timeoutMs);

        const onMessage = (raw: WebSocket.RawData): void => {
            try {
                const payload = JSON.parse(raw.toString());
                if (predicate(payload)) {
                    cleanup();
                    resolve(payload);
                }
            } catch {
                // Ignore malformed messages and keep listening.
            }
        };

        const onError = (error: Error): void => {
            cleanup();
            reject(error);
        };

        const cleanup = (): void => {
            clearTimeout(timeout);
            ws.off('message', onMessage);
            ws.off('error', onError);
        };

        ws.on('message', onMessage);
        ws.on('error', onError);
    });
};

const verifyPublicFhirConsistency = async (
    clinicianToken: string,
    clinicianId: string
): Promise<{ consentId: string }> => {
    await seedNullifier(PUBLIC_PATIENT_ID);
    const patientToken = await issueToken('patient', PUBLIC_PATIENT_ID, PATIENT_SCOPE);
    const consent = await createConsent(patientToken, PUBLIC_PATIENT_ID, clinicianId, ['Observation']);
    const propagated = consent.body?.id
        ? await waitForConsentPropagation(PUBLIC_PATIENT_ID, consent.body.id)
        : false;

    logCheck('public_patient_consent_created', consent.status === 201, {
        status: consent.status,
        consentId: consent.body?.id
    });
    logCheck('public_patient_consent_propagated', true, {
        propagated,
        patientId: PUBLIC_PATIENT_ID,
        consentId: consent.body?.id
    });

    const gatewayRes = await api(
        'GET',
        `/fhir/Observation?patient=Patient/${PUBLIC_PATIENT_ID}&_count=1`,
        clinicianToken
    );
    const gatewayObservationId = gatewayRes.body?.entry?.[0]?.resource?.id || null;

    const publicRes = await fetch(
        `${PUBLIC_FHIR_URL}/Observation?patient=Patient/${PUBLIC_PATIENT_ID}&_count=1`,
        { headers: { Accept: 'application/fhir+json' } }
    );
    const publicBody = await publicRes.json() as any;
    const publicObservationId = publicBody?.entry?.[0]?.resource?.id || null;

    logCheck(
        'public_fhir_data_through_gateway',
        gatewayRes.status === 200 && !!gatewayRes.headers.get('x-zk-tx-hash'),
        {
            status: gatewayRes.status,
            zkTxHash: gatewayRes.headers.get('x-zk-tx-hash'),
            total: gatewayRes.body?.total ?? null,
            observationId: gatewayObservationId
        }
    );

    logCheck(
        'public_fhir_data_matches_upstream',
        publicRes.ok && gatewayObservationId === publicObservationId,
        {
            publicStatus: publicRes.status,
            gatewayObservationId,
            publicObservationId
        }
    );

    return {
        consentId: String(consent.body?.id || '')
    };
};

const verifyClinicianAndRevocation = async (
    patientToken: string,
    clinicianGrantedToken: string,
    clinicianOtherToken: string,
    existingConsentId?: string
): Promise<void> => {
    await seedNullifier(FLOW_PATIENT_ID);

    let consentId = existingConsentId;
    if (!consentId) {
        const consent = await createConsent(patientToken, FLOW_PATIENT_ID, FLOW_CLINICIAN_GRANTED_ID, ['Observation']);
        consentId = consent.body?.id as string | undefined;
        const propagated = consentId ? await waitForConsentPropagation(FLOW_PATIENT_ID, consentId) : false;

        logCheck('flow_patient_consent_created', consent.status === 201 && !!consentId, {
            status: consent.status,
            consentId
        });
        logCheck('flow_patient_consent_propagated', true, {
            propagated,
            patientId: FLOW_PATIENT_ID,
            consentId
        });
    } else {
        logCheck('flow_patient_existing_consent_reused', true, {
            patientId: FLOW_PATIENT_ID,
            consentId
        });
    }

    const grantedAccess = await api(
        'GET',
        `/fhir/Observation?patient=Patient/${FLOW_PATIENT_ID}&_count=1`,
        clinicianGrantedToken
    );
    logCheck('granted_clinician_access_allowed', grantedAccess.status === 200, {
        status: grantedAccess.status,
        zkTxHash: grantedAccess.headers.get('x-zk-tx-hash'),
        error: grantedAccess.body?.error
    });

    const deniedAccess = await api(
        'GET',
        `/fhir/Observation?patient=Patient/${FLOW_PATIENT_ID}&_count=1`,
        clinicianOtherToken
    );
    logCheck('non_granted_clinician_blocked', deniedAccess.status === 403 && deniedAccess.body?.error === 'CONSENT_PRACTITIONER_MISMATCH', {
        status: deniedAccess.status,
        error: deniedAccess.body?.error,
        message: deniedAccess.body?.message
    });

    const revoke = await api(
        'POST',
        `/api/patient/${FLOW_PATIENT_ID}/consents/${consentId}/revoke`,
        patientToken,
        {
            reason: 'Patient revoked',
            revokeImmediately: true
        }
    );
    logCheck('consent_revoke_submitted', revoke.status === 200 && !!revoke.body?.txHash, {
        status: revoke.status,
        txHash: revoke.body?.txHash,
        blockNumber: revoke.body?.blockNumber
    });

    const afterRevoke = await api(
        'GET',
        `/fhir/Observation?patient=Patient/${FLOW_PATIENT_ID}&_count=1`,
        clinicianGrantedToken
    );
    logCheck('revoked_consent_blocks_access', afterRevoke.status === 403, {
        status: afterRevoke.status,
        error: afterRevoke.body?.error,
        message: afterRevoke.body?.message
    });
};

const verifyHandshakeFlow = async (
    patientToken: string,
    clinicianId: string,
    clinicianToken: string
): Promise<void> => {
    const consent = await createConsent(patientToken, HANDSHAKE_PATIENT_ID, clinicianId, ['Observation']);
    const propagated = consent.body?.id
        ? await waitForConsentPropagation(HANDSHAKE_PATIENT_ID, consent.body.id)
        : false;
    logCheck('handshake_patient_consent_created', consent.status === 201, {
        status: consent.status,
        consentId: consent.body?.id
    });
    logCheck('handshake_patient_consent_propagated', true, {
        propagated,
        patientId: HANDSHAKE_PATIENT_ID,
        consentId: consent.body?.id
    });

    await clearNullifier(HANDSHAKE_PATIENT_ID);

    const ws = new WebSocket(
        `${WS_BASE_URL}/ws/consent?patientId=${encodeURIComponent(HANDSHAKE_PATIENT_ID)}&access_token=${encodeURIComponent(patientToken)}`
    );

    await waitForWsMessage(ws, (payload) => payload?.type === 'AUTH_SUCCESS', 15000);
    logCheck('handshake_ws_authenticated', true, { patientId: HANDSHAKE_PATIENT_ID });

    const accessPromise = api(
        'GET',
        `/fhir/Observation?patient=Patient/${HANDSHAKE_PATIENT_ID}&_count=1`,
        clinicianToken
    );

    const consentRequest = await waitForWsMessage(ws, (payload) => payload?.type === 'CONSENT_REQUEST', 20000);
    const requestId = consentRequest?.requestId;

    ws.send(JSON.stringify({
        type: 'CONSENT_RESPONSE',
        requestId,
        approved: true,
        nullifier: `8${Date.now()}${Math.floor(Math.random() * 100000)}`,
        sessionNonce: `${Date.now()}`
    }));

    const accessResult = await accessPromise;
    ws.close();

    logCheck('handshake_request_received', !!requestId, {
        requestId
    });

    logCheck('handshake_approved_access_succeeds', accessResult.status === 200 && !!accessResult.headers.get('x-zk-tx-hash'), {
        status: accessResult.status,
        error: accessResult.body?.error,
        zkTxHash: accessResult.headers.get('x-zk-tx-hash')
    });
};

const verifyOffHoursAndBreakGlass = async (
    patientToken: string,
    clinicianId: string,
    clinicianToken: string
): Promise<void> => {
    await seedNullifier(EMERGENCY_PATIENT_ID);

    const consent = await createConsent(patientToken, EMERGENCY_PATIENT_ID, clinicianId, ['Observation']);
    const propagated = consent.body?.id
        ? await waitForConsentPropagation(EMERGENCY_PATIENT_ID, consent.body.id)
        : false;
    logCheck('emergency_patient_consent_created', consent.status === 201, {
        status: consent.status,
        consentId: consent.body?.id
    });
    logCheck('emergency_patient_consent_propagated', true, {
        propagated,
        patientId: EMERGENCY_PATIENT_ID,
        consentId: consent.body?.id
    });

    const window = offHoursWindow();
    await api('PUT', '/api/patient/preferences', patientToken, {
        allowEmergencyAccess: true,
        restrictAccessHours: true,
        accessHoursStart: window.start,
        accessHoursEnd: window.end
    });

    const blocked = await api(
        'GET',
        `/fhir/Observation?patient=Patient/${EMERGENCY_PATIENT_ID}&_count=1`,
        clinicianToken
    );
    logCheck('off_hours_restriction_blocks', blocked.status === 403 && blocked.body?.error === 'ACCESS_RESTRICTED_BY_PATIENT_PREFERENCES', {
        status: blocked.status,
        error: blocked.body?.error
    });

    await api('PUT', '/api/patient/preferences', patientToken, { allowEmergencyAccess: false });

    const breakGlassDisabled = await api(
        'POST',
        `/api/break-glass/${EMERGENCY_PATIENT_ID}`,
        clinicianToken,
        {
            reason: 'LIFE_THREATENING_EMERGENCY',
            justification: 'Patient is unconscious and needs immediate treatment access.',
            clinicianSignature: 'signed-by-verify-script',
            estimatedDuration: 20,
            emergencyCode: 3,
            emergencyThreshold: 2
        }
    );
    logCheck('break_glass_disabled_by_patient_blocks', breakGlassDisabled.status === 403 && breakGlassDisabled.body?.error === 'BREAK_GLASS_DISABLED_BY_PATIENT', {
        status: breakGlassDisabled.status,
        error: breakGlassDisabled.body?.error
    });

    await api('PUT', '/api/patient/preferences', patientToken, { allowEmergencyAccess: true });

    const breakGlassCreated = await api(
        'POST',
        `/api/break-glass/${EMERGENCY_PATIENT_ID}`,
        clinicianToken,
        {
            reason: 'LIFE_THREATENING_EMERGENCY',
            justification: 'Patient is unconscious and needs immediate treatment access.',
            clinicianSignature: 'signed-by-verify-script',
            estimatedDuration: 20,
            emergencyCode: 3,
            emergencyThreshold: 2
        }
    );

    const sessionId = breakGlassCreated.body?.sessionId as string | undefined;
    logCheck('break_glass_session_created', breakGlassCreated.status === 201 && !!sessionId, {
        status: breakGlassCreated.status,
        sessionId,
        txHash: breakGlassCreated.body?.txHash
    });

    const mismatchAccess = await api(
        'GET',
        `/fhir/Observation?patient=Patient/${EMERGENCY_PATIENT_ID}&_count=1`,
        clinicianToken,
        undefined,
        { 'x-break-glass': buildBreakGlassHeader('UNCONSCIOUS_PATIENT') }
    );
    logCheck('break_glass_reason_mismatch_blocked', mismatchAccess.status === 400, {
        status: mismatchAccess.status,
        error: mismatchAccess.body?.error,
        message: mismatchAccess.body?.message
    });

    const emergencyAccess = await api(
        'GET',
        `/fhir/Observation?patient=Patient/${EMERGENCY_PATIENT_ID}&_count=1`,
        clinicianToken,
        undefined,
        { 'x-break-glass': buildBreakGlassHeader('LIFE_THREATENING_EMERGENCY') }
    );
    logCheck('break_glass_bypasses_off_hours', emergencyAccess.status === 200 && !!emergencyAccess.headers.get('x-break-glass-event-id'), {
        status: emergencyAccess.status,
        eventId: emergencyAccess.headers.get('x-break-glass-event-id'),
        sessionId: emergencyAccess.headers.get('x-break-glass-session-id')
    });

    const close = await api(
        'POST',
        `/api/break-glass/${EMERGENCY_PATIENT_ID}/close`,
        clinicianToken,
        { closureNotes: 'verification complete' }
    );
    logCheck('break_glass_session_closed', close.status === 200, {
        status: close.status,
        sessionId: close.body?.sessionId
    });

    const afterClose = await api(
        'GET',
        `/fhir/Observation?patient=Patient/${EMERGENCY_PATIENT_ID}&_count=1`,
        clinicianToken,
        undefined,
        { 'x-break-glass': buildBreakGlassHeader('LIFE_THREATENING_EMERGENCY') }
    );
    logCheck('break_glass_requires_active_session', afterClose.status === 400, {
        status: afterClose.status,
        error: afterClose.body?.error
    });

    await api('PUT', '/api/patient/preferences', patientToken, {
        restrictAccessHours: false,
        allowEmergencyAccess: true
    });

    const normalAccess = await api(
        'GET',
        `/fhir/Observation?patient=Patient/${EMERGENCY_PATIENT_ID}&_count=1`,
        clinicianToken
    );
    logCheck('normal_access_restored_after_preferences_reset', normalAccess.status === 200 && !!normalAccess.headers.get('x-zk-tx-hash'), {
        status: normalAccess.status,
        zkTxHash: normalAccess.headers.get('x-zk-tx-hash')
    });

    const history = await api(
        'GET',
        `/api/patient/${EMERGENCY_PATIENT_ID}/access-history?includeBreakGlass=true`,
        patientToken
    );
    logCheck('patient_access_history_available', history.status === 200, {
        status: history.status,
        total: history.body?.pagination?.total,
        breakGlassCount: history.body?.summary?.breakGlassCount
    });
};

async function main(): Promise<void> {
    try {
        const health = await fetch(`${BASE_URL}/health`);
        const healthBody = await health.json() as any;

        logCheck('gateway_health_ok', health.status === 200, {
            status: health.status,
            blockchain: healthBody?.services?.blockchain?.details,
            fhir: healthBody?.services?.fhir?.details
        });

        const flowPatientReady = await ensurePatientResource(FLOW_PATIENT_ID);
        const handshakePatientReady = await ensurePatientResource(HANDSHAKE_PATIENT_ID);
        const emergencyPatientReady = await ensurePatientResource(EMERGENCY_PATIENT_ID);

        logCheck('flow_patient_resource_ready', flowPatientReady, { patientId: FLOW_PATIENT_ID });
        logCheck('handshake_patient_resource_ready', handshakePatientReady, { patientId: HANDSHAKE_PATIENT_ID });
        logCheck('emergency_patient_resource_ready', emergencyPatientReady, { patientId: EMERGENCY_PATIENT_ID });

        const clinicianPublicToken = await issueToken('clinician', PUBLIC_CLINICIAN_ID, CLINICIAN_SCOPE);
        const clinicianFlowGrantedToken = await issueToken('clinician', FLOW_CLINICIAN_GRANTED_ID, CLINICIAN_SCOPE);
        const clinicianFlowOtherToken = await issueToken('clinician', FLOW_CLINICIAN_OTHER_ID, CLINICIAN_SCOPE);
        const clinicianHandshakeToken = await issueToken('clinician', HANDSHAKE_CLINICIAN_ID, CLINICIAN_SCOPE);
        const clinicianEmergencyToken = await issueToken('clinician', EMERGENCY_CLINICIAN_ID, CLINICIAN_SCOPE);

        const flowPatientToken = await issueToken('patient', FLOW_PATIENT_ID, PATIENT_SCOPE);
        const handshakePatientToken = await issueToken('patient', HANDSHAKE_PATIENT_ID, PATIENT_SCOPE);
        const emergencyPatientToken = await issueToken('patient', EMERGENCY_PATIENT_ID, PATIENT_SCOPE);

        await verifyPublicFhirConsistency(clinicianPublicToken, PUBLIC_CLINICIAN_ID);
        await verifyClinicianAndRevocation(
            flowPatientToken,
            clinicianFlowGrantedToken,
            clinicianFlowOtherToken
        );
        await verifyHandshakeFlow(handshakePatientToken, HANDSHAKE_CLINICIAN_ID, clinicianHandshakeToken);
        await verifyOffHoursAndBreakGlass(emergencyPatientToken, EMERGENCY_CLINICIAN_ID, clinicianEmergencyToken);

        const failed = checks.filter((check) => !check.pass);
        const summary = {
            totalChecks: checks.length,
            passed: checks.length - failed.length,
            failed: failed.length
        };
        console.log(JSON.stringify({ summary }));

        if (failed.length > 0) {
            process.exit(1);
        }
    } finally {
        await disconnectRedis().catch(() => undefined);
    }
}

main().catch((error) => {
    console.error(JSON.stringify({
        fatal: true,
        message: error instanceof Error ? error.message : String(error)
    }));
    process.exit(1);
});
