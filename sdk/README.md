# gopay-js-sdk

GoPay JavaScript SDK for browser and Node.js — wraps the GoPay Payments API v4.0.

## Installation

```bash
npm install gopay-js-sdk
# or
yarn add gopay-js-sdk
```

Browser (CDN):

```html
<script src="https://gopaycdn.com/js-sdk/gopay-sdk.min.js"></script>
```

---

## Authentication

The SDK uses OAuth2. **Client credentials (`client_id` / `client_secret`) must never be exposed in browser JavaScript.** Choose the flow that matches your deployment:

### Server-side (Node.js)

Your backend holds the credentials and authenticates directly:

```ts
import { GoPaySDK } from 'gopay-js-sdk';

const sdk = new GoPaySDK({ environment: 'production' });

await sdk.auth.authenticate({
  grant_type: 'client_credentials',
  client_id: process.env.GOPAY_CLIENT_ID,
  client_secret: process.env.GOPAY_CLIENT_SECRET,
  scope: 'payment:create',
});

// All subsequent calls attach the Bearer token automatically.
// Tokens are refreshed transparently before expiry.
const payment = await sdk.payments.create(goid, params);
```

### Browser client

The browser must never hold credentials. The recommended pattern:

1. Your **server** authenticates with GoPay and returns the `refresh_token` to the browser (e.g. via a session endpoint).
2. The **browser** passes that token to the SDK via `setRefreshToken()`.
3. On the first API call the SDK automatically exchanges the refresh token for an access token. All subsequent calls and token renewals are handled transparently.

```html
<script src="https://gopaycdn.com/js-sdk/gopay-sdk.min.js"></script>
<script>
  const sdk = new GoPaySDK.GoPaySDK({ environment: 'production' });

  // Fetch the refresh token from your server — never hardcode credentials here.
  const { refreshToken } = await fetch('/session/gopay-token').then(r => r.json());

  sdk.auth.setRefreshToken(refreshToken);

  // The SDK exchanges the refresh token and attaches the Bearer token automatically.
  const payment = await sdk.payments.create(goid, params);
</script>
```

ESM / bundler:

```ts
import { GoPaySDK } from 'gopay-js-sdk';

const sdk = new GoPaySDK({ environment: 'production' });

const { refreshToken } = await fetch('/session/gopay-token').then(r => r.json());
sdk.auth.setRefreshToken(refreshToken);

const payment = await sdk.payments.create(goid, params);
```

---

## Configuration

```ts
new GoPaySDK({
  environment: 'sandbox' | 'production', // defaults to 'sandbox'
  baseUrl: 'https://...',                // override API base URL (e.g. for tests)
})
```

---

## API

### `sdk.auth`

| Method | Description |
|---|---|
| `authenticate(params)` | Obtain an access/refresh token pair. Use `client_credentials` grant server-side or `refresh_token` grant to manually exchange a token. |
| `setRefreshToken(token)` | Seed the SDK with a refresh token obtained from your server. The first API call will exchange it automatically. |

### `sdk.payments`

| Method | Description |
|---|---|
| `create(goid, params)` | Create a new payment session (`POST /eshops/{goid}/payments`). |
| `charge(paymentId, params)` | Charge a payment using a payment instrument. |
| `getGooglePayInfo(paymentId)` | Retrieve Google Pay configuration for a payment. |
| `getApplePayInfo(paymentId)` | Retrieve Apple Pay configuration for a payment. |
| `validateApplePayMerchant(paymentId, origin)` | Validate the Apple Pay merchant session. |

### `sdk.cards`

| Method | Description |
|---|---|
| `createToken(params)` | Tokenize encrypted card data (`POST /cards/tokens`). |

### `sdk.encryption`

| Method | Description |
|---|---|
| `fetchPublicKey()` | Fetch the JWE public key for card encryption (`GET /encryption/public-key`). |

---

## Environments

| Environment | Base URL |
|---|---|
| `sandbox` | `https://api.sandbox.gopay.com/api/merchant/payments/4.0` |
| `production` | `https://api.gopay.com/api/merchant/payments/4.0` |
