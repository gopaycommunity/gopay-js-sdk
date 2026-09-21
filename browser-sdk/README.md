# @gopaycz/gopay-js-sdk-browser

[![npm](https://img.shields.io/npm/v/@gopaycz/gopay-js-sdk-browser)](https://www.npmjs.com/package/@gopaycz/gopay-js-sdk-browser)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=gp-gopay_gp-gw-js-sdk&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=gp-gopay_gp-gw-js-sdk)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=gp-gopay_gp-gw-js-sdk&metric=coverage)](https://sonarcloud.io/summary/new_code?id=gp-gopay_gp-gw-js-sdk)
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
import { createGoPayBrowserSDK } from '@gopaycz/gopay-js-sdk-browser';

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
const browserData = await sdk.getBrowserData(); // ip/user_agent/accept_header from the API
const response = await fetch('/api/charge', {
    method: 'POST',
    body: JSON.stringify({ encryptedPayload, paymentId, browserData }),
});
// Server calls: serverSdk.tokenizeEncryptedCard(encryptedPayload)
//               serverSdk.chargePayment(paymentId, { payment_instrument: { payment_instrument: 'PAYMENT_CARD',
//                   input: { input_type: 'CARD_TOKEN', card_token }, browser_data: browserData } })
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

> **Apple Pay outside Safari:** Apple Pay is offered on desktop Chrome, Edge and Opera as well,
> where the customer completes it by scanning a code with their iPhone. Mobile browsers other
> than Safari report unavailable, so `onUnavailable` fires there.
>
> The SDK loads and manages Apple's script itself — you never need a page-level
> `<script src="https://applepay.cdn-apple.com/...">` tag. If you already ship one you can
> drop it.
>
> One thing to check: if you run a strict Content-Security-Policy, allow
> `https://applepay.cdn-apple.com` in `script-src`. Without it Apple Pay is simply reported
> unavailable and `onUnavailable` fires, so your fallback UI still covers the customer.

### Other Flow B methods (available after `attachPayment`)

| Method | Description |
|---|---|
| `chargePayment(params)` | `POST /payments/{id}/charge` — charge the payment; `browser_data` is collected and merged automatically for card instruments |
| `awaitChargeState(options?)` | Poll charge state to a terminal outcome; handles the 3DS redirect per `ThreeDSConfig` (useful for `mode: 'manual'`) |
| `awaitPaymentStatus(options?)` | Poll payment status to a terminal outcome — for QR and bank-transfer payments, where completion is confirmed at the payment level (`state === 'PAID'`) rather than the charge level |
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
| `theme` | `CardFormTheme` | built-in | Exported from the package — see [Theme options](#theme-options) |
| `locale` | `string` | `navigator.language` | BCP 47, e.g. `'cs-CZ'` |
| `submitMode` | `'internal' \| 'external'` | `'internal'` | `'external'` hides the iframe button; use `controller.submit()` |
| `onValidityChange` | `(isValid: boolean) => void` | — | External submit mode only |
| `onFieldErrors` | `(errors: CardFormFieldError[]) => void` | — | Fires on every validation run; empty array means the form is clean |

**`ThreeDSConfig`** (used in `mountCardForm` and `awaitChargeState`):

| Value | Behaviour |
|---|---|
| `{ mode: 'redirect' }` (default) | Navigates the top-level page to the ACS URL. The returned promise stays pending as the page unloads. After 3DS, the bank redirects to the `return_url` set at payment creation; confirm the outcome with a server-side `getChargeState()` (see the note below). |
| `{ mode: 'manual' }` | Does nothing automatically. Handle the ACS URL yourself via the `onActionRequired` callback in `awaitChargeState` — and navigate to it immediately (see the note below). |

> **`mode: 'redirect'` and `controller.result`**: When 3DS triggers a full-page navigation, `controller.result` never resolves or rejects — the page unloads while it is still pending. **Do not `await controller.result` to detect completion on this code path.** Confirm the outcome on your server after the customer comes back.
>
> **Navigate to the ACS URL immediately — this matters in `mode: 'manual'`.** The bank holds the
> 3DS authentication open for only a short time, and a navigation that arrives after that window
> finds the payment already cancelled on the bank's side. The URL still looks valid, so the
> symptom is a payment that silently never completes. The default `mode: 'redirect'` already gets
> this right; under `mode: 'manual'` the timing is yours, so treat `onActionRequired` as "go now"
> and not as "here is a URL for later" — no confirmation step in between, no rendering it as a
> link the customer might click minutes later. How long the window actually is belongs to the
> customer's bank and can change without notice, so it is deliberately not documented: navigate
> immediately rather than designing against a value.
>
> **Put nothing confidential in `return_url`.** It is a plain browser navigation, so whatever it
> carries ends up in browser history, access logs, analytics, and any `Referer` the return page
> sends onward — `payment_secret` must never travel that way. Carry a non-sensitive correlation
> value you can resolve server-side (an order reference, or a single-use lookup id), or rely on
> the customer's own session and carry nothing at all.
>
> ```ts
> // return_url = https://merchant.example.com/return?order=A-1042
> // On your server: resolve the order, then read the charge with your own credentials.
> const paymentId = await orders.paymentIdFor('A-1042');
> const charge = await serverSdk.getChargeState(paymentId);
> if (charge.state === 'SUCCEEDED') { /* fulfil the order */ }
> ```
>
> Treat the payment as paid only after that server-side check. If the return page also has to
> show the result in the browser, hand the browser a fresh `paymentSecret` from your own
> authenticated endpoint and call `attachPayment()` again — the same server-to-browser handoff as
> the initial mount, never a URL parameter.

#### Theme options

`CardFormTheme` is exported from the package, so `import type { CardFormTheme }` gives you the
full field list with inline docs. The groups below cover what most integrations reach for.

**Typography.** `fontFamily` takes font *names* only, so the usable typefaces are the ones
already installed on the cardholder's system. The form deliberately accepts neither a font file
nor a URL: a URL would require the form's CSP to allow arbitrary hosts and makes `@font-face`
`unicode-range` a channel that reports which characters were rendered in the card fields, and a
file would feed attacker-controlled binary to the browser's font parser inside the
cardholder-data environment. `labelFontSize`, `labelFontWeight`, `labelUppercase` and
`labelLetterSpacing` style the labels; `labelLineHeight` states the label's line box in px,
which a design that specifies one needs — left unset the browser derives it from the font
metrics and the box comes out a couple of pixels taller. `labelHidden` drops labels visually
while keeping them in the accessibility tree, so screen readers still announce each field.

**Input metrics.** `inputHeight` fixes the field height outright, so changing `inputFontSize` no
longer means recomputing the padding. Setting `inputLineHeight` together with it makes the
rendered height deterministic — left unset, each browser derives it from the font metrics and
the height varies between engines. `inputFontWeight` sets the weight of the value itself —
without it the value renders at the browser default, so a design asking for a semibold value
could not have one while the label had a weight of its own. `inputLetterSpacing` and
`placeholderColor` cover the remaining text details.

**Borders and focus.** With `inputBorderStyle: 'boxed'`, `inputBorderCollapse` merges the
borders of adjacent inputs into one shared line. It pulls whole fields together, and a field is
label + input + error, so a single merged block needs the rest of that vertical space gone too:

`theme` **replaces** the built-in theme rather than extending it, so spread
`DEFAULT_CARD_FORM_THEME` when you only mean to override a few keys:

```ts
import { DEFAULT_CARD_FORM_THEME } from '@gopaycz/gopay-js-sdk-browser';

const theme: CardFormTheme = {
    ...DEFAULT_CARD_FORM_THEME,
    inputBorderStyle: 'boxed',
    inputBorderCollapse: true,
    groupSpacing: 0,
    fieldSpacing: 0,
    labelHidden: true,
    errorHidden: true,
    errorMinHeight: 0,
};
```

`inputBorderRadius` then rounds only the outer corners of the block. `focusRingWidth` plus
`focusRingColor` draw a ring outside the input border; both are needed for the ring to appear.

**Error text.** `errorMinHeight` reserves vertical space for the error line so the layout does
not shift when a message appears — set it to `0` to remove the reservation. `errorSpacing` sets
the gap between the input and the error line when it should differ from `fieldSpacing`: a field
spaces its label, input and error on one gap, so without it the error sits as far below the
input as the label sits above it. `errorHidden` keeps
error text in the accessibility tree but out of the layout; the cardholder then gets no visible
feedback, so pair it with `onFieldErrors` and render your own messages:

```ts
const controller = await sdk.mountCardForm(container, {
    flow: 'direct-charge',
    theme: { ...DEFAULT_CARD_FORM_THEME, errorHidden: true, errorMinHeight: 0 },
    onFieldErrors: (errors) => {
        // errors: [{ field: 'pan', code: 'pattern' }] — codes only, never values
        setFieldErrors(errors);
    },
});
```

**`CardFormController`:**

| Member | Description |
|---|---|
| `result` | `Promise` — resolves with `{ encryptedPayload }` (return-payload) or `PaymentChargeStatusResponse` (direct-charge) |
| `setTheme(theme)` | Update theme at runtime |
| `setLocale(locale)` | Update locale at runtime |
| `submit()` | Trigger submission (external submit mode only) |
| `isValid` | Current validity (external submit mode only) |
| `unmount()` | Tear down the iframe, abort an in-flight charge and its polling, reject `result` — call on component teardown. Does not roll back a charge GoPay already accepted: after an unmount rejection, confirm with a server-side `getChargeState()`. |

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

### `sdk.getBrowserData()`

```ts
getBrowserData(options?: { signal?: AbortSignal }): Promise<BrowserData>
```

Returns a complete `browser_data` object for a card charge. Needs only `shareableKey`, so it
works before `attachPayment()`.

`ip`, `user_agent` and `accept_header` describe the connection rather than the page, and the
browser cannot determine them on its own, so they come from `GET /cards/browser-data`, which
derives them from the request that fetched them. The remaining fields are read locally:

| Field | Source |
|---|---|
| `ip` | `GET /cards/browser-data` — the address the request originated from |
| `user_agent` | `GET /cards/browser-data` — the `User-Agent` the API actually observed |
| `accept_header` | `GET /cards/browser-data` — the JSON-encoded `Accept` headers the API observed |
| `language` | `navigator.language` |
| `timezone` | `new Date().getTimezoneOffset()` |
| `javascript_enabled` | always `true` |
| `screen_width` / `screen_height` / `color_depth` | `screen.*` |

**Call it in the customer's browser, immediately before the charge, and do not cache the
result.** A call made from your server reports your server's connection, which the card issuer
rejects during 3-D Secure; a cached result goes stale the moment the customer changes network.

`chargePayment` and `mountCardForm({ flow: 'direct-charge' })` call it for you. If the endpoint
is unavailable — it is not deployed on every environment yet — they fall back to the locally
readable fields and charge without `ip`, exactly as the SDK did before the endpoint existed. An
abort is never swallowed: if you tear the flow down via `unmount()`, the charge is not sent.
Calling `getBrowserData()` yourself surfaces the failure instead, so you can decide.

Reach for it directly when your **server** performs the charge:

```ts
const browserData = await sdk.getBrowserData();
await fetch('/api/charge', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ encryptedPayload, browserData }),
});
// Your server passes browserData into browser_data unchanged — never its own request values.
```

### `collectBrowserData()`

```ts
collectBrowserData(): BrowserData
```

The locally readable fields only: `language`, `timezone`, `javascript_enabled`, the `screen.*`
metrics, plus best-effort `user_agent` and `accept_header` approximations. `ip` is left unset —
the backend does not fill it in — so the SDK adds it from the endpoint when it charges. Use this
to inspect or pre-seed values; use `sdk.getBrowserData()` when you need `ip` in hand.

#### Nothing to change when upgrading

The API now requires `browser_data.ip`, but the SDK absorbs that: `chargePayment` and
`mountCardForm({ flow: 'direct-charge' })` fetch it themselves, and `ip` stays optional on the
exported `BrowserData` type. Code written against 1.6.x keeps compiling and behaving as it did —
`collectBrowserData()` has the same signature and the same shape as before. Reach for
`sdk.getBrowserData()` only where **your server** performs the charge and needs the values
collected in the browser.

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

## Monitoring

`onError` is the hook for your own monitoring: it receives every error the SDK
raises, and you forward from it into whatever you already run. No monitoring
client is bundled — you bring your own.

```ts
import * as Sentry from '@sentry/browser';
import {
  createGoPayBrowserSDK,
  GoPayHTTPError,
} from '@gopaycz/gopay-js-sdk-browser';

// Both come from your server — see § Where the inputs come from.
const shareableKey = 'pk_live_…';
const clientId = 'your-client-id';

const sdk = createGoPayBrowserSDK({
  environment: 'production',
  shareableKey,
  clientId,
  onError(err) {
    Sentry.captureException(err, {
      tags:
        err instanceof GoPayHTTPError
          ? { gopay_status: err.status, gopay_endpoint: err.endpoint }
          : { gopay_code: err.errorCode },
    });
  },
});
```

The same shape works for any tracker — swap `captureException` for
`datadogLogs.logger.error`, an OpenTelemetry span event, or your own logger.

`onError` sees every error the SDK raises — including the mount-time guards and
argument validation, which run before any request is issued — and sees each one
exactly once. It observes rather than handles: the error still propagates to your
`catch`, and an exception thrown by your own `onError` is swallowed rather than
allowed to replace it.

Group by `endpoint` and `status`, never by the raw URL: request paths carry the
payment id, so grouping on them opens a fresh group per payment.

### What not to forward

- **Never** the values you passed in — a charge carries a card token, and
  `attachPayment` a payment secret.
- **Never** the raw `body` of a `GoPayHTTPError`: it is the API's response and may
  name the customer.
- **Session replay must not record the card form.** The card fields live in a
  GoPay-hosted iframe; configure your replay tool to block iframes, or leave
  replay off on the payment page.

### Two browser-specific gotchas

- **Content-Security-Policy.** Your monitoring tool's ingest host needs to be in
  your `connect-src`. If it is missing, reports fail silently in the console while
  payments keep working — the SDK is unaffected either way.
- **`getBrowserData()` on sandbox.** `GET /cards/browser-data` is not deployed in
  every environment and answers 404 there. Called directly it reports as any other
  failure; used internally by `chargePayment` a 404 is tolerated and never
  reported, since the charge simply proceeds with the locally readable fields.

---

## Operational data

The SDK sends GoPay basic diagnostic data about its own behaviour: which SDK
operation ran, the HTTP status it got back, how long it took, and — when the SDK
raises an error — the SDK's own error code and message. This is always on. There
is no switch and nothing to configure, because a signal produced only by the
merchants who opted in describes those merchants rather than the SDK.

Alongside those it reports three lifecycle moments — the SDK being created, a
card form or wallet button becoming usable, and the visit ending — plus the SDK
version, which build of the package is running (ESM/CJS or the CDN bundle),
which payment method and flow the event belongs to, and your `clientId` and
`shareableKey`. The lifecycle pair is what makes a checkout that never starts
visible at all: without it a payment that silently fails to appear produces no
data of any kind, which is indistinguishable from nobody having visited.

**What it never contains.** Card numbers, CVV, the encrypted card payload, card
tokens, `paymentSecret`, credentials, 3DS or ACS redirect parameters, and
personal data such as e-mail, phone, name or IBAN. Request and response bodies
are not sent at all — not redacted, not sampled, simply never read — so a field
added to the API later cannot start leaking through a redaction list that
predates it. Request paths are sent as templates (`/payments/{id}/charge`), so
the payment id does not travel either, and error messages are stripped of
PAN-shaped digit runs and query strings before they leave the page.

**What it does contain that concerns you.** Every request carries the customer's
IP address, as any HTTP request does, and the page URL the SDK is running on
without its query string. The data is therefore pseudonymised personal data, not
anonymous. GoPay processes it under legitimate interest to keep the payment
integration working and diagnosable.

**What you should do.** Reflect this in your own privacy notice — you are the
controller for your checkout, and your customers' data is being processed on your
page. If your Content-Security-Policy restricts `connect-src`, add
`https://lx.gopay.com` (production) or `https://lx.sandbox.gopay.com` (sandbox);
without it the browser blocks the reports, which changes nothing about the
payment.

Delivery is fire-and-forget: a hard 2-second timeout, no retries, a cap per
visit, and every failure is discarded silently. Nothing here can delay or fail a
payment.

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
