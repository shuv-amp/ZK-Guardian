# Documentation

Welcome to ZK Guardian documentation. This folder contains the operational and architectural references you need to run the platform in production.

## Contents

- Architecture overview: [ARCHITECTURE.md](../ARCHITECTURE.md)
- Security and reporting: [SECURITY.md](../SECURITY.md)
- Contributing guide: [CONTRIBUTING.md](../CONTRIBUTING.md)
- Change history: [CHANGELOG.md](../CHANGELOG.md)

## Production Runbooks

- [Staging validation runbook](./staging-validation-runbook.md): external SMART/OIDC smoke tests, consent WebSocket validation, audited access checks, break-glass checks, and native mobile production validation.
- **Gateway**: external SMART/OIDC config, secrets manager, Prisma migrations, and health checks.
- **Circuits**: trusted setup, checksum generation, and artifact packaging.
- **Contracts**: deployment, verification, and registry address updates.
- **Mobile**: SMART config, `TLS_PIN_MAP`, certificate pinning, and release builds.

## Suggested Reading Order

1. [ARCHITECTURE.md](../ARCHITECTURE.md)
2. [SECURITY.md](../SECURITY.md)
3. [CONTRIBUTING.md](../CONTRIBUTING.md)
4. [CHANGELOG.md](../CHANGELOG.md)
