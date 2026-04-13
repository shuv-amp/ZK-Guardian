# Staging Validation Runbook

This runbook is the release-checkpoint for the secure core. It is meant to be executed against a staging deployment that matches production topology as closely as possible: external SMART/OIDC, real Postgres and Redis, real circuit artifacts, real registry addresses, and native mobile builds.

## Scope

This validation covers:

- Gateway startup and readiness
- External SMART/OIDC login and token enforcement
- Consent approval over `/ws/consent`
- Audited patient record access
- Break-glass initiation, status, and closure
- Native mobile production configuration and transport safety

This runbook does not certify multi-tenant behavior, dashboard polish, or deferred batch-audit paths.

## Exit Criteria

Staging passes only if all of the following are true:

- Gateway `GET /health/live`, `GET /health`, and `GET /health/ready` succeed with production-critical services connected.
- `/.well-known/smart-configuration` advertises the external SMART/OIDC endpoints, not local `/oauth/*` routes.
- Patient and clinician users can authenticate through the external SMART/OIDC provider.
- Revoked or inactive tokens are rejected by the gateway.
- Patient consent approval works over `/ws/consent` with a bearer token in the connection headers.
- A successful clinician access is visible in patient audit history.
- Break-glass works only for authenticated practitioners, respects patient preferences, and can be closed cleanly.
- Mobile production builds require HTTPS and WSS endpoints, a matching `TLS_PIN_MAP`, and no dev-only direct login path.

Any failure in the sections marked `Stop Ship` is a release blocker.

## Required Inputs

Prepare these inputs before you start:

- `GATEWAY_URL` for the staging gateway, for example `https://gateway-staging.example.com`
- `WS_URL` for the consent socket, for example `wss://gateway-staging.example.com/ws/consent`
- One patient test account at the external SMART/OIDC provider
- One clinician test account at the external SMART/OIDC provider
- One patient ID that is present in staging FHIR data
- One clinician ID that is present in token claims and recognized by the gateway
- Staging mobile build configured with the staging gateway host and real TLS pins
- Access to staging logs for gateway, Postgres, Redis, and the external IdP

## Validation Helper

The repo includes a helper that executes the public checks automatically and records evidence to `.artifacts/staging-validation/latest.json`.

Public-surface validation:

```bash
BASE_URL="https://gateway-staging.example.com" \
pnpm --filter gateway verify:staging
```

Extended validation with authenticated routes and consent socket auth:

```bash
BASE_URL="https://gateway-staging.example.com" \
WS_URL="wss://gateway-staging.example.com/ws/consent" \
PATIENT_ID="patient-123" \
PATIENT_ACCESS_TOKEN="..." \
CLINICIAN_ACCESS_TOKEN="..." \
REVOKED_ACCESS_TOKEN="..." \
pnpm --filter gateway verify:staging -- --strict
```

Use `pnpm --filter gateway verify:staging -- --help` to see all supported inputs.

## GitHub Staging Workflow

GitHub now has a `staging` environment and a manual workflow at `.github/workflows/staging-validation.yml`.

Set these GitHub environment values before running it:

- variable `STAGING_BASE_URL`
- variable `STAGING_WS_URL`
- variable `STAGING_PATIENT_ID`
- secret `STAGING_PATIENT_ACCESS_TOKEN`
- secret `STAGING_CLINICIAN_ACCESS_TOKEN`
- secret `STAGING_REVOKED_ACCESS_TOKEN`

Then run the `Staging Validation` workflow from GitHub Actions. It will execute the validator in strict mode and upload the evidence JSON as a workflow artifact.

## Local Mock External SMART Drill

Use this when you want a realistic external-auth rehearsal before a live staging run. The mock server issues signed JWTs, serves JWKS, enforces PKCE on the auth-code flow, and supports introspection plus revocation.

Fastest path:

```bash
pnpm gateway:rehearse:mock-smart
```

That runner expects local PostgreSQL and Redis, starts the mock issuer, starts the gateway with the external-auth overlay, runs the verifier against the live gateway, writes evidence to `.artifacts/mock-smart-rehearsal/latest.json`, and then cleans up both processes.

Start the mock issuer:

```bash
pnpm --filter gateway mock:smart-idp
```

Point the gateway at it with an external-auth env overlay:

