# gp-gw-js-sdk

Monorepo for the [gopay-js-sdk](sdk/) npm package — a JavaScript/TypeScript SDK for the GoPay Payments API v4.0.

> **Integrating the SDK?** See [sdk/README.md](sdk/README.md).

## Structure

```
gp-gw-js-sdk/
├── sdk/                  # npm package (gopay-js-sdk)
│   ├── src/              # TypeScript source
│   ├── tests/            # Unit + E2E tests (vitest)
│   └── dist/             # Build output (git-ignored)
├── tests/browser/        # Playwright browser tests
├── example/              # Demo page (loads sdk/dist/gopay-sdk.min.js)
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
yarn test:browser

# Start the example dev server
yarn example
```

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

Write commits following the [Conventional Commits](https://www.conventionalcommits.org/) spec:

| Prefix             | Version bump | Example                          |
|--------------------|--------------|----------------------------------|
| `fix:`             | patch        | `fix: handle null card_id`       |
| `feat:`            | minor        | `feat: add refund support`       |
| `BREAKING CHANGE:` | major        | `feat!: rename GoPaySDK to ...`  |

On merge to `master` the pipeline will:
1. Determine the next version from commit history
2. Update `package.json` and `CHANGELOG.md`
3. Create a git tag
4. Publish to npm
5. Upload the IIFE bundle to gopaycdn.com

## License

MIT
