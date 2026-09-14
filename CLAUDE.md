## API Spec & Code Generation

TypeScript types are generated from the **next spec** — the upcoming version of the GoPay
Payments API spec, ahead of what the published reference at `https://api-docs.gopay.com/`
shows. That is why the SDK's types can describe fields the public docs don't mention yet.

### Two ways to get the next spec

1. **GoPay's internal pre-release feed.** GoPay serves the next spec from an internal
   environment:

   ```
   https://payments-api.beta.gopay.com/spec/en/payments.yaml
   ```

   Reachable only from inside GoPay — the host resolves to a private address behind an
   internal load balancer, and the environment is shut down overnight and at weekends, so a
   404 or a timeout out of hours is expected rather than an outage.

2. **Sideload from the API spec repo.** Check the spec repo out at the commit you want and
   point codegen at the local file. Use this when the internal environment is unavailable,
   or when you need types generated against one specific spec commit rather than whatever
   the feed happens to be serving.

### Running codegen

The source is **not hardcoded**. Pass it as `SPEC_SOURCE` (or as the first argument) — a URL
or a local path:

```bash
cd internal/core

# 1. internal feed (URL above)
SPEC_SOURCE=https://payments-api.beta.gopay.com/spec/en/payments.yaml yarn codegen

# 2. sideload from a spec repo checkout
SPEC_SOURCE=../../../gopay-payments-api-v4/spec/payments.yaml yarn codegen

# outputs: internal/core/src/types/generated.ts
```

### This file is the only place the internal hostname belongs

`payments-api.beta.gopay.com` is an internal GoPay hostname. The word "beta" in it names the
environment the spec is authored on — it says nothing about the maturity of Payments API v4
or the stability of this SDK, both of which are GA. Nobody outside GoPay can tell that apart,
and nobody outside GoPay can reach the host to find out, so to an integrator the word reads
as a product-status warning on the thing they are about to integrate.

Keep it in this file and nowhere else. In particular:

- **Not in code or config** — hence `SPEC_SOURCE` rather than a URL baked into
  `internal/core/package.json`.
- **Not in `README.md`, `sdk/README.md`, `browser-sdk/README.md`, `src/`, or either
  `CHANGELOG.md`.** Reference the public spec at `https://api-docs.gopay.com/` instead.
- **Not in commit subjects.** semantic-release copies every `fix:` / `feat:` subject verbatim
  into `CHANGELOG.md`, and this repo is mirrored to the public `gopaycommunity/gopay-js-sdk`,
  so a subject naming the feed becomes a permanent public changelog line.

### Commit convention for spec updates

When a change comes from a new spec, the subject is:

```
fix: update api from next spec GPOMA-xxxx
```

Say that and nothing about where the bytes came from — not the hostname, not which of the two
sources was used, not "beta". If the update genuinely breaks consumers, the `BREAKING CHANGE:`
footer still carries that (see *Releasing* below); the footer describes the API change, not
the spec source.

### `Payments.yaml` snapshot

Codegen writes [Payments.yaml](Payments.yaml) from `SPEC_SOURCE` and then generates the types
from that file, so both come from one fetch of one source rather than from two independent
ones.

The two steps are sequential, not atomic: the snapshot is written first, so if
`openapi-typescript` then fails you are left with a refreshed `Payments.yaml` beside an
unchanged `generated.ts`. Re-run codegen against the same source to finish the job — don't
hand-edit either file to close the gap.

It **strips the Prism mock server** the feed injects as `servers[0]`, and fails rather than
generate if a mock reference survives. The mock server itself is fine and stays where it runs
— it is what makes "Try It" work in the Elements docs UI — but it must never reach a vendored
spec file: `servers[0]` is the default base URL for any OpenAPI tooling that opens
`Payments.yaml`, the published spec lists only Sandbox and Production, and this repo is
mirrored publicly. The PHP SDK does the same in its `scripts/codegen.sh`.

**Never pass `Payments.yaml` itself as `SPEC_SOURCE`.** The snapshot lags the feed, so
regenerating from it silently rolls the types back — it drops endpoints added since the last
refresh and reverts prose corrections made in the spec. It is an output, not a source.

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

**postMessage protocol** is defined in `browser-sdk/src/modules/cards/iframe-protocol.ts`. This file is intentionally duplicated between this repo and `gw-ui-cc-v4`. Keep both in sync manually — types and type aliases only, no imports or logic.

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

## Releasing — both packages are pinned to 1.x

Both packages deliberately stay on the **1.x line**. `releaseRules: [{ breaking: true, release: 'minor' }]` in both `release.config.mjs` files maps a breaking commit to a **minor** bump instead of a major one, so no commit can push either package to 2.x. This keeps `@1` range-pins (notably the unpkg IIFE consumers) valid indefinitely.

Still add a `BREAKING CHANGE:` footer when a change genuinely breaks consumers — `release-notes-generator` reads the same parsed note, so the BREAKING CHANGES section still lands in `CHANGELOG.md` and the release notes. That section is how consumers find out; only the version arithmetic is capped.

Be aware this is a deliberate departure from strict semver: a minor bump can carry a breaking change. Weigh that when a change would break consumers at runtime rather than only at compile time — prefer making it backward-compatible instead of relying on the note.

Consumer-facing breaking changes (call these out in the footer):
- Removed or renamed exported functions, classes, types, or constants
- Changed method signatures (added required params, changed return types)
- Changed `window.GoPayBrowserSDK` global shape — affects `@gopaycz/gopay-js-sdk-browser` IIFE consumers on unpkg (pin to `@1`)
- Changed error codes in `GoPayErrorCodes`

**postMessage protocol** (`browser-sdk/src/modules/cards/iframe-protocol.ts`) changes are **not** consumer-facing — the wire protocol between the SDK and the GoPay-hosted iframe is invisible to e-shops. However, they require **coordinated deployment** with `gw-ui-cc-v4`: deploy the iframe side first, or make the change backward-compatible, to avoid a compatibility gap between the two.

---

## `gw_url` — GoPay's hosted gateway, not a v3 escape hatch

`createPayment()` returns a `gw_url` field. **Do not redirect to it as part of this SDK's own
flow** (create → charge: card token / Apple Pay / Google Pay), which fully covers card
payments.

**What it is:** the full GoPay hosted payment gateway, offering the customer every payment
method the eshop has enabled. **The reason not to send the customer there** is that the
hosted gateway cannot be embedded in the merchant's own checkout — *not* that v4 is missing
a method, and *not* that the endpoint is legacy.

Earlier revisions of this file and of the spec framed it as "a deliberate escape hatch into
the previous (v3) hosted-gateway processing", reached for when v4 lacks a method. That is
wrong on both counts and was corrected across the spec repo in GPOMA-2591 — the published
types no longer carry the escape-hatch wording. Don't reintroduce it, and don't present
`gw_url` as unsafe, legacy, or a compatibility shim in docs or generated examples.

A payment sent there stays fully v4-observable: `getPaymentStatus()` reports the final state
once the customer completes it, exactly as for a payment charged directly through v4.

**Recurrences are the exception.** `startRecurrence()` returns a payment whose `gw_url` is
where the customer pays the first payment, and the recurrence does not reach `STARTED` until
they do — so there, handing out `gw_url` is the intended flow, not an escape hatch.
