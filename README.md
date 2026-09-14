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
└── Payments.yaml         # OpenAPI 3.1 snapshot written by codegen — it reads a URL or local path, never this file
```

> **On `Payments.yaml`** — this is a maintainer-facing snapshot of the OpenAPI document, kept in
> the repo for reference. It is not part of either published npm package, and it is not the
> integration reference. For the authoritative published spec, the base URLs to integrate
> against, and the long-form guides, see [api-docs.gopay.com](https://api-docs.gopay.com/).

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

The example dev server runs on HTTPS. Without a certificate it falls back to a
self-signed one that browsers do not trust. Install
[mkcert](https://github.com/FiloSottile/mkcert) and run once:

```bash
brew install mkcert
yarn workspace gopay-js-sdk-example cert:install   # needs sudo for the macOS Keychain
yarn workspace gopay-js-sdk-example cert:check     # → OK
```

Certificates land in `example/certs/` (git-ignored) and the dev server picks
them up on the next `yarn example`.

### Serving under a hostname instead of localhost

**Required to test against production.** The production edge rejects any request
whose body mentions a loopback or private-network host — `localhost`,
`127.0.0.1`, `0.0.0.0`, `192.168.*` — with a bare `403` from the load balancer,
before it reaches the API. The example builds `notification_url` and
`return_url` from `window.location.origin`, so on `https://localhost:8080` every
`createPayment()` against production fails with an error that looks like an auth
problem. Sandbox is unaffected.

Pick a hostname you own, or any name that is not loopback-shaped, and point it
at your machine:

```bash
# 1. Resolve it locally
echo '127.0.0.1 dev.example.com' | sudo tee -a /etc/hosts

# 2. Issue a cert covering it (also covers localhost and 127.0.0.1)
GP_DEV_HOSTNAME=dev.example.com yarn workspace gopay-js-sdk-example cert:install

# 3. Start the example and open https://dev.example.com:8080
yarn example
```

The dev server discovers whatever certificate is in `example/certs/`, preferring
a hostname certificate over a loopback-only one, and allows that hostname
through its CORS check automatically. Nothing is hard-coded — the three
environment variables below override the defaults if you need them:

| Variable | Default | Purpose |
| --- | --- | --- |
| `GP_DEV_HOSTNAME` | `localhost` | Extra hostname `cert:install` puts in the certificate |
| `GP_DEV_HOST` | `127.0.0.1` | Address the dev server binds to |
| `GP_DEV_CERT`, `GP_DEV_CERT_KEY` | — | Use a specific certificate instead of discovery |

`GP_DEV_HOST` defaults to IPv4 on purpose: Vite's own default resolves
`localhost` to `::1` on macOS and binds IPv6 only, which leaves a conventional
`127.0.0.1` entry in `/etc/hosts` refusing connections. `https://localhost:8080`
still works either way — browsers fall back to IPv4.

## Running the example page with Docker

Build and start the container:

```bash
yarn docker
```

By default the SDK connects directly to the GoPay sandbox from the browser.

The example page is served on [http://localhost:8080](http://localhost:8080).

## License

MIT
