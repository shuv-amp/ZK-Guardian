import crypto from 'crypto';

const base = 'http://localhost:3000';
const clientId = 'zk-guardian-mobile';
const redirectUri = 'zkguardian://auth';

function base64Url(buf) {
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function makePkce() {
  const verifier = base64Url(crypto.randomBytes(32));
  const challenge = base64Url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

async function postForm(path, params) {
  const body = new URLSearchParams(params);
  const res = await fetchWithTimeout(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    redirect: 'manual'
  });
  return res;
}

async function authCodeForRole(role, roleId) {
  const { verifier, challenge } = makePkce();
  const res = await postForm('/oauth/authorize-submit', {
    client_id: clientId,
    redirect_uri: redirectUri,
    state: crypto.randomUUID(),
    scope: 'openid fhirUser offline_access patient/*.read launch/patient',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    role,
    patient_id: role === 'patient' ? roleId : undefined,
    clinician_id: role === 'clinician' ? roleId : undefined
  });

  const location = res.headers.get('location');
  if (!location) {
    const text = await res.text();
    throw new Error(`Missing redirect for ${role}. Status ${res.status}. Body: ${text}`);
  }

  const url = new URL(location);
  const code = url.searchParams.get('code');
  if (!code) {
    throw new Error(`Missing code in redirect for ${role}`);
  }

  return { code, verifier };
}

async function exchangeToken(code, verifier) {
  const res = await postForm('/oauth/token', {
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: verifier
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${text}`);
  }

  return res.json();
}

async function apiGet(path, token) {
  const res = await fetchWithTimeout(`${base}${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function apiGetWithHeaders(path, token, extraHeaders) {
  const res = await fetchWithTimeout(`${base}${path}`, {
    headers: { Authorization: `Bearer ${token}`, ...extraHeaders }
  });
  return {
    status: res.status,
    body: await res.json().catch(() => ({})),
    breakGlassEventId: res.headers.get('x-break-glass-event-id')
  };
}

async function apiPut(path, token, body) {
  const res = await fetchWithTimeout(`${base}${path}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function apiPost(path, token, body) {
  const res = await fetchWithTimeout(`${base}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function fetchWithTimeout(url, options, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

function buildBreakGlassHeader() {
  const payload = {
    reason: 'LIFE_THREATENING_EMERGENCY',
    justification: 'Patient is unconscious and requires immediate access to records.',
    clinicianSignature: 'signed-by-demo-clinician',
    emergencyCode: 3,
    emergencyThreshold: 2
  };

  return Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64');
}

function logStep(label, result) {
  console.log(`\n${label}`);
  console.log(result);
}

async function run() {
  console.log('Health checks');
  const health = await fetch(`${base}/health`).then(r => r.status);
  console.log(`gateway /health: ${health}`);

  const patientId = process.env.PATIENT_ID || 'patient-123';
  const clinicianId = process.env.CLINICIAN_ID || 'practitioner-rajesh';

  const patientAuth = await authCodeForRole('patient', patientId);
  const patientToken = await exchangeToken(patientAuth.code, patientAuth.verifier);
  logStep('Patient token', { hasToken: !!patientToken.access_token, patient: patientToken.patient });

  const clinicianAuth = await authCodeForRole('clinician', clinicianId);
  const clinicianToken = await exchangeToken(clinicianAuth.code, clinicianAuth.verifier);
  logStep('Clinician token', { hasToken: !!clinicianToken.access_token, practitioner: clinicianToken.practitioner });

  try {
    const prefs = await apiGet('/api/patient/preferences', patientToken.access_token);
    logStep('Patient preferences (GET)', { status: prefs.status, allowEmergencyAccess: prefs.body.allowEmergencyAccess });
  } catch (error) {
    logStep('Patient preferences (GET)', { error: error.message });
  }

  try {
    const prefsUpdate = await apiPut('/api/patient/preferences', patientToken.access_token, {
      restrictAccessHours: true,
      accessHoursStart: 7,
      accessHoursEnd: 19,
      allowEmergencyAccess: true,
      alertsForBreakGlass: true
    });
    logStep('Patient preferences (PUT)', { status: prefsUpdate.status, restrictAccessHours: prefsUpdate.body.restrictAccessHours });
  } catch (error) {
    logStep('Patient preferences (PUT)', { error: error.message });
  }

  try {
    const consents = await apiGet(`/api/patient/${patientId}/consents`, patientToken.access_token);
    logStep('Patient consents (GET)', { status: consents.status, total: consents.body.pagination?.total ?? 0 });
  } catch (error) {
    logStep('Patient consents (GET)', { error: error.message });
  }

  try {
    const now = new Date();
    const end = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const payload = {
      grantedTo: {
        type: 'Practitioner',
        reference: `Practitioner/${clinicianId}`,
        displayName: 'Dr. Rajesh Shrestha'
      },
      allowedCategories: ['vitals', 'labs'],
      deniedCategories: [],
      validPeriod: {
        start: now.toISOString(),
        end: end.toISOString()
      },
      purpose: 'Care coordination'
    };

    let consentCreate;
    try {
      consentCreate = await apiPost(`/api/patient/${patientId}/consents`, patientToken.access_token, payload);
    } catch (error) {
      if (String(error.message).includes('aborted')) {
        consentCreate = await apiPost(`/api/patient/${patientId}/consents`, patientToken.access_token, payload);
      } else {
        throw error;
      }
    }

    logStep('Patient consent (POST)', { status: consentCreate.status, consentId: consentCreate.body.id });
  } catch (error) {
    logStep('Patient consent (POST)', { error: error.message });
  }

  let breakGlassHeader = buildBreakGlassHeader();

  try {
    const breakGlass = await apiPost(`/api/break-glass/${patientId}`, clinicianToken.access_token, {
      reason: 'LIFE_THREATENING_EMERGENCY',
      justification: 'Patient is unconscious and requires immediate access to records.',
      clinicianSignature: 'signed-by-demo-clinician',
      estimatedDuration: 60,
      emergencyCode: 3,
      emergencyThreshold: 2
    });
    logStep('Break-glass (POST)', {
      status: breakGlass.status,
      sessionId: breakGlass.body.sessionId,
      error: breakGlass.body.error,
      headerReady: !!breakGlassHeader
    });
    if (breakGlass.status !== 201 && breakGlass.status !== 409) {
      breakGlassHeader = undefined;
    }
  } catch (error) {
    logStep('Break-glass (POST)', { error: error.message });
  }

  try {
    const fhirAccess = breakGlassHeader
      ? await apiGetWithHeaders(`/fhir/Observation?patient=${patientId}`, clinicianToken.access_token, {
        'X-Break-Glass': breakGlassHeader
      })
      : await apiGet(`/fhir/Observation?patient=${patientId}`, clinicianToken.access_token);
    logStep('FHIR access (clinician)', {
      status: fhirAccess.status,
      breakGlassEventId: fhirAccess.breakGlassEventId,
      error: fhirAccess.body?.error,
      message: fhirAccess.body?.message
    });
  } catch (error) {
    logStep('FHIR access (clinician)', { error: error.message });
  }

  try {
    const breakGlassStatusClinician = await apiGet(`/api/break-glass/${patientId}/status`, clinicianToken.access_token);
    logStep('Break-glass status (clinician)', { status: breakGlassStatusClinician.status, hasActiveSession: breakGlassStatusClinician.body.hasActiveSession });
  } catch (error) {
    logStep('Break-glass status (clinician)', { error: error.message });
  }

  try {
    const breakGlassStatusPatient = await apiGet(`/api/break-glass/${patientId}/status`, patientToken.access_token);
    logStep('Break-glass status (patient)', { status: breakGlassStatusPatient.status, hasActiveSession: breakGlassStatusPatient.body.hasActiveSession });
  } catch (error) {
    logStep('Break-glass status (patient)', { error: error.message });
  }

  try {
    const accessHistory = await apiGet(`/api/patient/${patientId}/access-history?includeBreakGlass=true`, patientToken.access_token);
    logStep('Access history (patient)', { status: accessHistory.status, total: accessHistory.body.pagination?.total ?? 0 });
  } catch (error) {
    logStep('Access history (patient)', { error: error.message });
  }

  try {
    const alerts = await apiGet(`/api/patient/${patientId}/access-alerts`, patientToken.access_token);
    logStep('Access alerts (patient)', { status: alerts.status, total: alerts.body.alerts?.length ?? 0 });
  } catch (error) {
    logStep('Access alerts (patient)', { error: error.message });
  }

  try {
    const clinicianProofs = await apiGet(`/api/clinician/${clinicianId}/proofs`, clinicianToken.access_token);
    logStep('Clinician proofs', { status: clinicianProofs.status, total: clinicianProofs.body.pagination?.total ?? 0 });
  } catch (error) {
    logStep('Clinician proofs', { error: error.message });
  }
}

run().catch((error) => {
  console.error('Flow test failed:', error.message);
  process.exit(1);
});
