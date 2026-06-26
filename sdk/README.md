# @gopaycz/gopay-js-sdk

GoPay JavaScript SDK for server-side use (Node.js) — wraps the GoPay Payments API v4.0.

> **Building a browser integration?** Use [`@gopaycz/gopay-js-sdk-browser`](../browser-sdk/README.md) — it handles in-browser card encryption, direct-charge flows, and exposes an IIFE bundle for CDN use.

## Installation

```bash
npm install @gopaycz/gopay-js-sdk
# or
yarn add @gopaycz/gopay-js-sdk
```

---

## Quick start

```ts
import { createGoPaySDK } from '@gopaycz/gopay-js-sdk';

const sdk = createGoPaySDK({ environment: 'production' });

// Authenticate (server-side only — never expose credentials in the browser)
await sdk.authenticate({
  grant_type: 'client_credentials',
  client_id: process.env.GOPAY_CLIENT_ID,
  client_secret: process.env.GOPAY_CLIENT_SECRET,
  scope: 'payment:write',
});

// Create a payment session
const payment = await sdk.createPayment('YOUR_GOID', {
  amount: 1000, // CZK 10.00
  currency: 'CZK',
  order_number: 'ORDER-001',
  customer: { email: 'customer@example.com' },
  callback: {
    notification_url: 'https://yourshop.com/notify',
    return_url: 'https://yourshop.com/return',
  },
});

// Use payment.id to charge via card token, Apple Pay, Google Pay, etc.
// See sdk.chargePayment() below.
```

### Charging a payment

Once the customer completes the payment flow and returns to your site, charge the payment using the instrument they provided:

```ts
// Card token (obtained via sdk.mountCardForm() — returns an object, use .token)
const charge = await sdk.chargePayment(payment.id, {
  payment_instrument: {
    payment_instrument: 'PAYMENT_CARD',
    input: {
      input_type: 'CARD_TOKEN',
      card_token: cardToken.token,
      challenge_preference: 'AUTO',
    },
  },
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
import { createGoPaySDK, GoPayScopes } from '@gopaycz/gopay-js-sdk';

const sdk = createGoPaySDK({ environment: 'production' });

await sdk.authenticate({
  grant_type: 'client_credentials',
  client_id: process.env.GOPAY_CLIENT_ID,
  client_secret: process.env.GOPAY_CLIENT_SECRET,
  scope: GoPayScopes.PAYMENT_WRITE + ' ' + GoPayScopes.PAYMENT_READ,
  // or: scope: combineScopes(GoPayScopes.PAYMENT_WRITE, GoPayScopes.PAYMENT_READ)
  // or just a plain string: scope: 'payment:write payment:read'
});

// All subsequent calls attach the Bearer token automatically.
const payment = await sdk.createPayment(goid, params);
```

### Scopes reference

| Scope | Constant | Used by |
|---|---|---|
| `payment:write` | `GoPayScopes.PAYMENT_WRITE` | `createPayment`, `chargePayment`, `refundPayment`, recurrences, payment links |
| `payment:read` | `GoPayScopes.PAYMENT_READ` | `getPaymentStatus`, `getChargeState`, `listRefunds`, `getRefund`, recurrence status |
| `card:write` | `GoPayScopes.CARD_WRITE` | `getBrowserKeys()` — allows the browser SDK to present the card form |
| `card:read` | `GoPayScopes.CARD_READ` | `getCardDetails`, `deleteCard` |
| `payment:charge` | `GoPayScopes.PAYMENT_CHARGE` | Browser SDK only (`attachPayment` / `payment_credentials` grant) |

