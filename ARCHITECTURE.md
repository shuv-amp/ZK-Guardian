# Architecture

## Overview

ZK Guardian is a privacy-preserving access audit system for healthcare data. It uses an external SMART/OIDC authorization server for authentication, ZK proofs for consent verification, and a blockchain audit log for tamper-evidence.

## Components

- **Mobile App (Expo)**: patient and clinician UX, consent prompts, identity onboarding.
- **Gateway (Node.js + Express)**: SMART resource server, FHIR proxy, ZK proof generation, direct audit submission, and break-glass orchestration.
- **Circuits (Circom)**: AccessIsAllowedSecure and BreakGlass proof logic.
- **Contracts (Solidity)**: on-chain audit verification and revocation registries.
- **FHIR Server (HAPI)**: patient data and consent source of truth.

## Data Flow

1. User authenticates via an external SMART/OIDC authorization server (OAuth2 + PKCE).
2. Gateway validates issuer, audience, signature, expiry, and revocation before serving protected APIs.
3. The mobile app opens `/ws/consent` with a bearer token, and the gateway derives patient identity from token claims.
4. When access is requested, the gateway normalizes consent policy, generates a ZK proof, and submits `verifyAndAudit`.
5. Patients and clinicians view audit/access state through the gateway API.

## Trust Boundaries

- **Mobile App**: stores nullifier material in secure storage.
- **Gateway**: holds signing keys and circuit artifacts, but is not the production authorization server; it must run in a hardened environment with secrets management and checksum-verified artifacts.
- **Blockchain**: immutable audit log; no PII/PHI is stored.

## Production Hardening Checklist

- External SMART/OIDC issuer, JWKS, introspection endpoint, and client credentials configured.
- Gateway signing key stored in a secure secrets manager.
- Circuit artifacts pinned with checksums.
- Contract addresses pinned and verified on deployment.
- Rate limiting and anomaly detection configured.
- Mobile release builds ship with HTTPS/WSS only and TLS pin configuration for every production host they call.
- CI verifies a fresh checkout build/test path on Node 20.
- Monitoring for `/health`, `/ready`, and audit failures.
