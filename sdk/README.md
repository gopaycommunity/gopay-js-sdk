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

## Quick start

```ts
import { GoPaySDK } from 'gopay-js-sdk';

const sdk = new GoPaySDK({ environment: 'production' });

// Authenticate (server-side only — never expose credentials in the browser)
await sdk.auth.authenticate({
  grant_type: 'client_credentials',
  client_id: process.env.GOPAY_CLIENT_ID,
  client_secret: process.env.GOPAY_CLIENT_SECRET,
  scope: 'payment:create',
});

// Create a payment session
const payment = await sdk.payments.create('YOUR_GOID', {
  amount: 1000, // CZK 10.00
  currency: 'CZK',
  order_number: 'ORDER-001',
  customer: { email: 'customer@example.com' },
  callback: {
    notification_url: 'https://yourshop.com/notify',
    return_url: 'https://yourshop.com/return',
  },
});

// Redirect the customer to complete payment
res.redirect(payment.gw_url);
```

### Charging a payment

Once the customer completes the payment flow and returns to your site, charge the payment using the instrument they provided:

```ts
// Card token (obtained via sdk.cards.createToken())
const charge = await sdk.payments.charge(payment.id, {
  payment_instrument: {
    payment_instrument: 'PAYMENT_CARD',
    input: {
      input_type: 'CARD_TOKEN',
      card_token: cardToken,
      challenge_preferrence: 'AUTO',
    },
  },
  return_url: 'https://yourshop.com/return',
});

// For bank account payments, use BANK_ACCOUNT with an account token:
// payment_instrument: { payment_instrument: 'BANK_ACCOUNT', input: { input_type: 'ACCOUNT_TOKEN', account_token: '...' } }

if (charge.action?.redirect_url) {
  // 3DS or PSD2 authentication required — redirect the customer
  res.redirect(charge.action.redirect_url);
}
```

---

## Authentication

The SDK uses OAuth2. **Client credentials (`client_id` / `client_secret`) must never be exposed in browser JavaScript.** Choose the flow that matches your deployment:

### Server-side (Node.js) — `authenticate()` must never run in the browser

Your backend holds the credentials. Call `authenticate()` once on startup — the SDK stores the token and refreshes it transparently before expiry:

```ts
import { GoPaySDK } from 'gopay-js-sdk';

const sdk = new GoPaySDK({ environment: 'production' });

await sdk.auth.authenticate({
  grant_type: 'client_credentials',
  client_id: process.env.GOPAY_CLIENT_ID,
  client_secret: process.env.GOPAY_CLIENT_SECRET,
  scope: 'payment:create payment:read',
});

// All subsequent calls attach the Bearer token automatically.
const payment = await sdk.payments.create(goid, params);
```

### Browser client

Credentials must never leave the server. The SDK provides a two-step handoff:

1. **Server** calls `issueClientToken()` — obtains a fresh token pair for every browser client without touching its own session. The browser may use a **narrower scope** than the server.
2. **Server** returns the `ClientToken` to the browser (e.g. via a session endpoint).
3. **Browser** calls `setClientToken()` — seeds the SDK with both tokens. The `client_id` is extracted automatically from the JWT; no credentials are needed in the browser.
4. All subsequent browser API calls use the access token directly, renewing via the refresh token transparently before expiry. The browser should finish it's business before refreshToken expires (usually 24 hrs) because it can't renew it. Else you need to provide a mechanism to get new client tokens.

```ts
// Server: issue a fresh token pair for the browser
app.get('/session/gopay-token', async (req, res) => {
  // Protect this endpoint with your own session check
  const clientToken = await sdk.auth.issueClientToken('payment:create');
  res.json(clientToken);
});
```

```html
<!-- Browser (IIFE) -->
<script src="https://gopaycdn.com/js-sdk/gopay-sdk.min.js"></script>
<script>
  const browserSdk = new GoPaySDK.GoPaySDK({ environment: 'production' });

  // Fetch the token pair from your server — never hardcode credentials here.
  const clientToken = await fetch('/session/gopay-token').then(r => r.json());

  // client_id is extracted automatically from the JWT access_token.
  browserSdk.auth.setClientToken(clientToken);

  // SDK is now authenticated — make API calls as normal.
</script>
```

