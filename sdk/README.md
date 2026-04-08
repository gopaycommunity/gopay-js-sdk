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

// Use payment.id to charge via card token, Apple Pay, Google Pay, etc.
// See sdk.payments.charge() below.
```

### Charging a payment

Once the customer completes the payment flow and returns to your site, charge the payment using the instrument they provided:

```ts
// Card token (obtained via sdk.cards.mountCardForm() — returns an object, use .token)
const charge = await sdk.payments.charge(payment.id, {
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
// Server: issue a fresh token pair for the browser.
// Include the scopes needed for the flows the browser will run:
//   payment:create — create() and charge()
//   payment:read   — getGooglePayInfo(), getApplePayInfo(), getQRPaymentInfo()
//   card:save      — mountCardForm()
app.get('/session/gopay-token', async (req, res) => {
  // Protect this endpoint with your own session check
  const clientToken = await sdk.auth.issueClientToken('payment:create payment:read card:save');
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

## Promise-based API

All SDK methods return Promises. Use `async/await` or `.then()/.catch()` — there are no `onSuccess` / `onError` callback parameters on individual calls.

Handle errors with `try/catch`. The SDK throws two typed error classes (`GoPaySDKError`, `GoPayHTTPError`) that you can import and `instanceof`-check — see [Errors](#errors). TypeScript types for all request and response shapes are exported from the package; your editor will show them inline.

```ts
try {
  const payment = await sdk.payments.create(goid, params);
} catch (err) {
  if (err instanceof GoPayHTTPError) { /* API error — check err.status and err.body */ }
  if (err instanceof GoPaySDKError)  { /* SDK lifecycle error — check err.errorCode */ }
}
```

The `onError` config option (see [Configuration](#configuration)) intercepts every error centrally — useful for logging — but does not replace `try/catch`.

The one exception is `startApplePaySession`: it returns `void` instead of a Promise and accepts an optional `callbacks.oncancel`, because the Apple Pay cancel event fires natively on the `ApplePaySession` object rather than through promise rejection.

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
const googlePayInfo = await sdk.payments.getGooglePayInfo(payment.id);

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
const charge = await sdk.payments.charge(payment.id, {
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
const applePayInfo = await sdk.payments.getApplePayInfo(payment.id);

// Create the ApplePaySession — must be called synchronously from a user-gesture
// handler (e.g. button click). Do not await anything between the gesture and
// this call or the browser will block it.
const session = new ApplePaySession(applePayInfo.applepayVersion, applePayInfo.applePayPaymentRequest);

// Step 1 — Payment authorisation.
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

// Step 2 — Cancellation.
// Fires when the user dismisses the sheet without paying.
session.oncancel = () => {
  // Update your UI to reflect the cancelled state.
};

// Wire merchant validation, then open the Apple Pay sheet.
// onvalidatemerchant is handled automatically by the SDK.
sdk.payments.startApplePaySession(payment.id, session);
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
| `mountCardForm(container, iframeSrc, options?)` | Mount the GoPay card encryption iframe into `container`. Returns a `CardFormController` with a `result` promise (resolves to the card token on submit), `setTheme()`, `setLocale()`, `submit()`, and `isValid` for runtime control. Handles iframe creation, internal communication, and `POST /cards/tokens` internally. Requires the `card:save` scope. |

#### `mountCardForm` options

| Option | Type | Default | Description |
|---|---|---|---|
| `theme` | `CardFormTheme` | `DEFAULT_CARD_FORM_THEME` | Visual theme (colors, font sizes, spacing, button styles). All fields are optional — the iframe applies built-in defaults for any omitted field. |
| `locale` | `string` | `navigator.language` | BCP 47 language tag for form labels and placeholders. The region subtag is ignored (`'cs-CZ'` → `'cs'`). Unknown locales fall back to English. Supported: `bg` `cs` `de` `en` `es` `et` `fr` `hr` `hu` `it` `lt` `lv` `nl` `pl` `pt` `ro` `ru` `sk` `sl` `uk`. |
| `submitMode` | `'internal' \| 'external'` | `'internal'` | `'internal'` — the iframe renders its own submit button. `'external'` — the iframe hides the button; the parent controls submission via `cardForm.submit()` and receives validity changes via `onValidityChange`. |
| `onValidityChange` | `(isValid: boolean) => void` | — | Called whenever the overall form validity changes in external submit mode. Use this to enable/disable your external submit button. |

> **Send theme and locale at init time.** Both options are applied before the form is first painted, avoiding a flash of unstyled content. Use `cardForm.setTheme()` and `cardForm.setLocale()` on the returned controller if you need to update them after mounting.

`CardFormTheme` is fully typed — hover in your editor to see every available field. Notable fields:

| Field | Type | Default | Description |
|---|---|---|---|
| `fontFamily` | `string` | `system-ui, sans-serif` | CSS font-family stack applied to all form text (labels, inputs, errors, submit button). Use system font stacks — e.g. `"Inter, system-ui, sans-serif"` — to match your page without loading external fonts. |

Theme presets are exported from the package:

> **Color format restriction.** All color fields in `CardFormTheme` must use one of the following CSS formats: `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb(...)`, `rgba(...)`, `hsl(...)`, `hsla(...)`, or `transparent`. Values that do not match are silently replaced with `unset` (browser default). Named colors (e.g. `red`) and other CSS values are not accepted.

```ts
import {
  GoPaySDK,
  DEFAULT_CARD_FORM_THEME,
  DARK_CARD_FORM_THEME,
} from 'gopay-js-sdk';

// Default theme, locale from navigator.language (options can be omitted entirely)
const cardForm = sdk.cards.mountCardForm(container, iframeSrc);
const cardToken = await cardForm.result;

// Dark theme with Czech locale
const cardForm = sdk.cards.mountCardForm(container, iframeSrc, {
  theme: DARK_CARD_FORM_THEME,
  locale: 'cs',
});
const cardToken = await cardForm.result;

// Custom theme — override individual fields, keep the rest as defaults
const cardForm = sdk.cards.mountCardForm(container, iframeSrc, {
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

const cardForm = sdk.cards.mountCardForm(container, iframeSrc, {
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
const payment = await sdk.payments.create(goid, params);

// 2. Mount the iframe — awaits the user submitting the card form,
//    then calls POST /cards/tokens automatically.
const container = document.getElementById('card-form-container');
const cardForm = sdk.cards.mountCardForm(container, GOPAY_CARD_IFRAME_URL);
const cardToken = await cardForm.result;

// 3. Charge the payment with the resulting card token.
const charge = await sdk.payments.charge(payment.id, {
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

`GET /encryption/public-key` and the JWE construction it enables are **intentionally not part of this SDK's API surface**. Do not use the `sdk/src/iframe/index.html` stub in production or testing.

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
