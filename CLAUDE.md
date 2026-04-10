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

After every edit, run checks from the repo root:

```bash
yarn ci
```

This runs lint (Biome), typecheck, circular dependency check, and export validation in sequence. It is wired up to:
- **pre-commit hook** (husky) — runs automatically before every commit
- **CI pipeline** (`bitbucket-pipelines.yml`, `code-quality` step) — runs on PRs and master

Run tests separately:

```bash
cd sdk && yarn test
```

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

## `cards` module — iframe-based card tokenization

`CardsModule.mountCardForm(container, options?)` fetches the hosted iframe URL from `GET /encryption/card-form-url`, mounts the GoPay-hosted card encryption iframe, and returns `Promise<CardFormController>`:

- **`result`** — `Promise<CardTokenResponse>` that resolves with the card token on success, rejects on error or cancellation.
- **`setTheme(theme)`** / **`setLocale(locale)`** — send runtime updates to the iframe via `postMessage`.
- **`submit()`** — triggers form submission from the parent page; only valid when `submitMode: 'external'`.
- **`isValid`** — live validity state (only populated in external submit mode).

**postMessage protocol** is defined in `sdk/src/modules/cards/iframe-protocol.ts`. This file is intentionally duplicated between this repo and `gw-ui-cc-v4`. Keep both in sync manually — types and type aliases only, no imports or logic.

**Init flow:**
1. `mountCardForm` calls `GET /encryption/card-form-url` internally to obtain the iframe URL.
2. The SDK appends the iframe (sandboxed: `allow-scripts allow-forms`).
3. On `iframe.onload`, the SDK posts `GOPAY_CARD_FORM_INIT` with tokens, environment, theme, locale, and submit mode. Target origin is `'*'` because the sandbox removes `allow-same-origin`, making the iframe's origin opaque (`"null"`).
4. The iframe posts back `GOPAY_CARD_ENCRYPT_RESULT` (carrying the JWE payload), then the SDK calls `POST /cards/tokens` internally and resolves `result`.

**Submit modes:**
- `'internal'` (default) — iframe renders its own submit button.
- `'external'` — iframe hides its submit button; parent calls `controller.submit()` and receives `GOPAY_CARD_FORM_VALIDITY` messages.

---

## `encryption` module — intentionally absent

Card data encryption must never be performed in publicly reachable JavaScript. The public key fetch (`GET /encryption/public-key`) and JWE construction happen inside an isolated GoPay-hosted iframe served from a separate, non-public origin. Do not add an `encryption` module to this SDK.

---

## `gw_url` — do not use or recommend

`payments.create()` returns a `gw_url` field. **Do not use it, suggest it, or add it to examples.**

It exists solely for backward compatibility with integrations that predate this SDK (old redirect-based flow). This SDK's flow is always: create → charge (card token / Apple Pay / Google Pay). The API spec will document this once updated.
