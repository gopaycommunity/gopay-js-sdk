# gp-gw-js-sdk

[![npm](https://img.shields.io/npm/v/@gopaycz/gopay-js-sdk)](https://www.npmjs.com/package/@gopaycz/gopay-js-sdk)
[![npm (browser)](https://img.shields.io/npm/v/@gopaycz/gopay-js-sdk-browser?label=npm%20%28browser%29)](https://www.npmjs.com/package/@gopaycz/gopay-js-sdk-browser)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=gp-gopay_gp-gw-js-sdk&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=gp-gopay_gp-gw-js-sdk)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=gp-gopay_gp-gw-js-sdk&metric=coverage)](https://sonarcloud.io/summary/new_code?id=gp-gopay_gp-gw-js-sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Monorepo for the GoPay JavaScript SDKs — two npm packages wrapping the GoPay Payments API v4.0.

> **This is the SDK source repo.** For production, install the published packages — [`@gopaycz/gopay-js-sdk-browser`](https://www.npmjs.com/package/@gopaycz/gopay-js-sdk-browser) (browser) and [`@gopaycz/gopay-js-sdk`](https://www.npmjs.com/package/@gopaycz/gopay-js-sdk) (server) — not this repo. See [browser-sdk/README.md](browser-sdk/README.md) / [sdk/README.md](sdk/README.md) for install & usage.

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
├── example/              # Interactive developer page
└── Payments.yaml         # OpenAPI 3.1 spec (source of truth)
```

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

By default the SDK connects directly to the GoPay sandbox from the browser.

The example page is served on [http://localhost:8080](http://localhost:8080).

## License

MIT
