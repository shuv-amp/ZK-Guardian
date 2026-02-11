# Contributing to ZK Guardian

Thanks for helping improve ZK Guardian. This project expects secure, testable changes and clear documentation.

## Basics

- Use Node.js >=20 and pnpm >=9.
- Keep commits focused and well described.
- Add tests for new behavior, and update documentation when you change workflows.

## Development Setup

```bash
pnpm install
cp .env.example .env
```

## Running Locally

```bash
pnpm dev
```

## Tests

```bash
pnpm lint
pnpm test
pnpm --filter gateway test
pnpm --filter contracts test
```

## Code Style

- Prefer explicit names and narrow responsibilities.
- Avoid hidden side effects in request handlers.
- Keep logs structured and avoid secrets in logs.

## Pull Requests

- Link the issue or describe the change clearly.
- Include a short risk assessment and test evidence.
- If you changed environment variables, update `.env.example`.

## Security

If your change touches auth, cryptography, or secrets handling, request a security review. See [SECURITY.md](SECURITY.md).