```bash
SMART_AUTH_MODE=external
SMART_ISSUER=http://127.0.0.1:4010
SMART_AUTHORIZATION_ENDPOINT=http://127.0.0.1:4010/authorize
SMART_TOKEN_ENDPOINT=http://127.0.0.1:4010/token
SMART_INTROSPECTION_ENDPOINT=http://127.0.0.1:4010/introspect
SMART_REVOCATION_ENDPOINT=http://127.0.0.1:4010/revoke
SMART_JWKS_URI=http://127.0.0.1:4010/.well-known/jwks.json
SMART_CLIENT_ID=zk-guardian-gateway
SMART_CLIENT_SECRET=mock-smart-secret
SMART_AUDIENCE=http://localhost:8080/fhir
```

Then run the mock verifier:

```bash
pnpm --filter gateway verify:mock-smart
```

If the gateway is running with the overlay above, add its URLs to exercise the real gateway auth boundary too:

```bash
BASE_URL="http://127.0.0.1:3000" \
WS_URL="ws://127.0.0.1:3000/ws/consent" \
pnpm --filter gateway verify:mock-smart
```

The mock verifier writes evidence to `.artifacts/mock-smart-validation/latest.json`.

## Preflight

### Gateway Environment

Confirm the staging gateway is configured with production-safe values:

```bash
SMART_AUTH_MODE=external
ALLOW_DEV_BYPASS=false
ENABLE_SYNTHETIC_CONSENT=false
SMART_ISSUER=...
SMART_AUTHORIZATION_ENDPOINT=...
SMART_TOKEN_ENDPOINT=...
SMART_INTROSPECTION_ENDPOINT=...
SMART_REVOCATION_ENDPOINT=...
SMART_JWKS_URI=...
SMART_CLIENT_ID=...
SMART_CLIENT_SECRET=...
SMART_AUDIENCE=...
HAPI_FHIR_URL=...
POLYGON_AMOY_RPC=...
AUDIT_CONTRACT_ADDRESS=...
CONSENT_REVOCATION_REGISTRY_ADDRESS=...
CREDENTIAL_REGISTRY_ADDRESS=...
CIRCUIT_ARTIFACTS_DIR=...
CIRCUIT_WASM_SHA256=...
CIRCUIT_ZKEY_SHA256=...
CIRCUIT_VKEY_SHA256=...
```

Stop Ship:

- `SMART_AUTH_MODE` is not `external`
- `ALLOW_DEV_BYPASS=true`
- `ENABLE_SYNTHETIC_CONSENT=true`
- any external SMART/OIDC endpoint is missing
- any required circuit checksum is missing

### Data And Artifact State

Before testing:

- Apply all Prisma migrations to the staging database.
- Verify Redis is reachable from the gateway.
- Verify the canonical circuit artifact tree exists under `CIRCUIT_ARTIFACTS_DIR`.
- Verify the gateway starts successfully with checksum validation enabled.
- Verify the deployed registry and audit contract addresses match the staging environment you intend to validate.

## Step 1: Gateway Liveness And Readiness

Run:

```bash
curl -fsS "$GATEWAY_URL/health/live" | jq
curl -fsS "$GATEWAY_URL/health" | jq
curl -i "$GATEWAY_URL/health/ready"
```

Expected results:

- `/health/live` returns `200` and `alive: true`
- `/health` returns `200` with a top-level `status` of `healthy` or `degraded`
- `/health/ready` returns `200` with `ready: true`
- in staging production-mode validation, these services should be `connected` inside `/health` and `/health/ready`:
  - `database`
  - `zkProver`
  - `fhir`
  - `blockchain`
  - `auth`
  - `secrets`

Stop Ship:

- `/health/ready` returns `503`
- `auth` is disconnected
- `zkProver` is disconnected
- `secrets` is disconnected

## Step 2: SMART Discovery And External Auth Surface

Run:

```bash
curl -fsS "$GATEWAY_URL/.well-known/smart-configuration" | jq
```

Expected results:

- `issuer` matches the configured external SMART issuer
- `authorization_endpoint` matches `SMART_AUTHORIZATION_ENDPOINT`
- `token_endpoint` matches `SMART_TOKEN_ENDPOINT`
- `introspection_endpoint` matches `SMART_INTROSPECTION_ENDPOINT`
- `revocation_endpoint` matches `SMART_REVOCATION_ENDPOINT`
- `jwks_uri` matches `SMART_JWKS_URI`
- the response does not point production clients at gateway-local auth forms

Stop Ship:

- discovery points to local `/oauth/authorize` or `/oauth/token` in staging production mode
- `issuer` does not match the external IdP
- `jwks_uri` is missing or unreachable

