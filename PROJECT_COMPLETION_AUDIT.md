# ZK Guardian Completion & Professionalization Audit
Date: 2026-02-07

Scope: Repository scan for placeholder/demo/dev logic, missing integrations, and production readiness gaps. Items marked as “P0” are production blockers.

Legend: P0 = blocker, P1 = high, P2 = medium, P3 = low.

**CI/CD & Release**
- [P0] CI workflows are fully commented out, so there is no automated lint/test/build/deploy pipeline. Evidence: `.github/workflows/ci.yml`, `.github/workflows/zk-guardian-ci.yml`, `.github/workflows/deploy-gateway.yml`, `.github/workflows/deploy-contracts.yml`. Add: re-enable workflows, configure secrets, and gate merges on CI.
- [P2] No release/versioning automation (tags, changelog, publish tasks). Evidence: root `package.json` and workflow files. Add: release workflow and version policy.

**Documentation & Governance**
- [P1] Project docs are a placeholder. Evidence: `docs/README.md`. Add: real documentation structure (architecture, setup, operations, troubleshooting).
- [P1] Referenced security/compliance documents are missing. Evidence: references to `SECURITY_AUDIT_CHECKLIST.md`, “Development Guide”, and “Technical Blueprint” in code but no files found. Add: those documents or remove references.
- [P2] Missing standard repository governance files. Evidence: no `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CHANGELOG.md`, `ARCHITECTURE.md`. Add: all of these for professional maintenance.
- [P2] README labels the project as POC/educational. Evidence: `README.md`. Add: update once production hardening is complete.

**ZK Circuits & Proof Pipeline**
- [P0] Circuit build artifacts are missing, but gateway depends on them. Evidence: no `circuits/build/` directory; gateway expects `../circuits/build/...` in `gateway/src/modules/security/zkProofService.ts` and `gateway/src/lib/zkProofService.ts`. Add: generate and package build artifacts or fetch from a secure artifact store at runtime.
- [P0] Gateway Docker image does not include circuit artifacts. Evidence: `gateway/Dockerfile` copies only gateway sources and contracts. Add: copy circuit wasm/zkey/vkey into the image or mount at runtime.
- [P1] Circuit integrity verification can be skipped and there is no checksum file. Evidence: `gateway/src/config/circuitValidation.ts`, no `circuits/checksums.sha256`. Add: generate and enforce hashes in production.
- [P1] Inconsistent circuit artifacts: `gateway/circuits` contains AccessIsAllowed artifacts but production code uses AccessIsAllowedSecure from `circuits/`. Add: consolidate one authoritative artifacts path and remove stale files.
- [P0] Merkle tree root computation returns `0n` and the tree is in-memory only. Evidence: `gateway/src/modules/audit/merkleTreeService.ts` (`computeRootFromLeaves` returns `0n`; comment says demo/in-memory). Add: correct root logic and persistent storage (DB/Redis) with full tree state.
- [P1] Worker pool exists but is not wired to proof generation. Evidence: `gateway/src/workers/proofWorkerPool.ts` exists; `ENABLE_WORKER_POOL` only in env schema and never used. Add: integrate worker pool or remove.
- [P1] Synthetic consent and dev-only proof allowances remain in core proof service. Evidence: `gateway/src/modules/security/zkProofService.ts` (synthetic consent, dev memory thresholds). Add: strict production behavior and explicit test-only flags.

**Blockchain & Smart Contracts**
- [P0] Governance deployment is incomplete; token/governor setup is skipped. Evidence: `contracts/scripts/deploy-uups.js` comments “Mock Token for now” and “Skipping Governance Token.” Add: finalize governance deployment or remove governance components.
- [P0] Batch audit service ABI does not match contract. Evidence: `gateway/src/modules/audit/batchAuditService.ts` calls `batchRecordAuditEvents`/`recordAuditEvent`, but `contracts/src/ZKGuardianAudit.sol` defines `batchVerifyAndAudit` only. Add: align ABI and on-chain methods.
- [P1] Environment variables are inconsistent. Evidence: root `.env.example` uses `REVOCATION_CONTRACT_ADDRESS`, code expects `CONSENT_REVOCATION_REGISTRY_ADDRESS`; `CREDENTIAL_REGISTRY_ADDRESS` is used in code but not in env schema or examples. Add: standardize env names across gateway/mobile/scripts.
- [P1] Break-glass credentialing is demo-only. Evidence: `gateway/src/lib/zkProofService.ts` auto-adds credentials locally; `gateway/src/modules/identity/identityService.ts` skips on-chain registration when config missing with no retry queue. Add: real credential issuance workflow + registry updates and retries.
- [P1] Batch audit runs in mock mode when chain config is missing. Evidence: `gateway/src/modules/audit/batchAuditService.ts`. Add: enforce required configuration in production, or define safe degradation behavior.

