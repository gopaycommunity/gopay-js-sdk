# gopay-js-sdk

GoPay JavaScript SDK for server-side use (Node.js) — wraps the GoPay Payments API v4.0.

> **Building a browser integration?** Use [`gopay-js-sdk-browser`](../browser-sdk/README.md) — it handles in-browser card encryption, direct-charge flows, and exposes an IIFE bundle for CDN use.

## Installation

```bash
npm install gopay-js-sdk
# or
yarn add gopay-js-sdk
```

---

## Quick start

```ts
import { createGoPaySDK } from 'gopay-js-sdk';

const sdk = createGoPaySDK({ environment: 'production' });

// Authenticate (server-side only — never expose credentials in the browser)
await sdk.authenticate({
  grant_type: 'client_credentials',
  client_id: process.env.GOPAY_CLIENT_ID,
  client_secret: process.env.GOPAY_CLIENT_SECRET,
  scope: 'payment:create',
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
import { createGoPaySDK } from 'gopay-js-sdk';

const sdk = createGoPaySDK({ environment: 'production' });

await sdk.authenticate({
  grant_type: 'client_credentials',
  client_id: process.env.GOPAY_CLIENT_ID,
  client_secret: process.env.GOPAY_CLIENT_SECRET,
  scope: 'payment:create payment:read',
});

// All subsequent calls attach the Bearer token automatically.
const payment = await sdk.createPayment(goid, params);
```

### Browser client

Credentials must never leave the server. The SDK provides a two-step handoff:

1. **Server** calls `issueClientToken()` — obtains a fresh token pair for every browser client without touching its own session. The browser may use a **narrower scope** than the server.
2. **Server** returns the `ClientToken` to the browser (e.g. via a session endpoint).
3. **Browser** calls `setClientToken()` — seeds the SDK with both tokens. The `client_id` is extracted automatically from the JWT; no credentials are needed in the browser.
4. All subsequent browser API calls use the access token directly, renewing via the refresh token transparently before expiry. The browser should finish its business before refreshToken expires (usually 24 hrs) because it can't renew it. Else you need to provide a mechanism to get new client tokens.

```ts
// Server: issue a fresh token pair for the browser.
// Include the scopes needed for the flows the browser will run:
//   payment:create — create() and charge()
//   payment:read   — getGooglePayInfo(), getApplePayInfo(), getQRPaymentInfo()
//   card:save      — mountCardForm()
app.get('/session/gopay-token', async (req, res) => {
  // Protect this endpoint with your own session check
  const clientToken = await sdk.issueClientToken('payment:create payment:read card:save card:read');
  res.json(clientToken);
});
```

ESM / bundler:

