# @gopaycz/gopay-js-sdk-browser

[![npm](https://img.shields.io/npm/v/@gopaycz/gopay-js-sdk-browser)](https://www.npmjs.com/package/@gopaycz/gopay-js-sdk-browser)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

GoPay browser SDK for card encryption and in-browser payments.

## Installation

```bash
npm install @gopaycz/gopay-js-sdk-browser
# or
yarn add @gopaycz/gopay-js-sdk-browser
```

CDN (IIFE — exposes `window.GoPayBrowserSDK`):

```html
<script src="https://unpkg.com/@gopaycz/gopay-js-sdk-browser@1/dist/gopay-browser-sdk.min.js"></script>
```

---

## The two flows at a glance

| | Flow A — encrypt-only | Flow B — full browser payments |
|---|---|---|
| **Required inputs** | `shareableKey`, `clientId` | + `paymentId`, `paymentSecret` |
| **Browser methods** | `mountCardForm({ flow: 'return-payload' })` | + `chargePayment`, Apple Pay, Google Pay, `getStatus` |
| **Server handles** | tokenize + charge (or save token for later) | — (browser charges directly) |

---

## Where the inputs come from

### `shareableKey` and `clientId`

Both are issued in the GoPay admin alongside your `client_id` / `client_secret`.

**With the server SDK** (easiest):

```ts
// On your server:
const { shareable_key, client_id } = await serverSdk.getBrowserKeys();
// Ship both to the browser through your own API endpoint.
```

**Without the server SDK:** implement the equivalent server call yourself — see the [server SDK README § Browser keys](../sdk/README.md) for the API endpoint and auth scheme.

`shareableKey` is public and safe to embed in client-side code. It carries no payment-action authority on its own.

### `paymentId` and `paymentSecret` (Flow B only)

Returned by `serverSdk.createPayment(goid, params)` as `payment_id` and `payment_secret`.

**Without the server SDK:** call `POST /eshops/{goid}/payments` with backend credentials — see [server SDK README § Creating payments](../sdk/README.md).

> **Security:** treat `payment_secret` like a short-lived bearer credential. TLS-only, never log, never embed in URLs.

The browser SDK has no way to obtain any of these values on its own — they must come from your server.

---

## Flow A — encrypt-only

Card data is encrypted inside the GoPay-hosted iframe. The SDK returns the encrypted payload; your server handles tokenization and charge.

Flow A covers two server-side use cases with the same browser code:

- **One-time charge** — tokenize the payload and immediately charge the payment.
- **Save card for future payments** — tokenize the payload and store the returned card token; skip the charge or charge later. Use the saved token in future `chargePayment` calls without asking the customer to re-enter their card.

```ts
import { createGoPayBrowserSDK, collectBrowserData } from '@gopaycz/gopay-js-sdk-browser';

// 1. Create the browser SDK (synchronous).
//    shareableKey + clientId come from your server via getBrowserKeys().
const sdk = createGoPayBrowserSDK({
    environment: 'production', // or 'sandbox'
    shareableKey: 'pk_live_…',
    clientId: 'your-client-id',
});

// 2. Mount the card form.
const container = document.getElementById('card-form-container');
const controller = await sdk.mountCardForm(container, {
    flow: 'return-payload',
    locale: 'en',
});

// 3. Wait for the encrypted payload.
const { encryptedPayload } = await controller.result;

// 4. Forward to your server — include browserData for charging on the server.
const paymentId = 'PAY-123'; // from your server-side payment creation step
const browserData = collectBrowserData();
const response = await fetch('/api/charge', {
    method: 'POST',
    body: JSON.stringify({ encryptedPayload, paymentId, browserData }),
});
// Server calls: serverSdk.tokenizeEncryptedCard(encryptedPayload)
//               serverSdk.chargePayment(paymentId, { input_type: 'Card-Token', browser_data: browserData, ... })
```

---

## Flow B — full browser payments

Adds payment-scoped operations (charge, Apple/Google Pay, status) by exchanging the `payment_secret` for a short-lived JWT directly in the browser.

```ts
import { createGoPayBrowserSDK } from '@gopaycz/gopay-js-sdk-browser';

// 1. Create the browser SDK (same as Flow A).
const sdk = createGoPayBrowserSDK({
    environment: 'production',
    shareableKey: 'pk_live_…',
    clientId: 'your-client-id',
});

// 2. Attach a payment — exchanges payment_secret for a JWT.
//    paymentId + paymentSecret come from serverSdk.createPayment() on your server.
await sdk.attachPayment({
    paymentId: 'PAY-123',
    paymentSecret: '2f53a04d4dd749f6a2a81285da72f67a',
});

// 3. Mount and charge.
//    By default, 3DS redirects the whole page (recommended).
const container = document.getElementById('card-form-container');
const controller = await sdk.mountCardForm(container, {
    flow: 'direct-charge',
    locale: 'en',
});

const chargeResult = await controller.result; // PaymentChargeStatusResponse
```

### Apple Pay & Google Pay buttons (Flow B)

`mountApplePayButton` and `mountGooglePayButton` provide a one-call alternative
to wiring wallets manually. Each method:

1. Checks that `attachPayment()` was called.
2. Auto-injects the required wallet script (no `<script>` tag needed).
3. Detects device/browser support and calls `onUnavailable` if the wallet cannot be used.
4. Fetches payment configuration (`GET /payments/{id}/apple-pay/info` or `/google-pay/info`).
5. Renders the official wallet button inside `container`.
6. Handles the entire payment flow: wallet sheet → (Apple only) merchant validation → charge → 3DS/poll → terminal state.

```ts
// Apple Pay
await sdk.attachPayment({ paymentId, paymentSecret });

const appleCtrl = await sdk.mountApplePayButton(container, {
    threeDS: { mode: 'redirect' },
    onUnavailable: () => console.log('Apple Pay not available'),
    onCancel: () => console.log('User cancelled'),
    appleButtonOptions: { buttonstyle: 'black', type: 'buy', locale: 'en-US' },
});

const chargeResult = await appleCtrl.result; // PaymentChargeStatusResponse
// call appleCtrl.unmount() on component teardown
```

```ts
// Google Pay
await sdk.attachPayment({ paymentId, paymentSecret });

const googleCtrl = await sdk.mountGooglePayButton(container, {
    threeDS: { mode: 'redirect' },
    onUnavailable: () => console.log('Google Pay not available'),
    onCancel: () => console.log('User cancelled'),
});

const chargeResult = await googleCtrl.result;
```

**Shared options** (`ApplePayButtonOptions` / `GooglePayButtonOptions`):

| Field | Type | Default | Notes |
|---|---|---|---|
| `threeDS` | `ThreeDSConfig` | `{ mode: 'redirect' }` | See 3DS table above |
| `awaitOptions` | `Omit<AwaitChargeOptions, 'threeDS'>` | — | Extra polling / timeout options |
| `onUnavailable` | `() => void` | — | Called (and `result` rejected) when the wallet is not usable on this device |
| `onCancel` | `() => void` | — | Called when the user dismisses the payment sheet |

**Apple Pay only** — fields inside `appleButtonOptions`:

| Field | Type | Default |
|---|---|---|
| `buttonstyle` | `'black' \| 'white' \| 'white-outline'` | `'black'` |
| `type` | `string` | `'buy'` |
| `locale` | `string` | `navigator.language` |

**Google Pay only** — `googleButtonOptions` is forwarded verbatim to `PaymentsClient.createButton()`. See [Google Pay ButtonOptions](https://developers.google.com/pay/api/web/reference/request-objects#ButtonOptions).

**`WalletButtonController`:**

| Member | Description |
|---|---|
| `result` | `Promise<PaymentChargeStatusResponse>` — resolves on terminal charge state |
| `unmount()` | Remove the button, abort in-flight charge, reject `result` |

> **Availability detection:** `mountApplePayButton` calls `ApplePaySession.canMakePayments()`;
> `mountGooglePayButton` calls `isReadyToPay()`. If either returns false, `onUnavailable` is
> called and `result` rejects with `WALLET_BUTTON_ERROR`. Render a fallback UI in `onUnavailable`.

### Other Flow B methods (available after `attachPayment`)

| Method | Description |
|---|---|
| `chargePayment(params)` | `POST /payments/{id}/charge` — charge the payment; `browser_data` is collected and merged automatically for card instruments |
| `awaitChargeState(options?)` | Poll charge state to a terminal outcome; handles the 3DS redirect per `ThreeDSConfig` (useful for `mode: 'manual'`) |
| `getStatus()` | `GET /payments/{id}` — payment details |
| `getChargeState()` | `GET /payments/{id}/charge` — current charge state |
| `getGooglePayInfo()` | `GET /payments/{id}/google-pay/info` |
| `getApplePayInfo()` | `GET /payments/{id}/apple-pay/info` |
| `getApplePayAppInfo()` | `GET /payments/{id}/apple-pay/app-info` — native app config for `PKPaymentRequest` (iOS/macOS apps only; web checkouts use `getApplePayInfo()` instead) |
| `startApplePaySession(session)` | Wires merchant validation and begins an `ApplePaySession` (low-level; use `mountApplePayButton` for the full flow) |
| `getQRPaymentInfo(format?)` | `GET /payments/{id}/qr-payment/info` |

For the equivalent server-side methods and their request/response shapes, see the [server SDK README](../sdk/README.md).

---

## Integrators without the server SDK

The browser SDK is server-agnostic. You need two things from your server:

1. **Browser key bundle** — an HTTPS endpoint that returns `shareable_key` and `client_id`.
2. **Payment creation** (Flow B only) — an HTTPS endpoint that creates a payment and returns `payment_id` and `payment_secret`.

The exact API contracts are documented in the [server SDK README](../sdk/README.md). You can implement these calls in any server language.

---

## API reference

### `createGoPayBrowserSDK(config)`

```ts
createGoPayBrowserSDK(config: {
    shareableKey: string;
    clientId: string;
    environment?: 'sandbox' | 'production'; // default: 'sandbox'
    threeDS?: ThreeDSConfig;                 // default 3DS mode for all charges; overridable per-call
    baseUrl?: string;                        // override for mock servers
    requestTimeoutMs?: number;               // default: 10 000
    onError?: (err: GoPaySDKError | GoPayHTTPError) => void;
}): GoPayBrowserSDK
```

Returns the SDK instance synchronously. No network calls are made at this stage.

### `sdk.attachPayment({ paymentId, paymentSecret })`

```ts
attachPayment(args: {
    paymentId: string;
    paymentSecret: string;
}): Promise<void>
```

Exchanges `paymentSecret` for a payment-scoped JWT (`payment_credentials` grant, scopes `payment:read payment:charge`). Must be called before `mountCardForm({ flow: 'direct-charge' })` or any payment-action methods.

Throws `GoPaySDKError(PAYMENT_NOT_ATTACHED)` if these methods are called first.

### `sdk.isAuthenticated()` / `sdk.logout()`

```ts
isAuthenticated(): boolean
logout(): void
```

`isAuthenticated()` returns `true` if a payment-scoped token is currently stored (i.e. `attachPayment` has succeeded and the token has not been cleared).

`logout()` clears all stored tokens. After calling it, payment-scoped methods will throw until `attachPayment` is called again.

### `sdk.mountCardForm(container, options)`

```ts
mountCardForm(
    container: HTMLElement,
    options: CardFormOptions,
): Promise<CardFormController>
```

**`options`:**

| Field | Type | Default | Notes |
|---|---|---|---|
| `flow` | `'return-payload' \| 'direct-charge'` | required | `direct-charge` requires prior `attachPayment()` |
| `threeDS` | `ThreeDSConfig` | `{ mode: 'redirect' }` | `direct-charge` only — controls 3DS handling (see below) |
| `theme` | `CardFormTheme` | built-in | Exported from the package — `import type { CardFormTheme }` for full field reference |
| `locale` | `string` | `navigator.language` | BCP 47, e.g. `'cs-CZ'` |
| `submitMode` | `'internal' \| 'external'` | `'internal'` | `'external'` hides the iframe button; use `controller.submit()` |
| `onValidityChange` | `(isValid: boolean) => void` | — | External submit mode only |

**`ThreeDSConfig`** (used in `mountCardForm` and `awaitChargeState`):

| Value | Behaviour |
|---|---|
| `{ mode: 'redirect' }` (default) | Navigates the top-level page to the ACS URL. The returned promise stays pending as the page unloads. After 3DS, the bank redirects to the `return_url` set at payment creation; call `getChargeState()` there to confirm the outcome. |
| `{ mode: 'manual' }` | Does nothing automatically. Handle the ACS URL yourself via the `onActionRequired` callback in `awaitChargeState`. |

> **`mode: 'redirect'` and `controller.result`**: When 3DS triggers a full-page navigation, `controller.result` never resolves or rejects — the page unloads while it is still pending. **Do not `await controller.result` to detect completion on this code path.** Instead, after the bank redirects the customer back to your `return_url`, use `getChargeState()` on your server (or `sdk.getChargeState()` in a fresh browser session after calling `attachPayment` again) to confirm the final outcome:
>
> ```ts
> // On your return_url page — payment_id and payment_secret are URL query params
> // (or fetched from your server if not exposed in the URL)
> const sdk = createGoPayBrowserSDK({ ... });
> await sdk.attachPayment({ paymentId, paymentSecret });
> const charge = await sdk.getChargeState();
> if (charge.state === 'SUCCEEDED') { /* success */ }
> ```

**`CardFormController`:**

| Member | Description |
|---|---|
| `result` | `Promise` — resolves with `{ encryptedPayload }` (return-payload) or `PaymentChargeStatusResponse` (direct-charge) |
| `setTheme(theme)` | Update theme at runtime |
| `setLocale(locale)` | Update locale at runtime |
| `submit()` | Trigger submission (external submit mode only) |
| `isValid` | Current validity (external submit mode only) |
| `unmount()` | Tear down the iframe, abort any in-flight charge, reject `result` — call on component teardown |

### `sdk.mountApplePayButton(container, options)` / `sdk.mountGooglePayButton(container, options)`

```ts
mountApplePayButton(
    container: HTMLElement,
    options?: ApplePayButtonOptions,
): Promise<WalletButtonController>

mountGooglePayButton(
    container: HTMLElement,
    options?: GooglePayButtonOptions,
): Promise<WalletButtonController>
```

See [Apple Pay & Google Pay buttons](#apple-pay--google-pay-buttons-flow-b) above for the full options and controller reference.

### `collectBrowserData()`

```ts
collectBrowserData(): BrowserData
```

Collects browser context required for 3D Secure and fraud detection. Call this in the browser and forward the result to your server as `browser_data` in the `chargePayment` call.

| Field | Source |
|---|---|
| `language` | `navigator.language` |
| `user_agent` | `navigator.userAgent` |
| `timezone` | `new Date().getTimezoneOffset()` |
| `javascript_enabled` | always `true` |
| `screen_width` / `screen_height` / `color_depth` | `screen.*` |

Fields not collectable in JavaScript (`ip`, `accept_header`) are omitted — the GoPay backend fills them from the HTTP request.

---

### Error codes

| Code | Thrown by |
|---|---|
| `PAYMENT_NOT_ATTACHED` | Payment-action methods called before `attachPayment()` |
| `CARD_FORM_ERROR` | Iframe error or untrusted card-form origin |
| `CARD_FORM_ALREADY_MOUNTED` | `mountCardForm()` called while a session is already active — call `unmount()` on the existing controller first |
| `WALLET_BUTTON_ERROR` | `mountApplePayButton` / `mountGooglePayButton` — unavailable, script load failure, or session error |
| `AUTH_INVALID_RESPONSE` | `/oauth2/token` response missing required fields |
| `CHARGE_TIMEOUT` | Charge polling exceeded initial timeout |
| `CHARGE_FAILED` | Payment reached terminal `FAILED` state |

For shared error types (`GoPaySDKError`, `GoPayHTTPError`, network codes) see the [server SDK README § Errors](../sdk/README.md).

---

## CDN / IIFE

```html
<script src="https://unpkg.com/@gopaycz/gopay-js-sdk-browser@1/dist/gopay-browser-sdk.min.js"></script>
<script>
    const sdk = GoPayBrowserSDK.createGoPayBrowserSDK({
        environment: 'production',
        shareableKey: 'pk_live_…',
        clientId: 'your-client-id',
    });
    (async () => {
        await sdk.attachPayment({ paymentId, paymentSecret });
    })();
</script>
```

---

## Interactive example

An interactive developer page in the repository exercises both SDK packages against the real API.

Browse the source at [github.com/gopaycommunity/gopay-js-sdk](https://github.com/gopaycommunity/gopay-js-sdk) (`example/` directory).

---

## Security notes

- Card data is encrypted inside a GoPay-hosted iframe (`sandbox="allow-scripts allow-forms allow-same-origin"`). The SDK never sees PAN or CVV.
- `shareableKey` is public; embed it freely.
- `paymentSecret` is short-lived but server-confidential — never log it, never embed it in URLs. Forward it from your server to the browser over your own authenticated HTTPS endpoint.
- JWE plaintext contains `client_id` for backend merchant identification.
