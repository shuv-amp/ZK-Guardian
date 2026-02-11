# Architecture

## Overview

ZK Guardian is a privacy-preserving access audit system for healthcare data. It uses SMART on FHIR for authentication, ZK proofs for consent verification, and a blockchain audit log for tamper-evidence.

## Components

- **Mobile App (Expo)**: patient and clinician UX, consent prompts, identity onboarding.
- **Gateway (Node.js + Express)**: SMART OAuth provider, FHIR proxy, ZK proof generation, audit batching.
- **Circuits (Circom)**: AccessIsAllowedSecure and BreakGlass proof logic.
- **Contracts (Solidity)**: on-chain audit verification and revocation registries.
- **FHIR Server (HAPI)**: patient data and consent source of truth.

## Data Flow

1. User authenticates via SMART (OAuth2 + PKCE).
2. Gateway validates token and establishes consent session over WebSocket.
3. When access is requested, gateway generates a ZK proof using consent and nullifiers.
4. Proof is verified on-chain and an audit event is emitted.
5. Patients view access history via the gateway API.

## Trust Boundaries

- **Mobile App**: stores nullifier material in secure storage.
- **Gateway**: holds signing keys and circuit artifacts; must run in a hardened environment.
- **Blockchain**: immutable audit log; no PII/PHI is stored.

## Production Hardening Checklist

- SMART OAuth keys stored in secure secrets manager.
- Circuit artifacts pinned with checksums.
- Contract addresses pinned and verified on deployment.
- Rate limiting and anomaly detection configured.
- Monitoring for /health, /ready, and audit failures.
