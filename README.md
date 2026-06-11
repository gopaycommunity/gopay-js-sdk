# gp-gw-js-sdk

Monorepo for the GoPay JavaScript SDKs — two npm packages wrapping the GoPay Payments API v4.0.

> **Integrating the server SDK?** See [sdk/README.md](sdk/README.md).\
> **Integrating the browser SDK?** See [browser-sdk/README.md](browser-sdk/README.md).

## Structure

```
gp-gw-js-sdk/
├── sdk/                  # npm: @gopaycz/gopay-js-sdk (server-side / Node.js)
│   ├── src/              # TypeScript source
│   ├── tests/            # Unit + E2E tests (vitest)
│   └── dist/             # Build output (git-ignored)
├── browser-sdk/          # npm: @gopaycz/gopay-js-sdk-browser (in-browser payments)
│   ├── src/              # TypeScript source
│   ├── tests/            # Unit tests (vitest)
│   └── dist/             # Build output — includes IIFE for CDN use (git-ignored)
├── internal/core/        # Private shared package — inlined into both SDKs at build time, not published
├── tests/browser/        # Playwright end-to-end tests
├── example/              # Interactive developer page (private, not published)
└── Payments.yaml         # OpenAPI 3.1 spec (source of truth)
```

## Releasing — breaking changes checklist

Before merging to master, check whether any public API changes are breaking (require a major version bump). If yes, ensure the commit message includes a `BREAKING CHANGE:` footer so semantic-release bumps the major version correctly.

Consumer-facing breaking changes (bump major):
- Removed or renamed exported functions, classes, types, or constants
- Changed method signatures (added required params, changed return types)
- Changed `window.GoPayBrowserSDK` global shape — affects `@gopaycz/gopay-js-sdk-browser` IIFE consumers pinned via unpkg (`@1`)
- Changed error codes in `GoPayErrorCodes`

**postMessage protocol** (`sdk/src/modules/cards/iframe-protocol.ts`) changes are **not** consumer-facing — the wire protocol between the SDK and the GoPay-hosted iframe is invisible to e-shops. However, they require **coordinated deployment** with `gw-ui-cc-v4`: deploy the iframe side first, or make the change backward-compatible, to avoid a compatibility gap between the two.

## Development

```bash
# Setup
corepack enable
yarn install

# Build the SDK
cd sdk && yarn build

# Unit tests + coverage
cd sdk && yarn test

# Type check
cd sdk && yarn typecheck

# Lint (from repo root)
yarn lint

# Run all checks as CI would (lint + typecheck)
yarn ci

# Browser (Playwright) tests — builds the SDK first
yarn test:e2e

# Start the example dev server
yarn example
```

## Local HTTPS (mkcert)

The example dev server runs on HTTPS. Without setup it falls back to a self-signed cert (untrusted by browsers). For a properly trusted cert, install [mkcert](https://github.com/FiloSottile/mkcert) and run once:

```bash
# Install mkcert if not already present
brew install mkcert

# Generate and trust a localhost cert (requires sudo for Keychain on macOS)
yarn workspace gopay-js-sdk-example cert:install

# Verify the CA is trusted
yarn workspace gopay-js-sdk-example cert:check
# → OK
```

This generates `example/certs/localhost.pem` and `example/certs/localhost-key.pem` (git-ignored). The dev server picks them up automatically on next `yarn example`.

## Running the example page with Docker

Build and start the container:

```bash
yarn docker
```

By default the SDK connects directly to the GoPay sandbox from the browser. To point at a different API environment, pass `GP_GW_JS_SDK_BASE_URL` at build time:

```bash
docker build --build-arg GP_GW_JS_SDK_BASE_URL=https://gw.alpha8.dev.gopay.com/api/merchant/payments/4.0 -t gopay-js-sdk-example:latest .
yarn docker:start
```

The example page is served on [http://localhost:8080](http://localhost:8080).

## Browser tests

Playwright tests in `tests/browser/` run against the IIFE bundle served from `example/index.html`.
Credentials and base URL are read from `sdk/.env.e2e`:

```
GP_GW_JS_SDK_BASE_URL=https://api.sandbox.gopay.com/api/merchant/payments/4.0
GP_GW_JS_SDK_CLIENT_ID=your-client-id
GP_GW_JS_SDK_CLIENT_SECRET=your-client-secret
```

## Code generation

API types are generated from `Payments.yaml`:

```bash
cd sdk && yarn codegen
```

## Releasing

Releases are fully automated via [semantic-release](https://semantic-release.gitbook.io/semantic-release/) on the `master` branch.

`@gopaycz/gopay-js-sdk` (server SDK) analyzes **all** commits and bumps on every releasable change. Its version is used as the Docker image tag (`repo.gopay.com/gp-gw-js-sdk:<version>`) — the image bundles both SDKs, so the tag must advance whenever either one changes.

`@gopaycz/gopay-js-sdk-browser` only releases when `browser-sdk/` files changed. A server-SDK bump without a browser bump is therefore normal.

| Package | Tag format | npm |
|---|---|---|
| `@gopaycz/gopay-js-sdk` | `1.3.5` | [npmjs.com/package/@gopaycz/gopay-js-sdk](https://www.npmjs.com/package/@gopaycz/gopay-js-sdk) |
| `@gopaycz/gopay-js-sdk-browser` | `browser-sdk-1.0.0` | [npmjs.com/package/@gopaycz/gopay-js-sdk-browser](https://www.npmjs.com/package/@gopaycz/gopay-js-sdk-browser) |

### Pipeline secrets

The pipeline requires three Bitbucket repository secrets:

| Secret | Purpose |
|---|---|
| `NPM_PUSH_TOKEN` | npm token for publishing to registry |
| `BITBUCKET_BOT_PUSH_TOKEN` | Bitbucket token for pushing the release commit back to master |
| `GITHUB_PERSONAL_ACCESS_TOKEN` | GitHub token for syncing to the GitHub mirror |

To create or rotate `NPM_PUSH_TOKEN`, generate a Granular Access Token on the `janmuller` npm account:

```bash
npm token create --name "bitbucket-ci" --scopes @gopaycz --packages-and-scopes-permission read-write --bypass-2fa
```

`--bypass-2fa` is required — without it the publish step will block waiting for interactive 2FA.

### Commit format

Write commits following the [Conventional Commits](https://www.conventionalcommits.org/) spec:

| Prefix             | Version bump | Example                          |
|--------------------|--------------|----------------------------------|
| `fix:`             | patch        | `fix: handle null card_id`       |
| `feat:`            | minor        | `feat: add refund support`       |
| `BREAKING CHANGE:` | major        | `feat!: rename GoPaySDK to ...`  |

## License

MIT