**Gateway Auth & Security**
- [P0] OAuth/SMART server is demo-grade. Evidence: `gateway/src/routes/oauth.ts` uses in-memory codes, static users, no PKCE verification, no client auth, no refresh tokens, and signs JWTs with `dev-secret`. Add: real SMART/OIDC provider integration or a production-grade OAuth server.
- [P0] SMART discovery advertises endpoints that don’t exist. Evidence: `gateway/src/routes/smartConfig.ts` advertises `/oauth/introspect` and `/oauth/revoke` but routes are absent. Add endpoints or remove from discovery.
- [P0] Dev bypass allows SMART auth with no issuer. Evidence: `gateway/src/middleware/smartAuth.ts`. Add strict production enforcement.
- [P0] Consent handshake auth uses HMAC with patientId and dev bypass signatures. Evidence: `gateway/src/modules/consent/consentHandshake.ts` and `apps/mobile/services/ConsentHandshakeClient.ts`. Add real key-based signing with registered public keys.
- [P1] JWT secret management is inconsistent. Evidence: `JWT_SECRET` exists in `.env.example` and secrets manager, but OAuth tokens are signed with `GATEWAY_PRIVATE_KEY`/`dev-secret`. Add dedicated JWT secret usage and rotation.
- [P1] Secrets manager falls back to a hardcoded master key. Evidence: `gateway/src/config/secrets.ts` uses `zk-guardian-dev-key-change-in-prod` when `SECRETS_MASTER_KEY` is unset. Add: require a real master key in production and fail fast if missing.
- [P1] Environment loader logs full config (including secrets). Evidence: `gateway/src/config/env.ts` logs `[DEBUG] Loaded Env` and prints parsed values. Add: redact or disable in production.
- [P1] Multi-tenant features are defined but not enforced. Evidence: `tenantMiddleware` is imported in `gateway/src/index.ts` but never used. Add tenant enforcement + RLS for all requests.
- [P2] Rate limiting falls back to in-memory store on Redis failure. Evidence: `gateway/src/middleware/rateLimit.ts`. Add production policy (fail closed or degraded mode with alerting).

**Consent, Audit, Compliance**
- [P1] Compliance report uses placeholder values for denied accesses. Evidence: `gateway/src/modules/audit/complianceReportService.ts` sets `denied = 0`. Add real denial tracking (SystemEvents or audit log with status).
- [P1] Patient access restrictions fail open. Evidence: `gateway/src/routes/patientPreferences.ts` returns allowed=true on error. Add fail-closed or explicit fallback policy.
- [P1] PDF export is limited to 100 records. Evidence: `gateway/src/modules/audit/pdfService.ts` `take: 100`. Add pagination/streaming and full export path.
- [P1] Clinician proofs endpoint is simplified and lacks queue status. Evidence: `gateway/src/routes/clinician.ts` comments about pending/queued not tracked; `gasUsed` hardcoded `0`. Add proof queue tracking + DB status fields.
- [P1] Replay protection confirmation cannot persist proof status because proofHash isn’t stored in the DB queue. Evidence: `gateway/src/modules/security/replayProtection.ts` updates `BatchProofQueue` but notes proofHash is missing. Add proofHash column or a dedicated table for replay protection persistence.
- [P1] Break-glass clinician signatures are collected but never verified. Evidence: `gateway/src/middleware/breakGlass.ts` does not verify `clinicianSignature`; `apps/mobile/app/(clinician)/break-glass.tsx` sets `clinicianSignature` to `practitionerId`. Add cryptographic signing and verification (and witness verification if required).
- [P2] Consent templates are hardcoded in memory. Evidence: `gateway/src/modules/consent/consentTemplates.ts`. Add DB-managed templates and admin UI.
- [P2] JIT consent creation falls back to local consent in dev. Evidence: `gateway/src/middleware/zkAuthMiddleware.ts`. Add stricter production behavior and audit trail.

**Mobile App**
- [P0] Registration flow is simulated only. Evidence: `apps/mobile/app/(auth)/register.tsx` (“simulate registration”). Add real registration and verification flow.
- [P0] Consent handshake signatures are weak and dev-only. Evidence: `apps/mobile/services/ConsentHandshakeClient.ts` uses hash signatures; `biometrics` skipped in dev/web. Add real signing with device keys and enforce biometrics in production.
- [P1] Consent revocation has a runtime bug. Evidence: `apps/mobile/services/consentRevocation.ts` calls `this.nullifierManager.regenerateOnRevocation` which does not exist. Add proper nullifier rotation (e.g., `NullifierManager.resetNullifier`).
- [P1] Nullifier backup is not encrypted and lacks metadata. Evidence: `apps/mobile/services/NullifierManager.ts` uses base64 only and `createdAt` is `0`. Add encryption, integrity checks, and timestamp storage.
- [P1] Certificate pinning is not production-ready. Evidence: `apps/mobile/utils/certificatePinning.ts` uses placeholder pins and falls back to unpinned fetch if module missing. Add real pins and enforce in prod builds.
- [P1] Production config placeholders and hard-coded LAN IPs. Evidence: `apps/mobile/config/env.ts`. Add EAS/CI config injection and production defaults.
- [P1] Android allows cleartext traffic. Evidence: `apps/mobile/app.json` `usesCleartextTraffic: true`. Disable for production.
- [P2] Web secure storage fallback uses localStorage. Evidence: `apps/mobile/utils/SecureStorage.ts`. Add secure web storage or disable web target.
- [P2] IdentityManager bypasses shared config. Evidence: `apps/mobile/services/IdentityManager.ts` uses `EXPO_PUBLIC_GATEWAY_URL` directly. Normalize config usage.
- [P2] Mobile refresh token flow depends on refresh tokens that backend doesn’t issue. Evidence: `apps/mobile/services/SMARTAuthService.ts` vs `gateway/src/routes/oauth.ts`. Align backend and mobile token flows.

**SDK Packages**
- [P2] SDKs lack tests and usage documentation. Evidence: `packages/sdk` and `packages/sdk-react` have no test files and no README in package folders. Add tests, docs, and publishing pipeline.

**Repository Hygiene**
- [P2] Local artifacts and logs are present in the repo root (e.g., `*.log`, `node_modules/`, `.DS_Store`). Add cleanup tasks and ensure these stay untracked.
