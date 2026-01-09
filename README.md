# ZK Guardian 🛡️

> Privacy-preserving healthcare audit log using zk-SNARKs and HL7 FHIR R4

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Polygon Amoy](https://img.shields.io/badge/Polygon-Amoy-purple)](https://amoy.polygonscan.com/)
[![FHIR R4](https://img.shields.io/badge/FHIR-R4-orange)](https://hl7.org/fhir/R4/)

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
- Circom 2.1.x ([install guide](https://docs.circom.io/getting-started/installation/))
- Docker (optional, for local HAPI FHIR)

### Installation

```bash
# Clone repository
git clone https://github.com/your-org/zk-guardian.git
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
│ • Consent    │    │ • SMART Auth     │    │ • Patient data  │
│   approval   │    │ • ZK Proofs      │    │ • Consent       │
│ • Audit view │    │ • Batch audit    │    │ • Observations  │
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
- **SMART on FHIR**: OAuth 2.0 authentication

## 📄 License

Apache 2.0 License - see [LICENSE](LICENSE) for details.

> **⚠️ EDUCATIONAL / POC USE ONLY**: This is a Proof of Concept for verified healthcare access. Do not use in production without a professional security audit of the ZK circuits and smart contracts.

---

