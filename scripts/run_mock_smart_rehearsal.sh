#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARTIFACT_DIR="${REPO_ROOT}/.artifacts/mock-smart-rehearsal"
MOCK_LOG="${ARTIFACT_DIR}/mock-smart-idp.log"
GATEWAY_LOG="${ARTIFACT_DIR}/gateway.log"

PORT="${PORT:-3000}"
MOCK_SMART_PORT="${MOCK_SMART_PORT:-4010}"
DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/zkguardian}"
REDIS_URL="${REDIS_URL:-redis://localhost:6379}"
HAPI_FHIR_URL="${HAPI_FHIR_URL:-http://127.0.0.1:8080/fhir}"
SMART_AUDIENCE="${SMART_AUDIENCE:-http://localhost:8080/fhir}"
SMART_CLIENT_ID="${SMART_CLIENT_ID:-zk-guardian-gateway}"
SMART_CLIENT_SECRET="${SMART_CLIENT_SECRET:-mock-smart-secret}"
SMART_PUBLIC_CLIENT_ID="${SMART_PUBLIC_CLIENT_ID:-zk-guardian-mobile}"
PATIENT_ID="${PATIENT_ID:-mock-patient-123}"
CLINICIAN_ID="${CLINICIAN_ID:-mock-clinician-456}"
POLYGON_AMOY_RPC="${POLYGON_AMOY_RPC:-https://rpc-amoy.polygon.technology}"
AUDIT_CONTRACT_ADDRESS="${AUDIT_CONTRACT_ADDRESS:-0x0000000000000000000000000000000000000001}"
CONSENT_REVOCATION_REGISTRY_ADDRESS="${CONSENT_REVOCATION_REGISTRY_ADDRESS:-0x0000000000000000000000000000000000000002}"
CREDENTIAL_REGISTRY_ADDRESS="${CREDENTIAL_REGISTRY_ADDRESS:-0x0000000000000000000000000000000000000003}"
GATEWAY_PRIVATE_KEY="${GATEWAY_PRIVATE_KEY:-0x0123456789012345678901234567890123456789012345678901234567890123}"

BASE_URL="http://127.0.0.1:${PORT}"
WS_URL="ws://127.0.0.1:${PORT}/ws/consent"
MOCK_SMART_BASE_URL="http://127.0.0.1:${MOCK_SMART_PORT}"

MOCK_PID=""
GATEWAY_PID=""

mkdir -p "${ARTIFACT_DIR}"

cleanup() {
  local exit_code=$?

  if [[ -n "${GATEWAY_PID}" ]] && kill -0 "${GATEWAY_PID}" >/dev/null 2>&1; then
    kill "${GATEWAY_PID}" >/dev/null 2>&1 || true
    wait "${GATEWAY_PID}" >/dev/null 2>&1 || true
  fi

  if [[ -n "${MOCK_PID}" ]] && kill -0 "${MOCK_PID}" >/dev/null 2>&1; then
    kill "${MOCK_PID}" >/dev/null 2>&1 || true
    wait "${MOCK_PID}" >/dev/null 2>&1 || true
  fi

  exit "${exit_code}"
}

trap cleanup EXIT INT TERM

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

wait_for_http() {
  local url="$1"
  local expected_status="$2"
  local retries="${3:-60}"

  for ((i = 1; i <= retries; i++)); do
    local status
    status="$(curl -s -o /dev/null -w "%{http_code}" "${url}" || true)"
    if [[ "${status}" == "${expected_status}" ]]; then
      return 0
    fi
    sleep 1
  done

  echo "Timed out waiting for ${url} to return HTTP ${expected_status}" >&2
  return 1
}

ensure_local_services() {
  echo "Checking local PostgreSQL and Redis..."
  if ! pg_isready -d "${DATABASE_URL}" >/dev/null 2>&1; then
    echo "PostgreSQL is not ready for ${DATABASE_URL}" >&2
    exit 1
  fi

  if ! redis-cli -u "${REDIS_URL}" ping >/dev/null 2>&1; then
    echo "Redis is not ready for ${REDIS_URL}" >&2
    exit 1
  fi
}

ensure_artifacts() {
  if [[ ! -f "${REPO_ROOT}/contracts/artifacts/src/ZKGuardianAudit.sol/ZKGuardianAudit.json" ]]; then
    echo "Compiling contracts..."
    (cd "${REPO_ROOT}" && pnpm contracts:compile)
  fi

  if [[ ! -f "${REPO_ROOT}/circuits/build/AccessIsAllowedSecure/AccessIsAllowedSecure_final.zkey" ]] || \
     [[ ! -f "${REPO_ROOT}/circuits/build/BreakGlass/BreakGlass_final.zkey" ]]; then
    echo "Setting up circuits..."
    (cd "${REPO_ROOT}" && pnpm circuits:setup)
  fi
}

ensure_ports_clear() {
  if lsof -iTCP:"${PORT}" -sTCP:LISTEN -nP >/dev/null 2>&1; then
    echo "Port ${PORT} is already in use. Stop the existing gateway before running the rehearsal." >&2
    exit 1
  fi

  if lsof -iTCP:"${MOCK_SMART_PORT}" -sTCP:LISTEN -nP >/dev/null 2>&1; then
    echo "Port ${MOCK_SMART_PORT} is already in use. Stop the existing mock IdP before running the rehearsal." >&2
    exit 1
  fi
}

