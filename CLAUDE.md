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

After every edit, run checks with from the repo root:

```bash
yarn lint
yarn typecheck
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

---

## `encryption` module — intentionally absent

Card data encryption must never be performed in publicly reachable JavaScript. The public key fetch (`GET /encryption/public-key`) and JWE construction happen inside an isolated GoPay-hosted iframe served from a separate, non-public origin. Do not add an `encryption` module to this SDK.

---

## `gw_url` — do not use or recommend

`payments.create()` returns a `gw_url` field. **Do not use it, suggest it, or add it to examples.**

It exists solely for backward compatibility with integrations that predate this SDK (old redirect-based flow). This SDK's flow is always: create → charge (card token / Apple Pay / Google Pay). The API spec will document this once updated.