## Step 3: Patient Login Smoke Test

Use the staging mobile build or a browser-based SMART client to complete login as the patient test user.

Capture:

- login start timestamp
- external IdP user used
- returned patient ID claim
- whether refresh token issuance is present if expected by the IdP policy

Then verify the patient token against a patient-only route:

```bash
curl -fsS \
  -H "Authorization: Bearer $PATIENT_ACCESS_TOKEN" \
  "$GATEWAY_URL/api/patient/preferences" | jq
```

Expected results:

- request returns `200`
- the response belongs to the token’s patient context
- no query-string token usage is required anywhere in the flow

## Step 4: Clinician Login Smoke Test

Use the staging mobile build or a browser-based SMART client to complete login as the clinician test user.

Then verify the clinician token against a practitioner-authorized route:

```bash
curl -fsS \
  -H "Authorization: Bearer $CLINICIAN_ACCESS_TOKEN" \
  "$GATEWAY_URL/api/break-glass/$PATIENT_ID/status" | jq
```

Expected results:

- request returns `200`
- the gateway recognizes the clinician as an authenticated practitioner
- the response shape includes `hasActiveSession`

## Step 5: Token Revocation Or Inactive Token Check

Invalidate one test access token using the external IdP’s normal revocation or session-ending mechanism, then retry a protected gateway route with that token.

Suggested check:

```bash
curl -i \
  -H "Authorization: Bearer $REVOKED_ACCESS_TOKEN" \
  "$GATEWAY_URL/api/patient/preferences"
```

Expected results:

- the gateway rejects the token
- the request does not succeed with stale local state
- gateway logs show the external introspection path was used

Stop Ship:

- revoked or inactive token still reaches protected data

## Step 6: Consent WebSocket Authentication

Open the consent socket as the patient using a bearer token in the connection headers. One workable example is `wscat`.

```bash
wscat -c "$WS_URL" -H "Authorization: Bearer $PATIENT_ACCESS_TOKEN"
```

Expected results:

- the socket connects successfully
- the first success message includes `type: "AUTH_SUCCESS"`
- authentication is driven from the bearer token, not `patientId` in the query string

Stop Ship:

- the socket accepts anonymous connections
- the socket requires a query-string token
- the socket trusts a caller-provided patient ID instead of token context

## Step 7: Consent Approval Flow

Trigger a consent-required access attempt for the patient from the clinician side. The exact trigger can be the mobile clinician flow or another client that exercises the normal access path.

Expected patient-side behavior:

- the connected patient socket receives a `CONSENT_REQUEST`
- the request carries a server-issued `requestId`

Approve the request from the patient side with a `CONSENT_RESPONSE`. The server currently accepts field-element values in hex or decimal during migration, but production clients should emit `0x`-prefixed hex strings.

Example message:

```json
{
  "type": "CONSENT_RESPONSE",
  "requestId": "<request-id>",
  "approved": true,
  "nullifier": "0x1234",
  "sessionNonce": "0x5678"
}
```

Expected results:

- the clinician-side access proceeds after approval
- the patient-side socket remains authenticated
- nullifier and session nonce are accepted as `0x` hex values

Stop Ship:

- consent approval depends on a dev bypass
- approval works only with nonstandard raw values that production clients do not send
- the flow falls back to synthetic consent in staging production mode

## Step 8: Consent REST Contract

Validate the REST consent surface independently of the live approval handshake.

Create a consent:

```bash
curl -fsS -X POST \
  -H "Authorization: Bearer $PATIENT_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  "$GATEWAY_URL/api/patient/$PATIENT_ID/consents" \
  -d '{
    "grantedTo": {
      "type": "Practitioner",
      "reference": "Practitioner/'"$CLINICIAN_ID"'",
      "displayName": "Staging Clinician"
    },
    "allowedCategories": ["http://loinc.org|55217-7"],
    "deniedCategories": [],
    "validPeriod": {
      "start": "2026-04-13T00:00:00.000Z",
      "end": "2026-05-13T00:00:00.000Z"
    },
    "purpose": "staging validation"
  }' | jq
```

List consents:

```bash
curl -fsS \
  -H "Authorization: Bearer $PATIENT_ACCESS_TOKEN" \
  "$GATEWAY_URL/api/patient/$PATIENT_ID/consents?status=all" | jq
```

Expected results:

- consent creation returns `201`
- consent listing returns the newly created consent
- patient access to another patient’s consent path is rejected

## Step 9: Audited Access Verification