ESM / bundler:

```ts
import { GoPaySDK } from 'gopay-js-sdk';

const browserSdk = new GoPaySDK({ environment: 'production' });

const clientToken = await fetch('/session/gopay-token').then(r => r.json());
browserSdk.auth.setClientToken(clientToken);

// SDK is now authenticated — make API calls as normal.
```

---

## Configuration

| Option                | Type                                              | Default     | Description                                                                              |
|-----------------------|---------------------------------------------------|-------------|------------------------------------------------------------------------------------------|
| `environment`         | `'sandbox' \| 'production'`                       | `'sandbox'` | Target environment.                                                                      |
| `baseUrl`             | `string`                                          | _(see below)_ | Override the API base URL (e.g. for mock servers). Takes precedence over `environment`. |
| `requestTimeoutMs`    | `number`                                          | `10000`     | Per-request timeout in milliseconds. Throws `GoPaySDKError` with `errorCode: 'NETWORK_TIMEOUT'` on expiry. |
| `debugLoggingEnabled` | `boolean`                                         | `false`     | Logs `→ METHOD URL` / `← STATUS URL` for every request via `console.debug`.             |
| `onError`             | `(error: GoPaySDKError \| GoPayHTTPError) => void` | —           | Called synchronously for every error the SDK throws. Useful for centralised logging or alerting. |

```ts
const sdk = new GoPaySDK({
  environment: 'production',
  requestTimeoutMs: 5000,
  debugLoggingEnabled: true,
  onError(err) {
    Sentry.captureException(err);
  },
});
```

---

## API

### `sdk.auth`

| Method | Description |
|---|---|
| `authenticate(params)` | Server-side: obtain an access/refresh token pair using `client_credentials`. Stores the token internally for automatic refresh. |
| `issueClientToken(scope?)` | Server-side: obtain a fresh token pair for a browser client without affecting the server session. Use a narrower `scope` if the browser only needs a subset of permissions. |
| `setClientToken(token)` | Browser-side: seed the SDK with a `ClientToken` obtained from the server. Extracts `client_id` automatically from the JWT `access_token`. |
| `isAuthenticated()` | Returns `true` if a token is currently stored. Does not check expiry — expired tokens are refreshed transparently on the next API call. |
| `logout()` | Clear all stored tokens and credentials. All subsequent API calls will throw until the SDK is re-authenticated. |

### `sdk.payments`

| Method | Description |
|---|---|
| `create(goid, params)` | Create a new payment session (`POST /eshops/{goid}/payments`). |
| `charge(paymentId, params)` | Charge a payment using a payment instrument (`POST /payments/{paymentId}/charge`). |
| `getGooglePayInfo(paymentId)` | Retrieve Google Pay configuration for a payment. |
| `getApplePayInfo(paymentId)` | Retrieve Apple Pay configuration for a payment (`applepayVersion`, `merchantIdentifier`, `applePayPaymentRequest`). |
| `validateApplePayMerchant(paymentId, origin)` | Validate the Apple Pay merchant session. Must be called from inside `onvalidatemerchant`; pass `window.location.origin` as `origin`. |
| `getQRPaymentInfo(paymentId, format?)` | Retrieve QR code and recipient info (`GET /payments/{paymentId}/qr-payment/info`). |

### Google Pay