```ts
import { createGoPaySDK } from 'gopay-js-sdk';

const browserSdk = createGoPaySDK({ environment: 'production' });

const clientToken = await fetch('/session/gopay-token').then(r => r.json());
browserSdk.setClientToken(clientToken);

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
| `issueClientToken(scope?)` | Server-side: obtain a fresh token pair for a browser client without affecting the server session. Use a narrower `scope` if the browser only needs a subset of permissions. |
| `setClientToken(token)` | Browser-side: seed the SDK with a `ClientToken` obtained from the server. Extracts `client_id` automatically from the JWT `access_token`. |
| `isAuthenticated()` | Returns `true` if a token is currently stored. Does not check expiry — expired tokens are refreshed transparently on the next API call. |
| `logout()` | Clear all stored tokens and credentials. All subsequent API calls will throw until the SDK is re-authenticated. |

### Payments

| Method | Description |
|---|---|
| `createPayment(goid, params)` | Create a new payment session (`POST /eshops/{goid}/payments`). |
| `chargePayment(paymentId, params)` | Charge a payment using a payment instrument (`POST /payments/{paymentId}/charge`). |
| `getPaymentStatus(paymentId)` | Retrieve the current status of a payment (`GET /payments/{paymentId}`). Returns state, amount, currency, customer, and charge reference. |
| `getChargeState(paymentId)` | Retrieve the current state of a payment charge (`GET /payments/{paymentId}/charge`). Returns charge state, instrument details, and any 3DS action. |
| `getGooglePayInfo(paymentId)` | Retrieve Google Pay configuration for a payment. |
| `getApplePayInfo(paymentId)` | Retrieve Apple Pay configuration for a payment. Returns `applepayVersion`, `merchantIdentifier`, and `applePayPaymentRequest` needed to construct an `ApplePaySession`. |
| `startApplePaySession(paymentId, session, origin?, callbacks?)` | Wire merchant validation onto an `ApplePaySession` and call `begin()`. Handles `onvalidatemerchant` automatically; `origin` defaults to `window.location.origin`. Pass `{ oncancel }` in `callbacks` to be notified when the user dismisses the sheet. You must still wire `session.onpaymentauthorized` yourself. |
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
  return_url: 'https://yourshop.com/return',
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
    return_url: 'https://yourshop.com/return',
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
sdk.startApplePaySession(payment.id, session, undefined, {
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

| Method | Description |
|---|---|
| `mountCardForm(container, options?)` | Fetches the GoPay-hosted iframe URL from `GET /encryption/card-form-url`, mounts it into `container`, and returns `Promise<CardFormController>`. The controller exposes a `result` promise (resolves to the card token on submit), `setTheme()`, `setLocale()`, `submit()`, and `isValid` for runtime control. Handles iframe creation, internal communication, and `POST /cards/tokens` internally. Requires the `card:save` scope. |
| `getCardDetails(cardId)` | Retrieve details of a stored permanent card token (`GET /cards/tokens/{cardId}`). Returns masked PAN, expiry, scheme, fingerprint, and the reusable token. Requires the `card:read` scope. |
| `deleteCard(cardId)` | Delete a stored permanent card token (`DELETE /cards/tokens/{cardId}`). Returns `void`. |

#### `mountCardForm` options

| Option | Type | Default | Description |
|---|---|---|---|
| `theme` | `CardFormTheme` | `DEFAULT_CARD_FORM_THEME` | Visual theme (colors, font sizes, spacing, button styles). All fields are optional — the iframe applies built-in defaults for any omitted field. |
| `locale` | `string` | `navigator.language` | BCP 47 language tag for form labels and placeholders. The region subtag is ignored (`'cs-CZ'` → `'cs'`). Unknown locales fall back to English. Supported: `bg` `cs` `de` `en` `es` `et` `fr` `hr` `hu` `it` `lt` `lv` `nl` `pl` `pt` `ro` `ru` `sk` `sl` `uk`. |
| `submitMode` | `'internal' \| 'external'` | `'internal'` | `'internal'` — the iframe renders its own submit button. `'external'` — the iframe hides the button; the parent controls submission via `cardForm.submit()` and receives validity changes via `onValidityChange`. |
| `permanent` | `boolean` | `false` | When `true`, a permanent (reusable) card token is created that can be charged again for future payments. When `false` (default), a single-use token is created. |
| `onValidityChange` | `(isValid: boolean) => void` | — | Called whenever the overall form validity changes in external submit mode. Use this to enable/disable your external submit button. |

> **Send theme and locale at init time.** Both options are applied before the form is first painted, avoiding a flash of unstyled content. Use `cardForm.setTheme()` and `cardForm.setLocale()` on the returned controller if you need to update them after mounting.

`CardFormTheme` is fully typed — hover in your editor to see every available field. Notable fields:

| Field | Type | Default | Description |
|---|---|---|---|
| `fontFamily` | `string` | `system-ui, sans-serif` | CSS font-family stack applied to all form text (labels, inputs, errors, submit button). Use system font stacks — e.g. `"Inter, system-ui, sans-serif"` — to match your page without loading external fonts. |

> **Color format restriction.** All color fields in `CardFormTheme` must use one of the following CSS formats: `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb(...)`, `rgba(...)`, `hsl(...)`, `hsla(...)`, or `transparent`. Values that do not match are silently replaced with `unset` (browser default). Named colors (e.g. `red`) and other CSS values are not accepted.

Theme presets are exported from the package:

```ts
import {
  GoPaySDK,
  DEFAULT_CARD_FORM_THEME,
  DARK_CARD_FORM_THEME,
} from 'gopay-js-sdk';

// Default theme, locale from navigator.language (options can be omitted entirely)
const cardForm = await sdk.mountCardForm(container);
const cardToken = await cardForm.result;

// Dark theme with Czech locale
const cardForm = await sdk.mountCardForm(container, {
  theme: DARK_CARD_FORM_THEME,
  locale: 'cs',
});
const cardToken = await cardForm.result;

// Custom theme — override individual fields, keep the rest as defaults
const cardForm = await sdk.mountCardForm(container, {
  theme: { ...DEFAULT_CARD_FORM_THEME, submitBackgroundColor: '#your-brand-color' },
});

// Update theme or locale at runtime (e.g. user toggles dark mode or language)
darkModeToggle.addEventListener('change', () => cardForm.setTheme(DARK_CARD_FORM_THEME));
langSelect.addEventListener('change', e => cardForm.setLocale(e.target.value));

const cardToken = await cardForm.result;
```

#### External submit button

Use `submitMode: 'external'` when you want the submit button to live outside the iframe — for example to match your own checkout UI. The iframe hides its built-in button, reports validity changes via `onValidityChange`, and waits for `cardForm.submit()` to trigger encryption.

```ts
const payBtn = document.getElementById('pay-btn');