start_mock_idp() {
  echo "Starting mock SMART issuer on ${MOCK_SMART_BASE_URL}..."
  (
    cd "${REPO_ROOT}" && \
    MOCK_SMART_PORT="${MOCK_SMART_PORT}" \
    MOCK_SMART_AUDIENCE="${SMART_AUDIENCE}" \
    MOCK_SMART_PUBLIC_CLIENT_ID="${SMART_PUBLIC_CLIENT_ID}" \
    MOCK_SMART_CONFIDENTIAL_CLIENT_ID="${SMART_CLIENT_ID}" \
    MOCK_SMART_CONFIDENTIAL_CLIENT_SECRET="${SMART_CLIENT_SECRET}" \
    pnpm --filter gateway mock:smart-idp
  ) >"${MOCK_LOG}" 2>&1 &
  MOCK_PID=$!

  wait_for_http "${MOCK_SMART_BASE_URL}/health" 200 30
}

start_gateway() {
  echo "Applying Prisma migrations..."
  (
    cd "${REPO_ROOT}" && \
    DATABASE_URL="${DATABASE_URL}" \
    pnpm --filter gateway exec prisma migrate deploy
  )

  echo "Starting gateway on ${BASE_URL} with external SMART auth..."
  (
    cd "${REPO_ROOT}" && \
    env \
      NODE_ENV=development \
      PORT="${PORT}" \
      DATABASE_URL="${DATABASE_URL}" \
      REDIS_URL="${REDIS_URL}" \
      HAPI_FHIR_URL="${HAPI_FHIR_URL}" \
      SMART_AUTH_MODE=external \
      SMART_ISSUER="${MOCK_SMART_BASE_URL}" \
      SMART_AUTHORIZATION_ENDPOINT="${MOCK_SMART_BASE_URL}/authorize" \
      SMART_TOKEN_ENDPOINT="${MOCK_SMART_BASE_URL}/token" \
      SMART_INTROSPECTION_ENDPOINT="${MOCK_SMART_BASE_URL}/introspect" \
      SMART_REVOCATION_ENDPOINT="${MOCK_SMART_BASE_URL}/revoke" \
      SMART_JWKS_URI="${MOCK_SMART_BASE_URL}/.well-known/jwks.json" \
      SMART_CLIENT_ID="${SMART_CLIENT_ID}" \
      SMART_CLIENT_SECRET="${SMART_CLIENT_SECRET}" \
      SMART_AUDIENCE="${SMART_AUDIENCE}" \
      SMART_REDIRECT_URIS='zkguardian://auth' \
      ALLOW_DEV_BYPASS=false \
      ENABLE_SYNTHETIC_CONSENT=false \
      ENABLE_BATCH_AUDIT=false \
      CIRCUIT_ARTIFACTS_DIR='../circuits/build' \
      POLYGON_AMOY_RPC="${POLYGON_AMOY_RPC}" \
      AUDIT_CONTRACT_ADDRESS="${AUDIT_CONTRACT_ADDRESS}" \
      CONSENT_REVOCATION_REGISTRY_ADDRESS="${CONSENT_REVOCATION_REGISTRY_ADDRESS}" \
      CREDENTIAL_REGISTRY_ADDRESS="${CREDENTIAL_REGISTRY_ADDRESS}" \
      GATEWAY_PRIVATE_KEY="${GATEWAY_PRIVATE_KEY}" \
      pnpm --filter gateway dev
  ) >"${GATEWAY_LOG}" 2>&1 &
  GATEWAY_PID=$!

  wait_for_http "${BASE_URL}/health" 200 60
}

run_verifier() {
  echo "Running mock SMART gateway rehearsal..."
  (
    cd "${REPO_ROOT}" && \
    BASE_URL="${BASE_URL}" \
    WS_URL="${WS_URL}" \
    MOCK_SMART_BASE_URL="${MOCK_SMART_BASE_URL}" \
    PATIENT_ID="${PATIENT_ID}" \
    CLINICIAN_ID="${CLINICIAN_ID}" \
    MOCK_SMART_AUDIENCE="${SMART_AUDIENCE}" \
    MOCK_SMART_PUBLIC_CLIENT_ID="${SMART_PUBLIC_CLIENT_ID}" \
    MOCK_SMART_CONFIDENTIAL_CLIENT_ID="${SMART_CLIENT_ID}" \
    MOCK_SMART_CONFIDENTIAL_CLIENT_SECRET="${SMART_CLIENT_SECRET}" \
    OUTPUT_PATH="${ARTIFACT_DIR}/latest.json" \
    pnpm --filter gateway verify:mock-smart
  )
}

require_cmd pnpm
require_cmd curl
require_cmd lsof
require_cmd pg_isready
require_cmd redis-cli

ensure_local_services
ensure_artifacts
ensure_ports_clear
start_mock_idp
start_gateway
run_verifier

echo
echo "Mock SMART gateway rehearsal passed."
echo "Evidence: ${ARTIFACT_DIR}/latest.json"
echo "Mock issuer log: ${MOCK_LOG}"
echo "Gateway log: ${GATEWAY_LOG}"