```ts
// Fetch Google Pay configuration for this payment.
// googlePayInfo contains:
//   environment        — "TEST" or "PRODUCTION", passed to PaymentsClient
//   paymentDataRequest — pre-filled PaymentRequest object (allowed networks,
//                        transaction info, merchant info, etc.) ready to pass
//                        to loadPaymentData()
const googlePayInfo = await sdk.payments.getGooglePayInfo(payment.id);

// Initialise the Google Pay client and request payment data.
const paymentsClient = new google.payments.api.PaymentsClient({
  environment: googlePayInfo.environment, // "TEST" | "PRODUCTION"
});
const paymentData = await paymentsClient.loadPaymentData(
  googlePayInfo.paymentDataRequest,
);

// paymentData.paymentMethodData.tokenizationData.token is an opaque string
// whose internal structure is tokenization-method-dependent (DIRECT tokens
// follow the { protocolVersion, signature, signedMessage } shape; PAYMENT_GATEWAY
// tokens are gateway-defined). Do not parse or inspect it — pass it unchanged
// to google_pay_token and let GoPay's backend handle parsing.
const charge = await sdk.payments.charge(payment.id, {
  payment_instrument: {
    payment_instrument: 'PAYMENT_CARD',
    input: {
      input_type: 'GOOGLE_PAY',
      google_pay_token: paymentData.paymentMethodData.tokenizationData.token,
    },
  },
  return_url: 'https://yourshop.com/return',
});
```

### Apple Pay

> **Safari only.** `ApplePaySession` is available exclusively in Safari on Apple
> devices. In other browsers the example page loads `apple-pay-polyfill.js`
> (a dev-only stub) so the flow can be exercised without a real device.

```ts
// Fetch Apple Pay configuration for this payment.
// applePayInfo contains:
//   applepayVersion          — Apple Pay JS API version to pass to ApplePaySession
//   merchantIdentifier       — your registered Apple Pay merchant ID
//   applePayPaymentRequest   — pre-filled PaymentRequest object (networks, country,
//                              currency, total, etc.) ready to pass to ApplePaySession
const applePayInfo = await sdk.payments.getApplePayInfo(payment.id);

// Create the session with the version and request object returned above.
const session = new ApplePaySession(
  applePayInfo.applepayVersion,
  applePayInfo.applePayPaymentRequest,
);

// Step 1 — Merchant validation (server-to-server trust handshake).
// The browser fires onvalidatemerchant as soon as begin() is called.
// GoPay contacts Apple's servers on your behalf using your merchant certificate
// and returns an opaque merchantSession token that unlocks the payment sheet.
session.onvalidatemerchant = async (event) => {
  // event.validationURL is provided by Apple; the SDK forwards it to GoPay.
  const merchantSession = await sdk.payments.validateApplePayMerchant(
    payment.id,
    window.location.origin, // origin of the page showing the Apple Pay button
  );
  session.completeMerchantValidation(merchantSession);
};

// Step 2 — Payment authorisation.
// Fires after the user authenticates with Face ID / Touch ID.
// event.payment.token.paymentData is an Apple-encrypted blob — pass it to charge().
session.onpaymentauthorized = async (event) => {
  const token = event.payment.token.paymentData;
  const charge = await sdk.payments.charge(payment.id, {
    payment_instrument: {
      payment_instrument: 'PAYMENT_CARD',
      input: {
        input_type: 'APPLE_PAY',
        data: token.data,
        signature: token.signature,
        version: token.version,
        header: token.header,
      },
    },
    return_url: 'https://yourshop.com/return',
  });
  // Tell the sheet to show a success or failure animation, then close.
  session.completePayment(
    charge.state === 'SUCCEEDED'
      ? ApplePaySession.STATUS_SUCCESS
      : ApplePaySession.STATUS_FAILURE,
  );
};

// Step 3 — Cancellation.
// Fires when the user dismisses the sheet without paying.
session.oncancel = () => {
  // Update your UI to reflect the cancelled state.
};

// Opens the Apple Pay sheet and triggers the merchant-validation handshake.
session.begin();
```

### QR Payment

```ts
const qrInfo = await sdk.payments.getQRPaymentInfo(payment.id);
// Optionally request SVG format instead of the default PNG:
// const qrInfo = await sdk.payments.getQRPaymentInfo(payment.id, 'svg');

// Display the QR code (currency-specific)
const img = document.createElement('img');
img.src = `data:image/png;base64,${qrInfo.qr_code?.spayd}`;        // CZK — Czech SPAYD
// img.src = `data:image/png;base64,${qrInfo.qr_code?.paybysquare}`; // EUR — Slovak PayBySquare
// img.src = `data:image/png;base64,${qrInfo.qr_code?.sepa}`;        // EUR — SEPA (EPC)
// img.src = `data:image/png;base64,${qrInfo.qr_code?.mnb_qr}`;      // HUF — Hungarian MNB
document.body.appendChild(img);
```