After a successful clinician access, confirm the patient can see the access event.

Run:

```bash
curl -fsS \
  -H "Authorization: Bearer $PATIENT_ACCESS_TOKEN" \
  "$GATEWAY_URL/api/patient/$PATIENT_ID/access-history?includeBreakGlass=true" | jq
```

Expected results:

- the response includes a new access record for the clinician
- `summary.totalAccesses` increments
- if the access was not break-glass, `isBreakGlass` is `false`

Optional export check:

```bash
curl -I \
  -H "Authorization: Bearer $PATIENT_ACCESS_TOKEN" \
  "$GATEWAY_URL/api/patient/$PATIENT_ID/audit-report"
```

Expected results:

- audit report returns `200`
- content type is PDF

## Step 10: Break-Glass Preference Gate

First confirm the patient permits emergency access:

```bash
curl -fsS -X PUT \
  -H "Authorization: Bearer $PATIENT_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  "$GATEWAY_URL/api/patient/preferences" \
  -d '{
    "allowEmergencyAccess": true,
    "alertsForBreakGlass": true
  }' | jq
```

Expected results:

- update returns `200`
- `allowEmergencyAccess` is `true`

Then test the negative path by setting `allowEmergencyAccess` to `false` and confirming break-glass initiation is rejected with `BREAK_GLASS_DISABLED_BY_PATIENT`.

## Step 11: Break-Glass Initiation, Status, And Closure

Initiate break-glass as the clinician:

```bash
curl -fsS -X POST \
  -H "Authorization: Bearer $CLINICIAN_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  "$GATEWAY_URL/api/break-glass/$PATIENT_ID" \
  -d '{
    "reason": "LIFE_THREATENING_EMERGENCY",
    "justification": "Patient is unresponsive in triage and allergy data is needed immediately.",
    "clinicianSignature": "staging-clinician-signature",
    "witnessId": "staging-charge-nurse",
    "estimatedDuration": 60,
    "emergencyCode": 3,
    "emergencyThreshold": 2
  }' | jq
```

Check status:

```bash
curl -fsS \
  -H "Authorization: Bearer $CLINICIAN_ACCESS_TOKEN" \
  "$GATEWAY_URL/api/break-glass/$PATIENT_ID/status" | jq
```

Close the session:

```bash
curl -fsS -X POST \
  -H "Authorization: Bearer $CLINICIAN_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  "$GATEWAY_URL/api/break-glass/$PATIENT_ID/close" \
  -d '{
    "closureNotes": "Staging validation closeout",
    "accessedResources": ["AllergyIntolerance", "MedicationRequest"]
  }' | jq
```

Expected results:

- initiation returns `201` with `status: "ACTIVE"`
- status shows an active session for the clinician
- closure returns `200` with `status: "CLOSED"`
- patient audit history shows the break-glass access as break-glass

Stop Ship:

- non-practitioner tokens can initiate break-glass
- break-glass ignores patient emergency-access preferences
- sessions cannot be closed cleanly

## Step 12: Mobile Production Validation

Validate a real native staging build, not Expo web.

Confirm the build configuration:

- `GATEWAY_URL` uses `https://`
- `WS_URL` uses `wss://`
- `TLS_PIN_MAP` contains the staging gateway host
- `ENABLE_DEV_DIRECT_LOGIN=false`
- the runtime is native iOS or Android, not web

Expected app behavior:

- the app launches only when production config is complete
- SMART discovery is loaded from `$GATEWAY_URL/.well-known/smart-configuration`
- all API traffic goes through the secure fetch wrapper
- the app fails closed if TLS pins are missing or the native pinning module is unavailable

Stop Ship:

- a production build works with HTTP or WS cleartext endpoints
- direct gateway login forms are used in production instead of external SMART login
- release traffic succeeds without matching TLS pins

## Evidence To Capture

Keep these artifacts with the validation record:

- `/health`, `/health/ready`, and SMART discovery responses
- gateway log lines for auth validation and readiness
- external IdP evidence for successful patient and clinician logins
- one revoked-token rejection example
- one consent approval transcript showing `AUTH_SUCCESS` and `CONSENT_RESPONSE`
- one access-history response showing the audited access
- one break-glass create and close response
- one screenshot or recording of the native mobile staging flow

## Signoff

Record the following before release:

- gateway image or commit being validated
- mobile build number being validated
- staging environment name and date
- validator name
- pass or fail for each numbered step in this document
- blocker summary for any failed `Stop Ship` item
