## API Spec & Code Generation

TypeScript types are generated from the live GoPay API spec using `openapi-typescript`:

```bash
cd sdk && yarn codegen
# fetches https://api-docs.gopay.com/spec/en/payments.yaml
# outputs: sdk/src/types/generated.ts
```

The local [Payments.yaml](Payments.yaml) is kept as a reference snapshot but codegen always pulls from the URL. Run codegen whenever you need the types in sync with the latest spec.

---

## Checks

After every edit, run checks from the repo root:

```bash
yarn ci
```

This runs lint (Biome), typecheck, circular dependency check, and export validation in sequence. It is wired up to:
- **pre-commit hook** (husky) — runs automatically before every commit
- **CI pipeline** (`bitbucket-pipelines.yml`, `code-quality` step) — runs on PRs only (master is protected by pre-commit + PR checks)

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

Two separate npm packages:

- **`@gopaycz/gopay-js-sdk`** (`sdk/`) — server-side SDK for Node.js / bundler-based projects (ESM and CJS builds).
- **`@gopaycz/gopay-js-sdk-browser`** (`browser-sdk/`) — browser SDK. Includes ESM/CJS builds and a standalone IIFE bundle (`gopay-browser-sdk.min.js`) that exposes `window.GoPayBrowserSDK` for CDN use via `<script src="...">`.
- **`@gopay-internal/core`** (`internal/core/`) — private shared package; inlined into both public bundles at build time via `noExternal`, not published to npm.

---

## `cards` module — iframe-based card tokenization

`sdk.mountCardForm(container, options?)` fetches the hosted iframe URL from `GET /encryption/card-form-url`, mounts the GoPay-hosted card encryption iframe, and returns `Promise<CardFormController>`:

- **`result`** — `Promise<CardTokenResponse>` that resolves with the card token on success, rejects on error or cancellation.
- **`setTheme(theme)`** / **`setLocale(locale)`** — send runtime updates to the iframe via `postMessage`.
- **`submit()`** — triggers form submission from the parent page; only valid when `submitMode: 'external'`.
- **`isValid`** — live validity state (only populated in external submit mode).

**postMessage protocol** is defined in `sdk/src/modules/cards/iframe-protocol.ts`. This file is intentionally duplicated between this repo and `gw-ui-cc-v4`. Keep both in sync manually — types and type aliases only, no imports or logic.

**Init flow:**
1. `mountCardForm` calls `GET /encryption/card-form-url` internally to obtain the iframe URL.
2. The SDK appends the iframe (`sandbox="allow-scripts allow-forms allow-same-origin"`). `allow-same-origin` keeps the real origin so `postMessage(targetOrigin)` works; the absent `allow-top-navigation` and `allow-popups` deny those vectors.
3. On `iframe.onload`, the SDK posts `GOPAY_CARD_FORM_INIT` with tokens, environment, theme, locale, and submit mode. Target origin is the iframe's origin (derived from the card-form URL).
4. The iframe posts back `GOPAY_CARD_ENCRYPT_RESULT` (carrying the JWE payload), then the SDK calls `POST /cards/tokens` internally and resolves `result`.

**Submit modes:**
- `'internal'` (default) — iframe renders its own submit button.
- `'external'` — iframe hides its submit button; parent calls `controller.submit()` and receives `GOPAY_CARD_FORM_VALIDITY` messages.

---

## `encryption` module — intentionally absent

Card data encryption must never be performed in publicly reachable JavaScript. The public key fetch (`GET /encryption/public-key`) and JWE construction happen inside an isolated GoPay-hosted iframe served from a separate, non-public origin. Do not add an `encryption` module to this SDK.

---

## Releasing — breaking changes checklist

Before merging to master, check whether any public API changes are breaking (require a major version bump). If yes, ensure the commit message includes a `BREAKING CHANGE:` footer so semantic-release bumps the major version correctly.

Consumer-facing breaking changes (bump major):
- Removed or renamed exported functions, classes, types, or constants
- Changed method signatures (added required params, changed return types)
- Changed `window.GoPayBrowserSDK` global shape — affects `@gopaycz/gopay-js-sdk-browser` IIFE consumers on unpkg (pin to `@1`)
- Changed error codes in `GoPayErrorCodes`

**postMessage protocol** (`sdk/src/modules/cards/iframe-protocol.ts`) changes are **not** consumer-facing — the wire protocol between the SDK and the GoPay-hosted iframe is invisible to e-shops. However, they require **coordinated deployment** with `gw-ui-cc-v4`: deploy the iframe side first, or make the change backward-compatible, to avoid a compatibility gap between the two.

---

## `gw_url` — escape hatch, not a redirect target for this SDK's own flow

`createPayment()` returns a `gw_url` field. **Do not redirect to it as part of this SDK's own
flow** (create → charge: card token / Apple Pay / Google Pay), which fully covers card
payments.

`gw_url` is a deliberate escape hatch into the previous (v3) hosted-gateway processing —
reach for it when a payment needs a method or feature not yet implemented in the v4 charge
flow. Redirecting there hands off real-time control of the payment to the hosted flow while
the customer is on it, but the payment stays fully v4-observable throughout: `getPaymentStatus()`
reports the final state once the customer completes it, exactly as it would for a payment
charged directly through v4. Don't present it as unsafe or purely legacy in generated
examples. The API spec doesn't document this nuance yet — see GPOMA-2418.