---

### `sdk.cards`

| Method | Description |
|---|---|
| `createToken(params)` | Tokenize encrypted card data (`POST /cards/tokens`). |

### Card data encryption

`GET /encryption/public-key` and the JWE construction it enables are **intentionally not part of this SDK's API surface**.

Card number encryption must never run in publicly reachable JavaScript — doing so would expose the raw PAN to any script on the merchant's page. The correct approach is to use secure iframe supplied by GoPay. Do not use the `sdk/src/iframe/card-encrypt.html` stub in production or testing.

---

## Errors

The SDK throws two typed error classes so you can handle them precisely.

### `GoPaySDKError`

Thrown for lifecycle and configuration errors — e.g. no token available, token refresh failed, or an invalid token response was received.

Every `GoPaySDKError` carries a machine-readable `errorCode` from the `GoPayErrorCodes` constant:

| `errorCode` | When thrown |
|---|---|
| `AUTH_TOKEN_MISSING` | A protected API call was made before authenticating. |
| `AUTH_REFRESH_TOKEN_MISSING` | Token expired and no refresh token is stored. |
| `AUTH_REFRESH_FAILED` | Token refresh request failed (network or API error). |
| `AUTH_INVALID_RESPONSE` | The OAuth2 endpoint returned an incomplete token response. |
| `AUTH_CREDENTIALS_MISSING` | `issueClientToken()` called without prior `authenticate()`. |
| `AUTH_INVALID_TOKEN` | `setClientToken()` received a JWT without a valid `sub` claim. |
| `AUTH_UNAUTHORIZED` | Still 401 after a successful token refresh — check OAuth2 scopes. |
| `NETWORK_TIMEOUT` | Request exceeded `requestTimeoutMs`. |
| `NETWORK_ERROR` | Network-level failure (no response received). |

```ts
import { GoPaySDKError, GoPayErrorCodes } from 'gopay-js-sdk';

try {
  await sdk.payments.create(goid, params);
} catch (err) {
  if (err instanceof GoPaySDKError) {
    if (err.errorCode === GoPayErrorCodes.AUTH_TOKEN_MISSING) {
      // redirect to login
    } else if (err.errorCode === GoPayErrorCodes.NETWORK_TIMEOUT) {
      // show retry UI
    } else {
      console.error('SDK error:', err.message);
    }
  }
}
```

### `GoPayHTTPError`

Thrown when the GoPay API returns a non-2xx response. Exposes the HTTP `status` code and the parsed response `body`.

```ts
import { GoPayHTTPError } from 'gopay-js-sdk';

try {
  await sdk.auth.authenticate({ grant_type: 'client_credentials', ... });
} catch (err) {
  if (err instanceof GoPayHTTPError) {
    console.error(`HTTP ${err.status}`, err.body);
  }
}
```

| Property | Type | Description |
|---|---|---|
| `status` | `number` | HTTP status code (e.g. `401`, `422`). |
| `body` | `unknown` | Parsed JSON response body, or raw text if JSON parsing failed. |

### Centralised error handling with `onError`

Pass an `onError` callback to the SDK config to intercept every error in one place — useful for logging or alerting — without replacing per-call `catch` blocks:

```ts
const sdk = new GoPaySDK({
  environment: 'production',
  onError(err) {
    analytics.track('gopay_error', { code: err instanceof GoPaySDKError ? err.errorCode : err.status });
  },
});
```

The callback fires synchronously before the error propagates to the caller.

---

## Environments

| Environment | Base URL |
|---|---|
| `sandbox` | `https://api.sandbox.gopay.com/api/merchant/payments/4.0` |
| `production` | `https://api.gopay.com/api/merchant/payments/4.0` |

---

## Interactive example

An interactive developer page is included in the repository. It exercises every SDK method against the real API.