For `getBrowserKeys()` to work, include both `payment:write` and `card:write` in your server-side `authenticate()` call. `shareableKey` must also be set in the SDK config (see [Browser keys](#browser-keys) below).

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
const sdk = createGoPaySDK({
  environment: 'production',
  requestTimeoutMs: 5000,
  debugLoggingEnabled: true,
  onError(err) {
    Sentry.captureException(err);
  },
});
```

---

## Promise-based API

All SDK methods return Promises. Use `async/await` or `.then()/.catch()` — there are no `onSuccess` / `onError` callback parameters on individual calls.

Handle errors with `try/catch`. The SDK throws two typed error classes (`GoPaySDKError`, `GoPayHTTPError`) that you can import and `instanceof`-check — see [Errors](#errors). TypeScript types for all request and response shapes are exported from the package; your editor will show them inline.

```ts
try {
  const payment = await sdk.createPayment(goid, params);
} catch (err) {
  if (err instanceof GoPayHTTPError) { /* API error — check err.status and err.body */ }
  if (err instanceof GoPaySDKError)  { /* SDK lifecycle error — check err.errorCode */ }
}
```

The `onError` config option (see [Configuration](#configuration)) intercepts every error centrally — useful for logging — but does not replace `try/catch`.

The one exception is `startApplePaySession`: it returns `void` instead of a Promise and accepts an optional `callbacks.oncancel`, because the Apple Pay cancel event fires natively on the `ApplePaySession` object rather than through promise rejection.

---

## API

### Authentication

| Method | Description |
|---|---|
| `authenticate(params)` | Server-side: obtain an access/refresh token pair using `client_credentials`. Stores the token internally for automatic refresh. |
| `isAuthenticated()` | Returns `true` if a token is currently stored. Does not check expiry — expired tokens are refreshed transparently on the next API call. |
| `logout()` | Clear all stored tokens and credentials. All subsequent API calls will throw until the SDK is re-authenticated. |

#### Browser keys

`getBrowserKeys()` returns `{ shareable_key, client_id }` — pass both to the browser SDK via your own API endpoint.

**Prerequisites:**
- The `shareableKey` option must be set when creating the SDK:
  ```ts
  const sdk = createGoPaySDK({
    environment: 'production',
    shareableKey: process.env.GOPAY_SHAREABLE_KEY, // issued in GoPay admin alongside client_id
  });
  ```
- The token scope must include `card:write` (obtain `shareableKey` from the GoPay admin portal):
  ```ts
  await sdk.authenticate({
    ...,
    scope: 'payment:write payment:read card:write',
  });
  ```

Throws `AUTH_CREDENTIALS_MISSING` if either prerequisite is missing.

### Payments

| Method | Description |
|---|---|
| `createPayment(goid, params)` | Create a new payment session (`POST /eshops/{goid}/payments`). |
| `chargePayment(paymentId, params)` | Charge a payment using a payment instrument (`POST /payments/{paymentId}/charge`). |
| `getPaymentStatus(paymentId)` | Retrieve the current status of a payment (`GET /payments/{paymentId}`). Returns state, amount, currency, customer, and charge reference. |
| `getChargeState(paymentId)` | Retrieve the current state of a payment charge (`GET /payments/{paymentId}/charge`). Returns charge state, instrument details, and any 3DS action. |
| `getGooglePayInfo(paymentId)` | Retrieve Google Pay configuration for a payment. |
| `getApplePayInfo(paymentId)` | Retrieve Apple Pay configuration for a payment. Returns `applepayVersion`, `merchantIdentifier`, and `applePayPaymentRequest` needed to construct an `ApplePaySession`. |
| `startApplePaySession(paymentId, session, origin?, callbacks?)` | Wire merchant validation onto an `ApplePaySession` and call `begin()`. Handles `onvalidatemerchant` automatically; `origin` is the merchant HTTPS origin sent to Apple during validation — always pass it explicitly on Node.js (there is no `location.origin` to fall back to). Pass `{ oncancel }` in `callbacks` to be notified when the user dismisses the sheet. You must still wire `session.onpaymentauthorized` yourself. |
| `getQRPaymentInfo(paymentId, format?)` | Retrieve QR code and recipient info (`GET /payments/{paymentId}/qr-payment/info`). |

### Google Pay

**SDK handles:** fetching the pre-filled `paymentDataRequest` config from the GoPay API.

**You must wire up:** creating the `PaymentsClient`, rendering the button via `paymentsClient.createButton()` (Google's UX requirement), calling `paymentsClient.loadPaymentData()`, and handling cancellation. When the user dismisses the sheet, `loadPaymentData` rejects with either `{ statusCode: 'CANCELED' }` (Google Pay JS SDK) or a `DOMException` with `name === 'AbortError'` (PaymentRequest API path in some browsers). Check both:

```ts
} catch (err) {
  const isCancel =
    (err as any)?.statusCode === 'CANCELED' ||
    (err instanceof DOMException && err.name === 'AbortError');
  if (isCancel) { /* user dismissed — update your UI */ }
  else { /* actual error */ }
}
```

```ts
// Fetch Google Pay configuration for this payment.
// googlePayInfo contains:
//   environment        — "TEST" or "PRODUCTION", passed to PaymentsClient
//   paymentDataRequest — pre-filled PaymentRequest object (allowed networks,
//                        transaction info, merchant info, etc.) ready to pass
//                        to loadPaymentData()
const googlePayInfo = await sdk.getGooglePayInfo(payment.id);

// Initialise the Google Pay client and request payment data.
const paymentsClient = new google.payments.api.PaymentsClient({
  environment: googlePayInfo.environment, // "TEST" | "PRODUCTION"
});
const paymentData = await paymentsClient.loadPaymentData(
  googlePayInfo.paymentDataRequest,
);

// tokenizationData.token is a JSON string — parse it to extract the required fields.
const { protocolVersion, signature, signedMessage } = JSON.parse(
  paymentData.paymentMethodData.tokenizationData.token,
);
const charge = await sdk.chargePayment(payment.id, {
  payment_instrument: {
    payment_instrument: 'PAYMENT_CARD',
    input: {
      input_type: 'GOOGLE_PAY',
      protocolVersion,
      signature,
      signedMessage,
    },
  },
});
```

### Apple Pay

> **Safari only.** `ApplePaySession` is available exclusively in Safari on Apple
> devices. In other browsers the example page loads `apple-pay-polyfill.js`
> (a dev-only stub) so the flow can be exercised without a real device.

**SDK handles:** merchant validation (`onvalidatemerchant`) and `session.begin()`.

**You must wire up:** `session.onpaymentauthorized` — call `charge()` and then `session.completePayment(STATUS_SUCCESS / STATUS_FAILURE)`. Optionally pass `{ oncancel }` to `startApplePaySession` to update your UI when the user dismisses the sheet.

```ts
// Fetch Apple Pay configuration for this payment.
// Returns applepayVersion and applePayPaymentRequest (networks, country,
// currency, total, etc.) needed to construct the ApplePaySession.
// Must be called before the user-gesture handler that creates the session.
const applePayInfo = await sdk.getApplePayInfo(payment.id);

// Create the ApplePaySession — must be called synchronously from a user-gesture
// handler (e.g. button click). Do not await anything between the gesture and
// this call or the browser will block it.
const session = new ApplePaySession(applePayInfo.applepayVersion, applePayInfo.applePayPaymentRequest);

// Step 1 — Payment authorisation.
// Fires after the user authenticates with Face ID / Touch ID.
// event.payment.token.paymentData is an Apple-encrypted blob — pass it to charge().
session.onpaymentauthorized = async (event) => {
  const token = event.payment.token.paymentData;
  const charge = await sdk.chargePayment(payment.id, {
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
  });
  // Tell the sheet to show a success or failure animation, then close.
  session.completePayment(
    charge.state === 'SUCCEEDED'
      ? ApplePaySession.STATUS_SUCCESS
      : ApplePaySession.STATUS_FAILURE,
  );
};

// Wire merchant validation, then open the Apple Pay sheet.
// onvalidatemerchant and oncancel are handled automatically by the SDK.
// Pass the merchant origin explicitly — required on Node.js (no location.origin).
sdk.startApplePaySession(payment.id, session, 'https://yourshop.com', {
  oncancel: () => {
    // Update your UI to reflect the cancelled state.
  },
});
```

### Payment status and charge state

Poll for payment completion on your server after the customer returns from a redirect or completes a 3DS challenge:

```ts
// Check whether the payment has been paid, cancelled, or is still pending.
const status = await sdk.getPaymentStatus(payment.id);
// status.state: 'CREATED' | 'PAID' | 'CANCELED' | 'PAYMENT_METHOD_CHOSEN'
//             | 'TIMEOUTED' | 'AUTHORIZED' | 'REFUNDED' | 'PARTIALLY_REFUNDED'

// Check the outcome of a specific charge attempt (e.g. after 3DS redirect).
const chargeState = await sdk.getChargeState(payment.id);
// chargeState.state: 'REQUESTED' | 'PROCESSING' | 'ACTION_REQUIRED'
//                  | 'SUCCEEDED' | 'FAILED'
if (chargeState.action?.redirect_url) {
  // 3DS challenge still in progress — redirect the customer again
  window.location.href = chargeState.action.redirect_url;
}
```

### QR Payment

```ts
const qrInfo = await sdk.getQRPaymentInfo(payment.id);
// Optionally request SVG format instead of the default PNG:
// const qrInfo = await sdk.getQRPaymentInfo(payment.id, 'svg');

// Display the QR code (currency-specific)
const img = document.createElement('img');
img.src = `data:image/png;base64,${qrInfo.qr_code?.spayd}`;        // CZK — Czech SPAYD
// img.src = `data:image/png;base64,${qrInfo.qr_code?.paybysquare}`; // EUR — Slovak PayBySquare
// img.src = `data:image/png;base64,${qrInfo.qr_code?.sepa}`;        // EUR — SEPA (EPC)
// img.src = `data:image/png;base64,${qrInfo.qr_code?.mnb_qr}`;      // HUF — Hungarian MNB
document.body.appendChild(img);
```

---

### Cards

> **SDK boundary:** card data encryption and the card form UI live in the **browser SDK** ([`@gopaycz/gopay-js-sdk-browser`](../browser-sdk/README.md)), not here. The browser encrypts the card inside a GoPay-hosted iframe and returns an `encryptedPayload`; your server calls `tokenizeEncryptedCard` to convert it to a card token, then charges the payment. Raw card data never touches your server or this SDK.

| Method | Description |
|---|---|
| `tokenizeEncryptedCard(encryptedPayload)` | Convert the encrypted payload returned by the browser SDK into a card token (`POST /cards/tokens`). Requires `card:write` scope. Returns `{ token, card_id? }`. |
| `getCardDetails(cardId)` | Retrieve details of a stored permanent card token (`GET /cards/tokens/{cardId}`). Returns masked PAN, expiry, scheme, fingerprint, and the reusable token. Requires `card:read` scope. |
| `deleteCard(cardId)` | Delete a stored permanent card token (`DELETE /cards/tokens/{cardId}`). Returns `void`. Requires `card:read` scope. |

### Flow A — server-side card charge

The browser encrypts the card; your server tokenizes and charges. This is the recommended flow when your server handles the charge (e.g. to save the token for future use).

```ts
// ── Browser (using @gopaycz/gopay-js-sdk-browser) ──────────────────────────
import { createGoPayBrowserSDK, collectBrowserData } from '@gopaycz/gopay-js-sdk-browser';

const browserSdk = createGoPayBrowserSDK({ environment: 'production', shareableKey, clientId });
const controller = await browserSdk.mountCardForm(container, { flow: 'return-payload' });
const { encryptedPayload } = await controller.result;

// Collect browser data for 3DS — must be done in the browser
const browserData = collectBrowserData();

// Forward both to your server endpoint
await fetch('/api/charge', {
  method: 'POST',
  body: JSON.stringify({ paymentId, encryptedPayload, browserData }),
});

// ── Server (using @gopaycz/gopay-js-sdk) ───────────────────────────────────
import { createGoPaySDK } from '@gopaycz/gopay-js-sdk';

const sdk = createGoPaySDK({ environment: 'production' });
await sdk.authenticate({ ..., scope: 'payment:write payment:read card:write' });

// Handler for POST /api/charge
const { encryptedPayload, paymentId, browserData } = req.body;

// 1. Convert encrypted payload to a card token
const cardToken = await sdk.tokenizeEncryptedCard(encryptedPayload);

// 2. Charge the payment — always forward browserData from the browser for 3DS
const charge = await sdk.chargePayment(paymentId, {
  payment_instrument: {
    payment_instrument: 'PAYMENT_CARD',
    input: {
      input_type: 'CARD_TOKEN',
      card_token: cardToken.token,
      challenge_preference: 'AUTO',
      browser_data: browserData, // required for 3DS — do not omit
    },
  },
});

if (charge.action?.redirect_url) {
  // 3DS authentication required — redirect the customer
  res.json({ redirectUrl: charge.action.redirect_url });
}
```

> **`browser_data` is required for 3DS.** The server SDK does not auto-collect it (only the browser SDK can). Always forward it from the browser via `collectBrowserData()`. Without it, 3DS context is absent and approval rates degrade.

### Saved cards

To save a card for future payments, pass `permanent: true` to `mountCardForm` in the browser SDK. The resulting `cardToken.card_id` can be stored and used to charge again without re-entering card details:

```ts
// Retrieve details of a stored card (masked PAN, expiry, scheme, etc.)
const card = await sdk.getCardDetails(cardToken.card_id);
console.log(card.masked_pan, card.expiration_month, card.expiration_year);

// Charge a subsequent payment using the permanent token (no re-entry of card details)
const charge = await sdk.chargePayment(payment.id, {
  payment_instrument: {
    payment_instrument: 'PAYMENT_CARD',
    input: { input_type: 'CARD_TOKEN', card_token: card.token },
  },
});

// Delete the card when the customer removes it from their account
await sdk.deleteCard(card.card_id);
```

---

### Recurrences

| Method | Description |
|---|---|
| `createRecurrence(goid, params)` | Create a recurring payment agreement (`POST /eshops/{goid}/recurrences`). Requires `payment:write` scope. |
| `recurrenceStatus(recId)` | Retrieve the current state of a recurrence (`GET /recurrences/{rec_id}`). Requires `payment:read` scope. |
| `stopRecurrence(recId)` | Stop a recurrence permanently (`DELETE /recurrences/{rec_id}`). Requires `payment:write` scope. |
| `startRecurrence(recId, params?)` | Trigger the first charge of a recurrence in `NEW` state (`POST /recurrences/{rec_id}/start`). Requires `payment:write` scope. |
| `recurrenceNext(recId, params?)` | Charge the next instalment of a `STARTED` recurrence (`POST /recurrences/{rec_id}/next`). Requires `payment:write` scope. |

```ts
// Create an ON_DEMAND recurrence (customer can be charged any time)
const recurrence = await sdk.createRecurrence(goid, {
  type: 'ON_DEMAND',
  payment: {
    amount: 1000,
    currency: 'CZK',
    order_number: 'SUB-001',
    customer: { email: 'customer@example.com' },
    callback: {
      notification_url: 'https://yourshop.com/notify',
      return_url: 'https://yourshop.com/return',
    },
  },
});

// Start the first charge (sets recurrence to STARTED)
await sdk.startRecurrence(recurrence.id);

// Charge subsequent instalments at will
await sdk.recurrenceNext(recurrence.id, { amount: 1000, order_number: 'SUB-002' });

// Stop the recurrence when the subscription ends
await sdk.stopRecurrence(recurrence.id);
```

---

### Refunds

| Method | Description |
|---|---|
| `refundPayment(paymentId, params)` | Refund a payment fully or partially (`POST /payments/{paymentId}/refunds`). Requires `payment:write` scope. |
| `listRefunds(paymentId)` | List all refunds for a payment (`GET /payments/{paymentId}/refunds`). Requires `payment:read` scope. |
| `getRefund(refundId)` | Retrieve details of a single refund (`GET /refunds/{refundId}`). Requires `payment:read` scope. |

---

### Payment Links

| Method | Description |
|---|---|
| `createPaymentLink(goid, params)` | Create a shareable payment link (`POST /eshops/{goid}/links`). Requires `payment:write` scope. |
| `linkStatus(linkId)` | Retrieve the current state of a payment link (`GET /links/{link_id}`). Requires `payment:write` scope. |
| `disableLink(linkId)` | Disable a link so it can no longer be used (`DELETE /links/{link_id}`). Requires `payment:write` scope. |

```ts
// Create a reusable link that expires at a set date
const link = await sdk.createPaymentLink(goid, {
  reusable: true,
  expires_at: '2027-12-31T23:59:59',
  payment: {
    amount: 500,
    currency: 'CZK',
    order_number: 'LINK-001',
    customer: { email: 'customer@example.com' },
    callback: {
      notification_url: 'https://yourshop.com/notify',
      return_url: 'https://yourshop.com/return',
    },
  },
});
console.log(link.url); // share this URL with the customer

// Check current state (active, stop_reason, etc.)
const status = await sdk.linkStatus(link.id);

// Disable the link when it should no longer accept payments
await sdk.disableLink(link.id);
```

---

## Errors

The SDK throws two typed error classes so you can handle them precisely.

### `GoPaySDKError`

Thrown for lifecycle and configuration errors — e.g. no token available, token refresh failed, or an invalid token response was received.

Every `GoPaySDKError` carries a machine-readable `errorCode` from the `GoPayErrorCodes` constant:

| `errorCode` | When thrown |
|---|---|
| `AUTH_TOKEN_MISSING` | A protected API call was made before authenticating. |
| `AUTH_REFRESH_FAILED` | Token re-authentication (client_credentials grant) failed. |
| `AUTH_INVALID_RESPONSE` | The OAuth2 endpoint returned an incomplete token response. |
| `AUTH_CREDENTIALS_MISSING` | No client credentials stored — call `authenticate()` first. |
| `AUTH_INVALID_TOKEN` | A JWT is malformed or missing the `sub` claim. |
| `AUTH_UNAUTHORIZED` | Still 401 after a successful token refresh — check OAuth2 scopes. |
| `NETWORK_TIMEOUT` | Request exceeded `requestTimeoutMs`. |
| `NETWORK_ERROR` | Network-level failure (no response received). |
| `CARD_FORM_ERROR` | The card form iframe encountered an error (e.g. URL unavailable, init timeout, or encryption failure). |

```ts
import { GoPaySDKError, GoPayErrorCodes } from '@gopaycz/gopay-js-sdk';

try {
  await sdk.createPayment(goid, params);
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
import { GoPayHTTPError } from '@gopaycz/gopay-js-sdk';

try {
  await sdk.authenticate({ grant_type: 'client_credentials', ... });
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

A 422 error from `chargePayment` with an invalid amount looks like:

```json
{
  "date_time": "2024-03-15T14:22:00.000+0100",
  "error_code": 400,
  "error_name": "PAYMENT_VALIDATION_ERROR",
  "message": [
    {
      "field": "amount",
      "message": "INVALID",
      "description": "Value 0 is out of allowed range [1, 99999999]"
    }
  ]
}
```

### Centralised error handling with `onError`

Pass an `onError` callback to the SDK config to intercept every error in one place — useful for logging or alerting — without replacing per-call `catch` blocks:

```ts
const sdk = createGoPaySDK({
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

An interactive developer page is included in the repository — it exercises every SDK method against the real API.

Browse the source at [github.com/gopaycommunity/gopay-js-sdk](https://github.com/gopaycommunity/gopay-js-sdk) (`example/` directory).
