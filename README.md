# ZK Guardian

## 🎯 Overview

**ZK Guardian** is a research prototype that applies zero-knowledge cryptography to healthcare data access control. Built on industry-standard HL7 FHIR, it demonstrates how cryptographic proofs can verify that data access complies with patient consent without exposing sensitive information.

### Academic Context

This project was developed as part of advanced cryptography and healthcare informatics research, exploring the practical application of zk-SNARKs (Zero-Knowledge Succinct Non-Interactive Arguments of Knowledge) in HIPAA-compliant environments.

**Research Focus Areas:**
- Privacy-preserving access control in electronic health records
- Zero-knowledge proof systems for regulatory compliance
- Blockchain-based audit trails for healthcare
- FHIR standard integration with cryptographic protocols

---

## 🔍 The Problem

Modern healthcare systems face a critical verification gap:

```
┌─────────────────────────────────────────────────────────────┐
│  Current State: Trust-Based Access Control                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ❌ Internal logs that patients cannot independently verify │
│  ❌ Compliance audits depend on trusting provider records   │
│  ❌ No cryptographic proof that access followed consent     │
│  ❌ Difficult to detect unauthorized access after the fact  │
│  ❌ Audit trails can be modified by privileged users        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

While HL7 FHIR enables data interoperability and SMART on FHIR provides OAuth-based authorization, **neither generates cryptographic proof that each access request actually complied with patient consent policies**.

---

## ✨ Our Solution

ZK Guardian adds a cryptographic compliance layer to standard FHIR-based access:

```
┌─────────────────────────────────────────────────────────────┐
│  ZK Guardian: Proof-Based Access Control                    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ✅ Mathematical proof that access followed consent rules   │
│  ✅ Patient identity and medical data never leave the client│
│  ✅ Immutable blockchain audit trail of all verifications   │
│  ✅ Independently verifiable by patients and auditors       │
│  ✅ Standards-compliant FHIR resource integration           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Core Capabilities

1. **Patient-Controlled Consent**: Mobile app for granting granular permissions (data type, role, time window)
2. **Provider Access Requests**: Clinician app for requesting FHIR resource access
3. **Zero-Knowledge Proof Generation**: Client-side proof that access matches consent, without revealing details
4. **On-Chain Verification**: Blockchain verifier contract that validates proofs and emits audit events
5. **FHIR Integration**: Native support for Patient, Practitioner, Consent, and Observation resources

---

## 🔑 Key Innovation

### The AccessIsAllowed Circuit

At the heart of ZK Guardian is a custom Circom circuit that proves access authorization:

```
Prover (Client)                    Verifier (Blockchain)
     │                                     │
     │  Private Inputs:                    │
     │  • User ID                          │
     │  • User Role                        │
     │  • Resource Type                    │
     │  • Consent Policy                   │
     │  • Timestamp                        │
     │                                     │
     │  ┌──────────────────────┐           │
     │  │  AccessIsAllowed     │           │
     │  │  Circom Circuit      │           │
     │  │                      │           │
     │  │  Checks:             │           │
     │  │  1. Role matches     │           │
     │  │  2. Data allowed     │           │
     │  │  3. Time valid       │           │
     │  └──────────────────────┘           │
     │            │                        │
     │            ▼                        │
     │  ┌──────────────────────┐           │
     │  │   Groth16 Proof      │           │
     │  │   (~200 bytes)       │           │
     │  └──────────────────────┘           │
     │            │                        │
     ├────────────┼─────────────────────────▶
     │            │                        │
     │            │        ┌──────────────────────┐
     │            │        │  Solidity Verifier   │
     │            │        │  • Verify proof      │
     │            │        │  • Emit AuditEvent   │
     │            │        │  • No PHI on-chain   │
     │            │        └──────────────────────┘
     │            │                         │
     │            ◀─────────────────────────┤
     │            │                         │
     │       ✓ Access Granted               │
     │       📝 Immutable Receipt           │
```

**Key Property**: The proof reveals **only** that access was authorized—not the patient identity, medical data, or specific consent terms.

---

## 🏗️ Architecture

### System Components

```
┌──────────────────────────────────────────────────────────────────────┐
│                         ZK GUARDIAN ARCHITECTURE                     │
└──────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                          CLIENT LAYER                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌────────────────────────┐         ┌────────────────────────┐      │
│  │   Patient Mobile App   │         │  Clinician Mobile App  │      │
│  │   ─────────────────    │         │  ──────────────────    │      │
│  │   • Consent management │         │  • Access requests     │      │
│  │   • View access history│         │  • View patient data   │      │
│  │   • Grant/revoke       │         │  • Proof generation    │      │
│  │                        │         │                        │      │
│  │   React Native + Expo  │         │   React Native + Expo  │      │
│  └────────────────────────┘         └────────────────────────┘      │
│              │                                    │                 │
└──────────────┼────────────────────────────────────┼─────────────────┘
               │                                    │
               └─────────────┬──────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         GATEWAY LAYER                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│                    ┌──────────────────────────┐                     │
│                    │   Node.js + Express      │                     │
│                    │   ─────────────────      │                     │
│                    │   • JWT Authentication   │                     │
│                    │   • Request routing      │                     │
│                    │   • FHIR coordination    │                     │
│                    │   • Proof orchestration  │                     │
│                    └──────────────────────────┘                     │
│                               │                                     │
└───────────────────────────────┼─────────────────────────────────────┘
                                │
                ┌───────────────┼───────────────┐
                │               │               │
                ▼               ▼               ▼
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│  FHIR SERVER     │  │  ZK PROVER       │  │  BLOCKCHAIN      │
│  ─────────       │  │  ─────────       │  │  ──────────      │
│                  │  │                  │  │                  │
│  HAPI FHIR R4    │  │  Circom/snarkjs  │  │  Polygon Amoy    │
│                  │  │                  │  │                  │
│  • Patient       │  │  • Circuit       │  │  • Verifier      │
│  • Practitioner  │  │    compilation   │  │    contract      │
│  • Consent       │  │  • Witness gen   │  │  • Audit events  │
│  • Observation   │  │  • Proof gen     │  │  • Immutable log │
│                  │  │    (~2 sec)      │  │                  │
└──────────────────┘  └──────────────────┘  └──────────────────┘
```

