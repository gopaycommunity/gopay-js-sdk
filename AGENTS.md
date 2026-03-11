## API Spec & Code Generation

The SDK is generated from [Payments.yaml](Payments.yaml) — an OpenAPI 3.1.0 spec for the GoPay Payments API v4.0.

TypeScript types are generated from the spec using `openapi-typescript`:

```bash
cd sdk && yarn codegen
# outputs: sdk/src/types/generated.ts
```

Run this whenever `Payments.yaml` is updated to keep the types in sync.

---

## Checks

Run all checks with a single command from the repo root:

```bash
yarn ci
```

This runs lint (Biome) and typecheck in sequence. It is wired up to:
- **pre-commit hook** (husky) — runs automatically before every commit
- **CI pipeline** (`bitbucket-pipelines.yml`, `code-quality` step) — runs on PRs and master

Security audit runs separately in CI:

```bash
yarn npm audit --recursive --environment production
```

---

## Distribution

The SDK is distributed in two ways:

- **NPM package** (`gopay-js-sdk`) — for use in Node.js / bundler-based projects (ESM and CJS builds).
- **CDN script** — a standalone IIFE bundle (`gopay-sdk.min.js`) that can be included directly via `<script src="...">`, exposing `window.GoPaySDK` as a browser global.