const cardForm = await sdk.mountCardForm(container, {
  submitMode: 'external',
  onValidityChange(isValid) {
    // Enable/disable your own submit button based on form validity.
    payBtn.disabled = !isValid;
  },
});

payBtn.addEventListener('click', () => {
  cardForm.submit(); // triggers encryption inside the iframe
});

// Await the result exactly the same as in internal submit.
const cardToken = await cardForm.result;
```

`cardForm.isValid` is also available as a synchronous getter in case you need to read the current validity state imperatively (e.g. inside a click handler before calling `submit()`).

> Calling `submit()` in internal submit mode throws a `GoPaySDKError`. Calling it after the form completes or is unmounted is a no-op.

### Card Pay

Card number encryption must never run in publicly reachable JavaScript — doing so would expose the raw PAN to any script on the merchant's page. The SDK uses a GoPay-hosted iframe for this step so that raw card data never touches merchant code.

```ts
// 1. Create a payment session first (server-side).
const payment = await sdk.createPayment(goid, params);

// 2. Mount the iframe — the SDK fetches the hosted form URL from the API,
//    mounts the iframe, then awaits the user submitting the card form,
//    and calls POST /cards/tokens automatically.
const container = document.getElementById('card-form-container');
const cardForm = await sdk.mountCardForm(container);
const cardToken = await cardForm.result;

// 3. Charge the payment with the resulting card token.
const charge = await sdk.chargePayment(payment.id, {
  payment_instrument: {
    payment_instrument: 'PAYMENT_CARD',
    input: {
      input_type: 'CARD_TOKEN',
      card_token: cardToken.token,
      challenge_preferrence: 'AUTO',
    },
  },
  return_url: 'https://yourshop.com/return',
});

if (charge.action?.redirect_url) {
  // 3DS authentication required — redirect the customer.
  window.location.href = charge.action.redirect_url;
}
```

### Saved cards

When `mountCardForm` is called with `permanent: true`, the resulting `cardToken.token` is a permanent token tied to a card ID (`cardToken.card_id`). You can retrieve or delete it later:

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
  return_url: 'https://yourshop.com/return',
});

// Delete the card when the customer removes it from their account
await sdk.deleteCard(card.card_id);
```

`GET /encryption/public-key` and the JWE construction it enables are **intentionally not part of this SDK's API surface**.

---

### Recurrences

| Method | Description |
|---|---|
| `createRecurrence(goid, params)` | Create a recurring payment agreement (`POST /eshops/{goid}/recurrences`). Requires `payment:create` scope. |
| `recurrenceStatus(recId)` | Retrieve the current state of a recurrence (`GET /recurrences/{rec_id}`). Requires `payment:read` scope. |
| `stopRecurrence(recId)` | Stop a recurrence permanently (`DELETE /recurrences/{rec_id}`). Requires `payment:create` scope. |
| `startRecurrence(recId, params?)` | Trigger the first charge of a recurrence in `NEW` state (`POST /recurrences/{rec_id}/start`). Requires `payment:create` scope. |
| `recurrenceNext(recId, params?)` | Charge the next instalment of a `STARTED` recurrence (`POST /recurrences/{rec_id}/next`). Requires `payment:create` scope. |

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

### Payment Links

| Method | Description |
|---|---|
| `createPaymentLink(goid, params)` | Create a shareable payment link (`POST /eshops/{goid}/links`). Requires `payment:create` scope. |
| `linkStatus(linkId)` | Retrieve the current state of a payment link (`GET /links/{link_id}`). Requires `payment:create` scope. |
| `disableLink(linkId)` | Disable a link so it can no longer be used (`DELETE /links/{link_id}`). Requires `payment:create` scope. |

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
| `AUTH_REFRESH_TOKEN_MISSING` | Token expired and no refresh token is stored. |
| `AUTH_REFRESH_FAILED` | Token refresh request failed (network or API error). |
| `AUTH_INVALID_RESPONSE` | The OAuth2 endpoint returned an incomplete token response. |
| `AUTH_CREDENTIALS_MISSING` | `issueClientToken()` called without prior `authenticate()`. |
| `AUTH_INVALID_TOKEN` | `setClientToken()` received a JWT without a valid `sub` claim. |
| `AUTH_UNAUTHORIZED` | Still 401 after a successful token refresh — check OAuth2 scopes. |
| `NETWORK_TIMEOUT` | Request exceeded `requestTimeoutMs`. |
| `NETWORK_ERROR` | Network-level failure (no response received). |
| `CARD_FORM_ERROR` | The card form iframe encountered an error (e.g. URL unavailable, init timeout, or encryption failure). |

```ts
import { GoPaySDKError, GoPayErrorCodes } from 'gopay-js-sdk';

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
import { GoPayHTTPError } from 'gopay-js-sdk';

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