### Data Flow: Access Request Lifecycle

```
1. Patient grants consent (FHIR Consent resource created)
2. Clinician requests access to specific data
3. Gateway retrieves relevant FHIR resources
4. Client generates AccessIsAllowed proof
5. Gateway submits proof to on-chain verifier
6. Smart contract validates and emits AuditEvent
7. Access granted, receipt stored on blockchain
```

---

## 🛠️ Technology Stack

### Core Technologies

| Layer | Technology | Purpose |
|-------|------------|---------|
| **Mobile** | React Native 0.74 + Expo SDK 51 | Cross-platform patient/provider apps |
| **Gateway** | Node.js 20 LTS + Express.js | API gateway and orchestration |
| **Healthcare** | HAPI FHIR R4 (HL7 FHIR) | Standards-compliant EHR integration |
| **Zero-Knowledge** | Circom 2.1 + snarkjs 0.7 | zk-SNARK circuit and proof generation |
| **Blockchain** | Solidity 0.8.20 + Polygon Amoy | On-chain verification and audit |
| **Database** | PostgreSQL 16 | Application state and metadata |

### Development Tools

```bash
Circom 2.1        # ZK circuit compiler
snarkjs 0.7.3     # Proof generation library
Hardhat           # Smart contract development
Foundry           # Contract testing framework
Docker            # Containerized FHIR server
GitHub Actions    # CI/CD pipeline
```

---

## 🚀 Getting Started

### Prerequisites

```bash
# Required
node >= 20.0.0
pnpm >= 8.0.0 (or npm/yarn)

# For ZK development
circom >= 2.1.0
snarkjs >= 0.7.0

# For blockchain development
foundry (forge, cast, anvil)
```

### Installation

```bash
# Clone the repository
git clone https://github.com/shuv-amp/zk-guardian.git
cd zk-guardian

# Install dependencies
pnpm install

# Set up environment variables
cp .env.example .env
# Edit .env with your configuration
```
---

## 📁 Project Structure

```
zk-guardian/
│
├── apps/
│   ├── mobile/                    # React Native mobile applications
│   │   ├── app/                   # Expo Router screens
│   │   │   ├── (auth)/            # Authentication flow
│   │   │   ├── (patient)/         # Patient app screens
│   │   │   └── (provider)/        # Provider app screens
│   │   └── src/
│   │       ├── components/        # Reusable UI components
│   │       ├── services/          # API clients
│   │       └── lib/               # ZK proof generation
│   │
│   └── web/
│       └── admin-dashboard/       # Admin compliance dashboard
│
├── services/
│   ├── api-gateway/               # Express.js gateway
│   │   ├── src/
│   │   │   ├── routes/            # API endpoints
│   │   │   ├── middleware/        # Auth, validation
│   │   │   └── controllers/       # Business logic
│   │
│   ├── fhir-gateway/              # HAPI FHIR integration
│   │   └── src/
│   │       ├── resources/         # FHIR resource handlers
│   │       └── consent/           # Consent engine
│   │
│   └── blockchain-service/        # Contract interaction
│       └── src/
│           ├── contracts/         # Deployed contract ABIs
│           └── verifier/          # Proof verification client
│
├── packages/
│   ├── zk-circuits/               # Circom circuits
│   │   ├── circuits/
│   │   │   ├── AccessIsAllowed.circom
│   │   │   ├── RoleVerifier.circom
│   │   │   ├── ResourceVerifier.circom
│   │   │   └── TimeVerifier.circom
│   │   ├── build/                 # Compiled outputs
│   │   ├── scripts/
│   │   │   ├── compile.sh         # Compile circuits
│   │   │   └── setup.sh           # Generate keys
│   │   └── test/                  # Circuit unit tests
│   │
│   ├── contracts/                 # Solidity smart contracts
│   │   ├── src/
│   │   │   ├── ZKAccessVerifier.sol
│   │   │   ├── ConsentRegistry.sol
│   │   │   └── AuditTrail.sol
│   │   ├── test/                  # Foundry tests
│   │   └── script/                # Deployment scripts
│   │
│   └── shared/                    # Shared TypeScript types
│       ├── types/
│       │   ├── fhir.ts            # FHIR resource types
│       │   ├── consent.ts         # Consent models
│       │   └── proof.ts           # Proof types
│       └── utils/
│
├── docs/
│   ├── PROJECT_PROPOSAL.md        # Academic proposal
│   ├── ARCHITECTURE.md            # System architecture
│   ├── ZK_CIRCUITS.md             # Circuit documentation
│   ├── SMART_CONTRACTS.md         # Contract specifications
│   ├── FHIR_INTEGRATION.md        # FHIR implementation guide
│   └── SECURITY.md                # Security analysis
│
├── .env.example                   # Environment template
├── docker-compose.yml             # FHIR server setup
├── package.json                   # Root package.json
├── pnpm-workspace.yaml            # Monorepo configuration
└── turbo.json                     # Turborepo config
```

---

<div align="center">

*ZK Guardian is a research prototype intended for academic and educational purposes.  
Not suitable for production healthcare environments without extensive additional security review and regulatory approval.*

</div>
