import {
    GoPayErrorCodes,
    GoPayHTTPError,
    GoPaySDKError,
    type HttpClient,
} from '@gopay-internal/core';
import { callIntegrator } from '../../internal/integrator-callback.js';
import { makeLoadingEmitter } from '../../internal/loading-emitter.js';
import type {
    LoadingState,
    SpinnerConfig,
} from '../../internal/loading-spinner.js';
import { showSpinnerIn } from '../../internal/loading-spinner.js';
import {
    type BrowserTelemetry,
    NO_BROWSER_TELEMETRY,
} from '../../logging/gw-logger.js';
import type { components } from '../../types/generated.js';
import type {
    AwaitChargeOptions,
    createPaymentsApi,
    ThreeDSConfig,
} from '../payments/payments.module.js';
import { loadScriptOnce } from './load-script.js';
import {
    extractApplePayInstrument,
    extractGooglePayInstrument,
} from './wallet-instruments.js';

type PaymentChargeStatusResponse =
    components['schemas']['Payment-Charge-Status-Response'];
type PaymentsApi = ReturnType<typeof createPaymentsApi>;

// ---------------------------------------------------------------------------
// Minimal structural types for wallet globals — avoids @types/apple-pay-js
// and google-pay-button-element dependencies in the public SDK.
// ---------------------------------------------------------------------------

type ApplePaySessionInstance = {
    onvalidatemerchant: ((event: unknown) => void) | null;
    oncancel: ((event: unknown) => void) | null;
    onpaymentauthorized: ((event: unknown) => void) | null;
    completeMerchantValidation(merchantSession: unknown): void;
    completePayment(status: number): void;
    abort(): void;
    begin(): void;
};

type ApplePaySessionCtor = new (
    version: number,
    request: object,
) => ApplePaySessionInstance;

type ApplePaySessionGlobal = ApplePaySessionCtor & {
    canMakePayments(): boolean;
    readonly STATUS_SUCCESS: number;
    readonly STATUS_FAILURE: number;
};

type GooglePaymentsClient = {
    isReadyToPay(request: object): Promise<{ result: boolean }>;
    loadPaymentData(request: object): Promise<unknown>;
    createButton(options: object): HTMLElement;
};

// ---------------------------------------------------------------------------
// Public controller type
// ---------------------------------------------------------------------------

/**
 * Returned by {@link createWalletsApi.mountApplePayButton} and
 * {@link createWalletsApi.mountGooglePayButton}.
 */
export interface WalletButtonController {
    /**
     * Resolves with the terminal `PaymentChargeStatusResponse` after the SDK
     * completes the wallet → charge → poll/3DS flow.
     *
     * Rejects with {@link GoPaySDKError} (`WALLET_BUTTON_ERROR`) if the wallet
     * is unavailable, the script fails to load, or the session is aborted.
     * Rejects with {@link GoPaySDKError} (`PAYMENT_NOT_ATTACHED`) if
     * `attachPayment()` was not called first.
     * Rejects with {@link GoPayHTTPError} on API failures.
     */
    result: Promise<PaymentChargeStatusResponse>;
    /**
     * Remove the mounted button, abort any in-flight charge, and reject
     * `result`. No-op if the controller is no longer active.
     */
    unmount: () => void;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

type WalletButtonBaseOptions = {
    /** Controls how the SDK handles a 3DS redirect. Defaults to full-page redirect. */
    threeDS?: ThreeDSConfig;
    /** Extra polling / timeout / callback options forwarded to `awaitChargeState`. */
    awaitOptions?: Omit<AwaitChargeOptions, 'threeDS'>;
    /**
     * Called when the wallet is not available on this device/browser.
     * The `result` promise will also reject with `WALLET_BUTTON_ERROR`.
     */
    onUnavailable?: () => void;
    /** Called when the user dismisses the wallet payment sheet without paying. */
    onCancel?: () => void;
    /** Called on every loading state transition, regardless of the `spinner` setting. */
    onLoadingStateChange?: (state: LoadingState) => void;
    /**
     * Spinner color is derived from `theme.submitBackgroundColor` when provided;
     * use `spinner: { color }` to override independently.
     */
    theme?: { submitBackgroundColor?: string };
    /**
     * Control the built-in spinner shown during charging and polling.
     * - omitted / `{}` — SDK shows the default GoPay-blue spinner.
     * - `{ color }` — override the spinner color.
     * - `{ render }` — replace the built-in spinner entirely; called with the container element,
     *   must return a cleanup function.
     * - `false` — SDK inserts no spinner DOM at all; use `onLoadingStateChange` for your own UI.
     */
    spinner?: SpinnerConfig;
};

export type ApplePayButtonOptions = WalletButtonBaseOptions & {
    /**
     * Presentation options forwarded to the `<apple-pay-button>` web component.
     * @see https://developer.apple.com/documentation/apple_pay_on_the_web/displaying_apple_pay_buttons_using_javascript
     */
    appleButtonOptions?: {
        /** @default 'black' */
        buttonstyle?: 'black' | 'white' | 'white-outline';
        /** @default 'buy' */
        type?: string;
        /** @default navigator.language */
        locale?: string;
    };
};

export type GooglePayButtonOptions = WalletButtonBaseOptions & {
    /**
     * Extra options forwarded to `PaymentsClient.createButton()`.
     * @see https://developers.google.com/pay/api/web/reference/request-objects#ButtonOptions
     */
    googleButtonOptions?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Apple Pay script URL (JS API for `<apple-pay-button>` web component)
// ---------------------------------------------------------------------------

/**
 * The `1.latest` build — not the older `v1` one, which ships only the
 * `<apple-pay-button>` element.
 *
 * `1.latest` additionally installs an `ApplePaySession` shim in non-Safari
 * browsers (Chrome/Edge/Opera), which is what powers the "scan the code with
 * your iPhone" flow. Without it `ApplePaySession` is undefined off Safari and
 * Apple Pay can never be offered there.
 */
const APPLE_PAY_SCRIPT_SRC =
    'https://applepay.cdn-apple.com/jsapi/1.latest/apple-pay-sdk.js';

const APPLE_PAY_BUTTON_TAG = 'apple-pay-button';

/**
 * `1.latest` registers `<apple-pay-button>` from a sub-module it pulls in with
 * a dynamic `import()`, so the element is still undefined when the loader
 * script's `load` event fires — and that import swallows its own failures.
 * Everything therefore waits on `customElements.whenDefined()`, bounded so a
 * silently failed sub-module surfaces as an error instead of hanging.
 */
const APPLE_PAY_BUTTON_DEFINE_TIMEOUT_MS = 10_000;

/** Google Pay JS library. */
const GOOGLE_PAY_SCRIPT_SRC = 'https://pay.google.com/gp/p/js/pay.js';

// ---------------------------------------------------------------------------
// Shared helpers (module-level — no closure over factory state)
// ---------------------------------------------------------------------------

function getApplePaySession(): ApplePaySessionGlobal | undefined {
    return (
        globalThis as unknown as { ApplePaySession?: ApplePaySessionGlobal }
    ).ApplePaySession;
}

/**
 * True when the page already carries a tag for the same SDK build we inject.
 *
 * `loadScriptOnce` only tracks scripts it added itself, so without this a host
 * page that ships its own tag — still in flight, therefore having registered
 * nothing yet — gets a second copy of Apple's loader fetched and evaluated.
 * Matched on the URL prefix so a `?components=` query still counts.
 *
 * A tag for a *different* build (the older `v1`) deliberately does not count:
 * that one registers the element but installs no `ApplePaySession` shim, so
 * `1.latest` still has to load on top of it.
 */
/**
 * How long to keep looking for `ApplePaySession` after Apple's script has
 * loaded, and how often.
 *
 * The script's load event is not a promise that the shim it installs has
 * registered — gw-ui hit exactly this and polls for the session in
 * `useApplePay.ts`. Checking once, as this did, turns a shim that was a tick
 * late into `library-missing`: no button, and a reason that blames the wrong
 * thing.
 *
 * The interval and the attempt count are gw-ui's, so the two give up at the
 * same point. The case this covers is a registration a tick or two behind the
 * load event; the whole bound is spent only on the page that loaded the older
 * `v1` build, which registers the button element and installs no shim. That
 * still ends in `library-missing`, just half a second later.
 */
const APPLE_PAY_SESSION_POLL_MS = 500;
const APPLE_PAY_SESSION_MAX_ATTEMPTS = 20;

/**
 * The session, if this page may have one at all.
 *
 * Apple Pay requires a secure context, and gw-ui folds that into the same
 * question (`hasSession` in useApplePay.ts). Compared against `false` rather
 * than read for truthiness, which is the one deliberate difference: in a
 * browser the property is always a boolean and the two are identical, but it
 * is `undefined` outside one, and a truthy test would answer "no Apple Pay"
 * for a reason that has nothing to do with the page.
 */
function readApplePaySession(): ApplePaySessionGlobal | undefined {
    if (globalThis.isSecureContext === false) {
        return undefined;
    }
    return getApplePaySession();
}

/**
 * Resolves as soon as the session appears, or once the attempts are spent.
 *
 * The script's load event is not a promise that the shim it installs has
 * registered; gw-ui found the same and polls for it. The interval and the
 * attempt count are its numbers, so the two implementations give up at the
 * same point.
 */
function waitForApplePaySession(): Promise<ApplePaySessionGlobal | undefined> {
    const present = readApplePaySession();
    if (present) {
        return Promise.resolve(present);
    }
    return new Promise((resolve) => {
        let attempts = 0;
        const check = () => {
            const session = readApplePaySession();
            if (session) {
                resolve(session);
                return;
            }
            attempts += 1;
            if (attempts >= APPLE_PAY_SESSION_MAX_ATTEMPTS) {
                resolve(undefined);
                return;
            }
            setTimeout(check, APPLE_PAY_SESSION_POLL_MS);
        };
        setTimeout(check, APPLE_PAY_SESSION_POLL_MS);
    });
}

function hasApplePayScriptTag(): boolean {
    return !!globalThis.document?.querySelector(
        `script[src^="${APPLE_PAY_SCRIPT_SRC}"]`,
    );
}

/**
 * Resolves once `<apple-pay-button>` is registered, rejecting if that has not
 * happened within `APPLE_PAY_BUTTON_DEFINE_TIMEOUT_MS`.
 */
function whenApplePayButtonDefined(): Promise<void> {
    const registry = globalThis.customElements;
    if (!registry) {
        // No custom element registry (non-DOM host) — nothing to wait for.
        return Promise.resolve();
    }
    if (registry.get(APPLE_PAY_BUTTON_TAG)) {
        return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(
                new Error(
                    `[GoPayBrowserSDK] <${APPLE_PAY_BUTTON_TAG}> was not registered within ${APPLE_PAY_BUTTON_DEFINE_TIMEOUT_MS}ms.`,
                ),
            );
        }, APPLE_PAY_BUTTON_DEFINE_TIMEOUT_MS);

        registry.whenDefined(APPLE_PAY_BUTTON_TAG).then(
            () => {
                clearTimeout(timer);
                resolve();
            },
            (err: unknown) => {
                clearTimeout(timer);
                reject(err);
            },
        );
    });
}

function makeNotAttachedController(client: HttpClient): WalletButtonController {
    const notAttached = new GoPaySDKError(
        '[GoPayBrowserSDK] Payment not attached. Call attachPayment({ paymentId, paymentSecret }) before mounting a wallet button.',
        { errorCode: GoPayErrorCodes.PAYMENT_NOT_ATTACHED },
    );
    // Reported here rather than in rejectResult: this guard returns its own
    // already-rejected promise and never reaches the funnel.
    client.reportError(notAttached);
    const result = Promise.reject<PaymentChargeStatusResponse>(notAttached);
    // Prevent unhandled-rejection noise — callers subscribe via .result
    result.catch(() => {});
    return { result, unmount: () => {} };
}

/**
 * Name a foreign wallet failure before reporting it.
 *
 * Neither wallet SDK throws our error type. Apple's non-Safari shim throws a
 * bare `TypeError`, and Google Pay rejects `loadPaymentData` with a plain
 * `{statusCode, statusMessage}` object that is not an `Error` at all — so
 * `DEVELOPER_ERROR` and `MERCHANT_ACCOUNT_ERROR`, the two most common real
 * Google Pay misconfigurations, used to reach neither `onError` nor any
 * event. Core has a backstop for anything unnamed, but it can only report
 * `SDK.UNKNOWN`; naming it here is what makes the event say `wallet`.
 *
 * The caller still rejects with the original — what an integrator catches is
 * unchanged, only what gets reported is new.
 */
function asWalletError(cause: unknown): GoPaySDKError | GoPayHTTPError {
    if (cause instanceof GoPaySDKError || cause instanceof GoPayHTTPError) {
        return cause;
    }
    const detail =
        readProp(cause, 'statusCode') ?? readProp(cause, 'message') ?? cause;
    return new GoPaySDKError(
        `[GoPayBrowserSDK] Wallet payment failed: ${
            typeof detail === 'string' ? detail : 'unknown wallet error'
        }`,
        { errorCode: GoPayErrorCodes.WALLET_BUTTON_ERROR, cause },
    );
}

/**
 * Why a wallet button could not be offered.
 *
 * Stable codes, because they are what the data gets filtered on — they have to
 * survive any later rewording of the human-facing message.
 */
const WALLET_UNAVAILABLE = {
    scriptBlocked: 'script-blocked',
    scriptBlockedCsp: 'script-blocked-csp',
    buttonUnregistered: 'button-unregistered',
    libraryMissing: 'library-missing',
    unsupportedDevice: 'unsupported-device',
    readinessCheckFailed: 'readiness-check-failed',
} as const;

export type WalletUnavailableReason =
    (typeof WALLET_UNAVAILABLE)[keyof typeof WALLET_UNAVAILABLE];

/** What {@link createWalletsApi.getApplePayAvailability} answers. */
export interface WalletAvailability {
    available: boolean;
    /** Present only when `available` is false. */
    reason?: WalletUnavailableReason;
}

type WalletId = 'applepay' | 'googlepay';

const WALLET_LABEL: Record<WalletId, string> = {
    applepay: 'Apple Pay',
    googlepay: 'Google Pay',
};

/**
 * The SDK function a `walletUnavailable` event is reported under.
 *
 * Only the mounts appear here on purpose: `makeUnavailableController` is
 * reached from nowhere else, so deriving the name from the wallet is accurate
 * rather than assumed. The availability probe names itself at its own call
 * site, which is what keeps "a merchant asked first" and "a merchant's button
 * did not draw" apart in the data.
 */
const WALLET_MOUNT_FUNCTION: Record<WalletId, string> = {
    applepay: 'mountApplePayButton',
    googlepay: 'mountGooglePayButton',
};

/** What a human reading `onError` needs; the code above is what a query needs. */
const UNAVAILABLE_MESSAGE: Record<WalletUnavailableReason, string> = {
    'script-blocked':
        'its SDK script could not be loaded, and no Content-Security-Policy refusal was reported — an ad-blocker or a proxy',
    'script-blocked-csp':
        "its SDK script was refused by this page's Content-Security-Policy",
    'button-unregistered':
        'its SDK script loaded but never registered the button element',
    'library-missing': 'its SDK script loaded but installed no global',
    'unsupported-device': 'this device or browser cannot offer it',
    'readiness-check-failed': 'the readiness check itself failed',
};

/**
 * Read one property off a value of unknown shape.
 *
 * `Reflect.get` takes an `object`, so the guard above it is what TypeScript
 * narrows on — which is how this replaces four `as` casts without adding a
 * fifth inside itself. CLAUDE.md allows `as` only for `as const`, and a cast
 * per call site is also four chances to assert a shape that is not there.
 */
function readProp(value: unknown, key: string): unknown {
    if (typeof value !== 'object' || value === null) {
        return undefined;
    }
    return Reflect.get(value, key);
}

/** A policy refusal of one script: what refused it, and what to allow. */
type CspRefusal = { origin: string; directive: string };

/**
 * Watches for a Content-Security-Policy refusal of one specific script while
 * it loads.
 *
 * A policy refusal and an ad-blocker are the same event to the page: the
 * `<script>` fires a bare `error` with nothing on it, because the browser
 * deliberately says nothing about a cross-origin load it refused.
 * `securitypolicyviolation` is the only thing that separates them, and it
 * fires for the policy case whether the policy arrived in a header or a
 * `<meta>` — so its absence is itself the evidence for the other two.
 *
 * Scoped to the script's own origin. A merchant page with unrelated
 * violations of its own is common, and counting those would turn every
 * ad-blocked wallet script into a policy report — the exact confusion this
 * exists to end. Matched on the origin rather than the full URL because a
 * user agent is allowed to strip a cross-origin `blockedURI` back to it.
 *
 * Registered before the load is started and stopped straight after, so a
 * violation from anything else on the page has the narrowest possible window
 * in which to be mistaken for this one.
 */
function watchCspViolation(src: string): {
    blocked: () => CspRefusal | undefined;
    stop: () => void;
} {
    const idle = { blocked: () => undefined, stop: () => {} };
    const target = globalThis.document;
    if (!target?.addEventListener) {
        return idle;
    }

    let origin: string;
    try {
        origin = new URL(src).origin;
    } catch {
        return idle;
    }

    let refusal: CspRefusal | undefined;
    const onViolation = (event: Event): void => {
        const blockedUri = readProp(event, 'blockedURI');
        if (typeof blockedUri !== 'string') {
            return;
        }
        if (blockedUri !== origin && !blockedUri.startsWith(`${origin}/`)) {
            return;
        }
        // `effectiveDirective` is the modern name and the one that reports
        // which directive actually did the blocking; `violatedDirective` is
        // its long-standing alias, still the populated one on some engines.
        const effective = readProp(event, 'effectiveDirective');
        const violated = readProp(event, 'violatedDirective');
        refusal ??= {
            origin,
            directive:
                (typeof effective === 'string' && effective) ||
                (typeof violated === 'string' && violated) ||
                'script-src',
        };
    };

    target.addEventListener('securitypolicyviolation', onViolation);
    return {
        blocked: () => refusal,
        stop: () =>
            target.removeEventListener('securitypolicyviolation', onViolation),
    };
}

/**
 * The inputs the availability gate actually reads, and nothing beyond them.
 *
 * Deliberately not the user-agent string, the screen size or the pixel ratio:
 * those are the raw material of a fingerprint, and none of them is what the
 * gate consults. These few answer "why did it say no" on their own.
 *
 * `ua_mobile` is the one that explains most of the surprises. Apple's
 * non-Safari shim offers the scan-with-your-iPhone flow on desktop only, so
 * anything the browser reports as mobile is turned away — including a desktop
 * Chrome with the DevTools device toolbar switched on, which sets exactly this
 * flag. There is no way to detect the toolbar itself, and no need to: the flag
 * it flips is the thing the gate read, and with it on the event an internal
 * report stops looking like a shopper-facing outage.
 */
function walletCapabilities(
    wallet: WalletId,
): Record<string, string | number | boolean | null> {
    try {
        const nav = globalThis.navigator;
        const mobile = readProp(readProp(nav, 'userAgentData'), 'mobile');
        const shared = {
            secure_context: globalThis.isSecureContext ?? null,
            ua_mobile: typeof mobile === 'boolean' ? mobile : null,
            max_touch_points: nav?.maxTouchPoints ?? null,
        };
        if (wallet !== 'applepay') {
            return shared;
        }
        return {
            ...shared,
            apple_pay_session: !!getApplePaySession(),
            button_registered:
                !!globalThis.customElements?.get(APPLE_PAY_BUTTON_TAG),
        };
    } catch {
        // Logging is never worth a thrown error in a payment flow.
        return {};
    }
}

/** What the availability gate concluded, before anything is done about it. */
type WalletGate =
    | { ok: true }
    | { ok: false; reason: WalletUnavailableReason; csp?: CspRefusal };

/**
 * Load Apple's SDK if the page does not already have what it provides.
 *
 * Shared by the mount and by {@link createWalletsApi.getApplePayAvailability}
 * so the two can never disagree about why Apple Pay is off — one of them
 * silently drifting is exactly how a probe starts promising a button that
 * will not mount.
 */
async function ensureApplePayLibrary(): Promise<WalletGate> {
    // Loading on a missing button (rather than only on a missing
    // ApplePaySession) is what lets Safari pages work without the host adding
    // its own script tag — Safari has ApplePaySession built in, so the old
    // condition never fired and the element stayed unregistered.
    //
    // Still loading when ApplePaySession is missing covers the reverse case: a
    // host that already pulled in the older `v1` build, which registers the
    // element but installs no shim. Stacking `1.latest` on top of `v1` is safe
    // — both guard their registration with `customElements.get()` first.
    const needsAppleSdk =
        !globalThis.customElements?.get(APPLE_PAY_BUTTON_TAG) ||
        !getApplePaySession();

    if (!needsAppleSdk || hasApplePayScriptTag()) {
        return { ok: true };
    }

    const csp = watchCspViolation(APPLE_PAY_SCRIPT_SRC);
    try {
        await loadScriptOnce(APPLE_PAY_SCRIPT_SRC, {
            crossOrigin: 'anonymous',
        });
        // The script is in. The shim it installs may be a tick behind it, and
        // both callers decide `library-missing` on the very next read.
        await waitForApplePaySession();
        return { ok: true };
    } catch {
        // The SDK is the only thing loading this script now, so a blocked CDN
        // (ad-blocker, CSP, proxy) has to reach the merchant's fallback UI
        // rather than leave an empty slot.
        //
        // Which of the three it was is read here rather than guessed: the
        // policy refusal is dispatched while the element is being blocked,
        // ahead of the error event that rejects this load, so by now it has
        // either arrived or it was never a policy at all.
        const blocked = csp.blocked();
        return {
            ok: false,
            reason: blocked
                ? WALLET_UNAVAILABLE.scriptBlockedCsp
                : WALLET_UNAVAILABLE.scriptBlocked,
            csp: blocked,
        };
    } finally {
        csp.stop();
    }
}

/**
 * Can this browser pay with Apple Pay — without mounting anything.
 *
 * One short circuit, kept because the common answer is knowable without
 * fetching 58 kB from Apple's CDN: where `ApplePaySession` is already present
 * (Safari, and every iOS browser, all of which are WebKit) there is nothing to
 * load, so `ensureApplePayLibrary` returns straight away and the session is
 * asked directly.
 *
 * Nothing here reads a browser name or a device hint. An earlier revision also
 * short-circuited on `userAgentData.mobile`, on the reasoning that Apple's shim
 * turns mobile away — the same assumption that had this refusing Apple Pay on
 * the non-Safari iOS browsers, and the one the change of 23.09. overturned.
 *
 * Answers "can this device pay", not "will a button render". Whether the
 * custom element registers is the mount's problem, and the mount waits for it
 * — a probe that waited too would spend ten seconds on a question the caller
 * asked to be quick.
 */
async function resolveApplePayAvailability(): Promise<WalletGate> {
    // Make sure the script is in, wait for the session it installs, then let
    // Apple answer. gw-ui's shape (useApplePay.ts), deliberately: it is the
    // implementation with production mileage behind it, and two gates that
    // disagree about the same question are worse than either of them.
    //
    // Nothing here reads a browser name. An earlier revision turned Apple Pay
    // off for the non-Safari browsers on iOS, on the reasoning that Apple Pay
    // JS is Safari-only there — but the shim does load on those browsers and
    // offers its scan-with-an-iPhone flow, so that rule suppressed a button
    // that had something to show. The device and the browser both get to
    // answer for themselves.
    const library = await ensureApplePayLibrary();
    if (!library.ok) {
        return library;
    }

    const session = await waitForApplePaySession();
    if (!session) {
        return { ok: false, reason: WALLET_UNAVAILABLE.libraryMissing };
    }
    return session.canMakePayments()
        ? { ok: true }
        : { ok: false, reason: WALLET_UNAVAILABLE.unsupportedDevice };
}

function makeUnavailableController(args: {
    client: HttpClient;
    telemetry: BrowserTelemetry;
    wallet: WalletId;
    reason: WalletUnavailableReason;
    onUnavailable: (() => void) | undefined;
    cause?: unknown;
    /**
     * Set only when a policy refusal was observed for this wallet's own
     * script. It goes two places on purpose: onto the event, where it is what
     * separates a merchant's misconfiguration from a shopper's ad-blocker,
     * and into the integrator's error, where it is the difference between
     * "something blocked it" and the host and directive to change.
     */
    csp?: CspRefusal;
}): WalletButtonController {
    const { client, telemetry, wallet, reason, onUnavailable, cause, csp } =
        args;
    // Guarded like every other integrator callback. This one is the easiest to
    // overlook — it is the only callback this path is guaranteed to invoke,
    // and it runs ahead of both the telemetry and the reportError below, so a
    // merchant whose fallback UI throws would take out the very event that
    // explains why their button never drew, and the throw would leave
    // mountApplePayButton rejecting with their error instead of returning a
    // controller.
    callIntegrator('onUnavailable', () => onUnavailable?.(), telemetry);
    telemetry.walletUnavailable({
        functionName: WALLET_MOUNT_FUNCTION[wallet],
        paymentMethod: wallet,
        reason,
        capabilities: {
            ...walletCapabilities(wallet),
            ...(csp ? { csp_directive: csp.directive } : {}),
        },
    });
    // Names the wallet as well as the reason. The single shared sentence this
    // replaces was emitted verbatim by both wallets, so neither the merchant's
    // onError nor the log line could say which button had gone missing.
    // The remedy, not just the diagnosis: a policy refusal is the one cause
    // here the integrator can fix outright, and naming the host and the
    // directive is what turns their monitoring alert into a one-line change.
    const remedy = csp ? ` — allow ${csp.origin} in ${csp.directive}` : '';
    const unavailable = new GoPaySDKError(
        `[GoPayBrowserSDK] ${WALLET_LABEL[wallet]} is not available: ${UNAVAILABLE_MESSAGE[reason]}${remedy} (${reason}).`,
        { errorCode: GoPayErrorCodes.WALLET_BUTTON_ERROR, cause },
    );
    client.reportError(unavailable);
    const result = Promise.reject<PaymentChargeStatusResponse>(unavailable);
    result.catch(() => {});
    return { result, unmount: () => {} };
}

/**
 * Report a wallet failure, passing the telemetry opt-out only when there is
 * one.
 *
 * `reportError(err, undefined)` and `reportError(err)` mean the same thing to
 * core, but they are not the same call, and every caller that has no opinion
 * about telemetry should look like it has none.
 */
function reportWalletFailure(
    client: HttpClient,
    error: unknown,
    options?: { telemetry?: boolean },
): void {
    const walletError = asWalletError(error);
    if (options) {
        client.reportError(walletError, options);
        return;
    }
    client.reportError(walletError);
}

/**
 * The controller's promise, and the once-only settling around it.
 *
 * Both wallets kept their own copy of this, and both had the same hole:
 * `settled` was written and never read. A teardown during a charge therefore
 * settled twice — once for the `unmount()` itself, and again when the aborted
 * charge came back as a failure. Only the first carried the telemetry opt-out,
 * so one teardown produced two `SDK.WALLET_BUTTON_ERROR` events and two
 * `onError` calls: exactly what reporting the unmount as its own event was
 * meant to stop. Measured in review, on tap → authorise → unmount while
 * `awaitChargeState` was still running.
 *
 * Shared rather than fixed twice, because having to make the same correction
 * in two places is what the duplication costs.
 */
function createWalletResult(
    client: HttpClient,
    onSettled: () => void,
): {
    result: Promise<PaymentChargeStatusResponse>;
    isSettled: () => boolean;
    resolveResult: (value: PaymentChargeStatusResponse) => void;
    rejectResult: (error: unknown, options?: { telemetry?: boolean }) => void;
} {
    let settled = false;
    let resolveResult!: (value: PaymentChargeStatusResponse) => void;
    let rejectResult!: (
        error: unknown,
        options?: { telemetry?: boolean },
    ) => void;

    const result = new Promise<PaymentChargeStatusResponse>((res, rej) => {
        resolveResult = (value) => {
            if (settled) {
                return;
            }
            settled = true;
            onSettled();
            res(value);
        };
        rejectResult = (error, options) => {
            if (settled) {
                return;
            }
            settled = true;
            onSettled();
            // The wallet buttons report every failure by rejecting `result`
            // rather than by throwing, so without this the errors an
            // integrator most wants to be alerted on — the charge flow itself
            // failing — are the ones onError never sees. `options` carries the
            // telemetry opt-out: an unmount has already described itself
            // better than SDK.WALLET_BUTTON_ERROR can.
            reportWalletFailure(client, error, options);
            rej(error);
        };
    });

    return { result, isSettled: () => settled, resolveResult, rejectResult };
}

/**
 * One object rather than a parameter list. Both wallets pass the same eight
 * things and positional arguments that long are read by counting commas —
 * adding `telemetry` to the end was what tipped it over.
 */
interface ChargeFlowArgs {
    paymentsApi: PaymentsApi;
    container: HTMLElement;
    instrument: Omit<
        components['schemas']['Payment-Card-Charge-Data'],
        'browser_data'
    >;
    options: WalletButtonBaseOptions;
    /**
     * The controller, not just its signal: a refused 3DS challenge has to stop
     * the poll it is refusing, and a signal alone cannot.
     */
    chargeAbort: AbortController;
    telemetry?: BrowserTelemetry;
    /**
     * Apple Pay only. The token Apple hands over was authenticated by the
     * device, so a 3DS challenge is not a step to guide the shopper through —
     * it is the gateway asking for something this flow cannot supply, with a
     * sheet still open on top of the page. Navigating to an ACS from under
     * that sheet is worse than failing, and failing is better than the silence
     * that CHARGE_TIMEOUT leaves once it stops counting at ACTION_REQUIRED.
     *
     * Not Google Pay: `allowedAuthMethods` there includes `PAN_ONLY`, a card
     * stored in the Google account with no device cryptogram behind it, which
     * legitimately needs 3DS.
     */
    refuseActionRequired?: boolean;
}

/**
 * Returned rather than settled through callbacks, so the caller decides both
 * what to do first and what the page is finally told. Apple Pay needs that
 * order: the sheet has to be given the real result before `result` resolves,
 * or the page reacts to a charge the shopper still sees as pending.
 */
type ChargeOutcome =
    | { ok: true; state: PaymentChargeStatusResponse }
    | { ok: false; error: unknown };

async function runChargeFlow({
    paymentsApi,
    container,
    instrument,
    options,
    chargeAbort,
    telemetry = NO_BROWSER_TELEMETRY,
    refuseActionRequired = false,
}: ChargeFlowArgs): Promise<ChargeOutcome> {
    const spinnerColor = options.theme?.submitBackgroundColor ?? '#1899d6';
    const emitLoadingState = makeLoadingEmitter(
        options.onLoadingStateChange,
        telemetry,
    );
    container.replaceChildren();
    emitLoadingState('charging');
    let clearSpinner = showSpinnerIn(container, {
        color: spinnerColor,
        spinner: options.spinner,
    });

    // Settled only by the refusal below. Racing is what lets this path answer
    // at all: after ACTION_REQUIRED the poll has no timeout left, so the
    // promise it returns is one nobody can wait on.
    let refuse!: (error: unknown) => void;
    const refused = new Promise<never>((_, reject) => {
        refuse = reject;
    });

    try {
        // Same contract as CardFormController.unmount (GPOMA-2512): the wallet
        // controller's abort has to reach the charge itself, not just the state
        // polling below — and with it the browser data fetch that precedes it.
        await paymentsApi.chargePayment(
            { payment_instrument: instrument },
            { signal: chargeAbort.signal },
        );

        emitLoadingState('polling-charge-state');

        const chargeState = await Promise.race([
            paymentsApi.awaitChargeState({
                ...options.awaitOptions,
                // Forced, not defaulted: on this path a redirect is the thing
                // being prevented, so the integrator's own setting must not be
                // able to re-enable it.
                threeDS: refuseActionRequired
                    ? { mode: 'manual' }
                    : options.threeDS,
                signal: chargeAbort.signal,
                onStateChange: (state) => {
                    if (
                        state.state === 'ACTION_REQUIRED' &&
                        state.action?.redirect_url
                    ) {
                        clearSpinner();
                        clearSpinner = () => {};
                        emitLoadingState('idle');
                    }
                    // Ahead of the refusal on purpose: the integrator is shown
                    // the state this flow is giving up on, rather than only
                    // the error that followed it.
                    callIntegrator(
                        'onStateChange',
                        () => {
                            options.awaitOptions?.onStateChange?.(state);
                        },
                        telemetry,
                    );
                    if (
                        refuseActionRequired &&
                        state.state === 'ACTION_REQUIRED'
                    ) {
                        refuse(
                            new GoPaySDKError(
                                '[GoPayBrowserSDK] Apple Pay: the gateway asked for 3DS authentication, which an Apple Pay token cannot answer.',
                                {
                                    errorCode:
                                        GoPayErrorCodes.WALLET_BUTTON_ERROR,
                                    chargeState: state,
                                },
                            ),
                        );
                        chargeAbort.abort();
                    }
                },
            }),
            refused,
        ]);

        clearSpinner();
        emitLoadingState('idle');
        return { ok: true, state: chargeState };
    } catch (error) {
        clearSpinner();
        emitLoadingState('idle');
        return { ok: false, error };
    }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createWalletsApi(
    client: HttpClient,
    getPaymentsApi: () => PaymentsApi | null,
    telemetry: BrowserTelemetry = NO_BROWSER_TELEMETRY,
) {
    let activeAppleCleanup: (() => void) | undefined;
    let activeGoogleCleanup: (() => void) | undefined;

    // -----------------------------------------------------------------------
    // mountApplePayButton
    // -----------------------------------------------------------------------

    return {
        /**
         * Whether this browser can offer Apple Pay — asked before anything is
         * mounted, and before `attachPayment`.
         *
         * This is the call that keeps an Apple Pay option off an Android
         * phone's payment-method list entirely, rather than rendering it and
         * retracting it through `onUnavailable` a moment later. It needs no
         * payment and no container: only `shareableKey`, like
         * `getBrowserData()`.
         *
         * ```ts
         * const apple = await sdk.getApplePayAvailability();
         * if (apple.available) showApplePayOption();
         * // { available: false, reason: 'unsupported-device' }
         * ```
         *
         * On an Android phone it answers without a network request at all —
         * see {@link resolveApplePayAvailability} for the two short circuits
         * and the one rule in them worth revisiting.
         *
         * It answers "can this device pay", not "will a button render":
         * whether Apple's custom element registers is the mount's problem and
         * the mount waits for it. So `available: true` is not a promise that
         * `mountApplePayButton` cannot still report `button-unregistered`.
         *
         * A negative reports the same `walletUnavailable` event the mount
         * would, with the same reason code — so asking first costs nothing in
         * the data. It deliberately does **not** reach `onError`: the caller
         * asked a question and got an answer, and an answer is not a failure.
         */
        async getApplePayAvailability(): Promise<WalletAvailability> {
            const gate = await resolveApplePayAvailability();

            // Reported either way, which is what makes the number a rate:
            // gw-ui logs its readyToPay probe on success as well as refusal
            // for the same reason. A negative on its own says how often Apple
            // Pay was unavailable and never how often it was asked.
            telemetry.walletAvailability({
                functionName: 'getApplePayAvailability',
                paymentMethod: 'applepay',
                available: gate.ok,
                reason: gate.ok ? undefined : gate.reason,
                capabilities: {
                    ...walletCapabilities('applepay'),
                    ...(gate.ok || !gate.csp
                        ? {}
                        : { csp_directive: gate.csp.directive }),
                },
            });

            if (gate.ok) {
                return { available: true };
            }
            return { available: false, reason: gate.reason };
        },

        /**
         * Fetch Apple Pay configuration, auto-inject the Apple Pay JS SDK,
         * render an `<apple-pay-button>` into `container`, and return a
         * {@link WalletButtonController}.
         *
         * - Requires `attachPayment({ paymentId, paymentSecret })` to have been called first.
         * - Automatically calls `GET /payments/{id}/apple-pay/info`.
         * - Handles merchant validation (`POST /payments/{id}/apple-pay/validate`) automatically.
         * - On user authorisation, charges the payment and polls to terminal state.
         */
        async mountApplePayButton(
            container: HTMLElement,
            options: ApplePayButtonOptions = {},
        ): Promise<WalletButtonController> {
            const paymentsApi = getPaymentsApi();
            if (!paymentsApi) {
                return makeNotAttachedController(client);
            }

            if (activeAppleCleanup) {
                const alreadyActive = new GoPaySDKError(
                    '[GoPayBrowserSDK] Apple Pay button is already active. Call unmount() on the existing controller first.',
                    { errorCode: GoPayErrorCodes.WALLET_BUTTON_ERROR },
                );
                client.reportError(alreadyActive);
                const result =
                    Promise.reject<PaymentChargeStatusResponse>(alreadyActive);
                result.catch(() => {});
                return { result, unmount: () => {} };
            }

            // Same gate the availability probe uses, so the two cannot drift.
            const library = await ensureApplePayLibrary();
            if (!library.ok) {
                return makeUnavailableController({
                    client,
                    telemetry,
                    wallet: 'applepay',
                    reason: library.reason,
                    csp: library.csp,
                    onUnavailable: options.onUnavailable,
                });
            }

            try {
                await whenApplePayButtonDefined();
            } catch (cause) {
                return makeUnavailableController({
                    client,
                    telemetry,
                    wallet: 'applepay',
                    reason: WALLET_UNAVAILABLE.buttonUnregistered,
                    onUnavailable: options.onUnavailable,
                    cause,
                });
            }

            const ApplePaySession = getApplePaySession();

            // Feature detection. `canMakePayments()` is the right gate on both paths:
            // Safari answers natively, and the non-Safari shim returns true on desktop
            // browsers that can run the code-scan flow and false on mobile ones that
            // cannot. `applePayCapabilities()` is deliberately not used — it needs a
            // merchant identifier and a network round-trip, and on Safari it resolves
            // through the deprecated `canMakePaymentsWithActiveCard()`, which would
            // newly hide the button from users with no provisioned card.
            // Told apart deliberately. The script can register the button and
            // still leave no ApplePaySession — the older `v1` build does
            // exactly that — and folding it into the check below would file a
            // library that did not load under the shopper's device, which is
            // the one thing they cannot do anything about.
            if (!ApplePaySession) {
                return makeUnavailableController({
                    client,
                    telemetry,
                    wallet: 'applepay',
                    reason: WALLET_UNAVAILABLE.libraryMissing,
                    onUnavailable: options.onUnavailable,
                });
            }

            if (!ApplePaySession.canMakePayments()) {
                return makeUnavailableController({
                    client,
                    telemetry,
                    wallet: 'applepay',
                    reason: WALLET_UNAVAILABLE.unsupportedDevice,
                    onUnavailable: options.onUnavailable,
                });
            }

            let info: Awaited<ReturnType<typeof paymentsApi.getApplePayInfo>>;
            try {
                info = await paymentsApi.getApplePayInfo();
            } catch (err) {
                // A no-op for the errors the HTTP client already reported —
                // reportError dedupes. Here so this path does not depend on
                // which layer happened to construct the failure.
                client.reportError(err);
                const result = Promise.reject<PaymentChargeStatusResponse>(err);
                result.catch(() => {});
                return { result, unmount: () => {} };
            }

            // Tear down any previous Apple Pay button mount
            container.replaceChildren();

            const chargeAbortController = new AbortController();
            let active = true;
            /** True while runChargeFlow is running; read by unmount. */
            let charging = false;
            const { result, isSettled, resolveResult, rejectResult } =
                createWalletResult(client, () => {
                    activeAppleCleanup = undefined;
                });

            /**
             * The sheet the shopper currently has open, while they have it.
             *
             * Two bugs needed it. WebKit allows one payment session per page,
             * so a second tap has to be refused rather than turned into a
             * second `begin()`; and tearing the button down has to close the
             * session, or it stays open and every later `begin()` on the page
             * is refused too. The only `abort()` in the SDK was in the
             * merchant-validation failure branch.
             */
            let activeSession: ApplePaySessionInstance | undefined;

            /**
             * One authorisation per mount. Apple's failure result invites the
             * shopper to try another card, so `onpaymentauthorized` can fire
             * again — and by then the payment behind it is spent.
             */
            let authorized = false;

            const cleanup = () => {
                active = false;
                const open = activeSession;
                activeSession = undefined;
                if (open) {
                    try {
                        open.abort();
                    } catch {
                        // Already finished, already aborted, or never begun.
                        // Nothing here is worth replacing the reason cleanup
                        // was called in the first place.
                    }
                }
                container.replaceChildren();
            };

            /**
             * Tell the sheet how the payment ended, and stop tracking it.
             *
             * Clearing `activeSession` first is what keeps the `cleanup()`
             * that follows from aborting a session that has just been given
             * its result.
             */
            const finishSheet = (succeeded: boolean) => {
                const open = activeSession;
                activeSession = undefined;
                if (!open) {
                    return;
                }
                try {
                    open.completePayment(
                        succeeded
                            ? ApplePaySession.STATUS_SUCCESS
                            : ApplePaySession.STATUS_FAILURE,
                    );
                    if (!succeeded) {
                        // Apple treats a failure result as correctable: the
                        // sheet stays up and offers the shopper another card.
                        // Nothing can be charged on this payment again — a
                        // charge rejected at authorisation takes the payment
                        // itself to CANCELED, and a charge against a CANCELED
                        // payment is refused — so that offer is one we cannot
                        // honour. Dismiss the sheet instead of holding it out.
                        try {
                            open.abort();
                        } catch {
                            // The failure result already ended the session on
                            // this browser; nothing left to dismiss.
                        }
                    }
                } catch (cause) {
                    // Apple abandons a sheet it has waited on too long, and
                    // completePayment then throws. The charge is already
                    // decided either way, so this does not change what the
                    // page is told — but the empty catch it replaces meant
                    // nobody could ever learn that the shopper had been shown
                    // an outcome the payment did not have.
                    //
                    // Telemetry rather than onError: the integrator has the
                    // correct result already and there is nothing they can do
                    // about Apple's sheet.
                    telemetry.error(
                        new GoPaySDKError(
                            '[GoPayBrowserSDK] Apple Pay: the sheet would not accept the payment result.',
                            {
                                errorCode: GoPayErrorCodes.WALLET_BUTTON_ERROR,
                                cause,
                            },
                        ),
                    );
                }
            };

            activeAppleCleanup = cleanup;

            // Render the button
            const appleBtn = document.createElement('apple-pay-button');
            const appleOpts = options.appleButtonOptions ?? {};
            appleBtn.setAttribute(
                'buttonstyle',
                appleOpts.buttonstyle ?? 'black',
            );
            appleBtn.setAttribute('type', appleOpts.type ?? 'buy');
            appleBtn.setAttribute(
                'locale',
                appleOpts.locale ?? globalThis.navigator?.language ?? 'en-US',
            );
            appleBtn.style.cssText = 'display:block;width:100%;cursor:pointer;';

            appleBtn.onclick = () => {
                // One payment session per page is WebKit's rule, and a second
                // tap is how it gets broken: the sheet takes a moment to
                // appear, the shopper taps again, and the second begin()
                // throws InvalidAccessError — into window.onerror, where
                // neither onError nor cleanup would ever see it. Sentry
                // 8dd085c3 is exactly that, 1.32 s apart.
                if (!active || activeSession) {
                    return;
                }

                // The tap itself. Nothing recorded it before, which is why the
                // failure this ticket started from left no trace: the shopper
                // tapped, no sheet came up, and the funnel showed a `ready`
                // followed by silence.
                telemetry.walletStep({
                    paymentMethod: 'applepay',
                    step: 'begin',
                    status: 'start',
                });

                // The non-Safari shim validates the payment request in the
                // constructor and throws TypeError when a required member is
                // missing. Uncaught, that would leave `result` pending forever.
                let session: ApplePaySessionInstance;
                try {
                    session = new ApplePaySession(
                        info.applepayVersion ?? 3,
                        info.applePayPaymentRequest ?? {},
                    );
                } catch (cause) {
                    rejectResult(
                        new GoPaySDKError(
                            '[GoPayBrowserSDK] Apple Pay: the payment request returned by apple-pay/info was rejected by ApplePaySession.',
                            {
                                errorCode: GoPayErrorCodes.WALLET_BUTTON_ERROR,
                                cause,
                            },
                        ),
                    );
                    cleanup();
                    return;
                }

                const handlePaymentAuthorized = async (
                    event: unknown,
                ): Promise<void> => {
                    if (authorized) {
                        // Reached when the sheet authorises a second time,
                        // which Apple allows after a failure result. By now the
                        // payment is spent: a charge rejected at authorisation
                        // moves the payment to CANCELED, and the API refuses a
                        // charge against a CANCELED payment. A second attempt
                        // could only be turned down, after the shopper had been
                        // invited to make it. Refused here rather than sent.
                        telemetry.walletStep({
                            paymentMethod: 'applepay',
                            step: 'paymentAuthorized',
                            status: 'failure',
                            detail: 'already-charged',
                        });
                        return;
                    }
                    authorized = true;

                    const paymentData =
                        event != null &&
                        typeof event === 'object' &&
                        'payment' in event
                            ? (
                                  event as {
                                      payment: {
                                          token: { paymentData: unknown };
                                      };
                                  }
                              ).payment?.token?.paymentData
                            : undefined;

                    if (!paymentData || typeof paymentData !== 'object') {
                        finishSheet(false);
                        rejectResult(
                            new GoPaySDKError(
                                '[GoPayBrowserSDK] Apple Pay: missing payment data in authorisation event.',
                                {
                                    errorCode:
                                        GoPayErrorCodes.WALLET_BUTTON_ERROR,
                                },
                            ),
                        );
                        cleanup();
                        return;
                    }

                    const instrument = extractApplePayInstrument(
                        paymentData as Parameters<
                            typeof extractApplePayInstrument
                        >[0],
                    );

                    // The customer authorised in the sheet. Same gap the card
                    // form had: without this the next event is the charge, so
                    // a sheet the customer dismissed and a charge that never
                    // fired look the same. No duration — the useful one is
                    // time spent in the sheet, which starts at the tap, not
                    // when the button drew.
                    telemetry.submit('applepay-button', {
                        paymentMethod: 'applepay',
                    });

                    charging = true;
                    const outcome = await runChargeFlow({
                        paymentsApi,
                        container,
                        instrument,
                        options,
                        chargeAbort: chargeAbortController,
                        telemetry,
                        refuseActionRequired: true,
                    });
                    charging = false;

                    // The sheet is told first, and told the truth. It is still
                    // open and it is the only thing the shopper is looking at,
                    // so settling `result` ahead of it would let the page act
                    // on an outcome the sheet still shows as pending — and,
                    // before this, showed as a green tick whatever happened.
                    finishSheet(outcome.ok);
                    cleanup();

                    if (outcome.ok) {
                        resolveResult(outcome.state);
                    } else {
                        rejectResult(outcome.error);
                    }
                };

                session.onpaymentauthorized = (event: unknown) => {
                    void handlePaymentAuthorized(event);
                };

                activeSession = session;

                try {
                    paymentsApi.startApplePaySession(session, {
                        oncancel: () => {
                            // The shopper dismissed the sheet; the page is
                            // theirs again and so is the next tap.
                            activeSession = undefined;
                            telemetry.walletStep({
                                paymentMethod: 'applepay',
                                step: 'cancel',
                                status: 'info',
                            });
                            callIntegrator(
                                'onCancel',
                                () => options.onCancel?.(),
                                telemetry,
                            );
                        },
                        onvalidationfailure: (cause) => {
                            // Merchant validation failing aborts the session,
                            // and WebKit's abort() reaches the final state
                            // without dispatching a cancel event. So without
                            // this the tap guard above would go on holding a
                            // session that no longer exists, and one failed
                            // /apple-pay/validate — a blip is enough — would
                            // take the button out for the rest of the page's
                            // life, every later tap silently ignored.
                            activeSession = undefined;
                            // Reported, not settled: the sheet is gone but the
                            // button is still mounted and the next tap builds
                            // a fresh session, so this is the same shape as a
                            // cancel — with the difference that something did
                            // go wrong and the merchant should hear about it.
                            client.reportError(
                                new GoPaySDKError(
                                    '[GoPayBrowserSDK] Apple Pay: merchant validation failed, so the payment sheet was dismissed.',
                                    {
                                        errorCode:
                                            GoPayErrorCodes.WALLET_BUTTON_ERROR,
                                        cause,
                                    },
                                ),
                            );
                        },
                    });
                } catch (cause) {
                    // The constructor was already guarded; begin() was not,
                    // although it is the call that actually opens the sheet
                    // and the one WebKit refuses when a session is already
                    // open. Uncaught, its throw reached window.onerror and
                    // left `result` pending for good.
                    activeSession = undefined;
                    rejectResult(
                        new GoPaySDKError(
                            '[GoPayBrowserSDK] Apple Pay: the payment sheet could not be opened.',
                            {
                                errorCode: GoPayErrorCodes.WALLET_BUTTON_ERROR,
                                cause,
                            },
                        ),
                    );
                    cleanup();
                }
            };

            container.appendChild(appleBtn);
            // In the DOM and upgraded by apple-pay-sdk.js — the point past
            // which a shopper can actually start paying.
            telemetry.lifecycle('ready', { paymentMethod: 'applepay' });

            return {
                result,
                unmount: () => {
                    if (isSettled()) {
                        return;
                    }
                    // Read before cleanup(), which clears activeSession — and
                    // reported as its own event rather than as the rejection
                    // below, because tearing a button down on purpose is not a
                    // failure and should not read as one.
                    telemetry.walletUnmount({
                        paymentMethod: 'applepay',
                        sheetOpen: activeSession !== undefined,
                        chargeInFlight: charging,
                    });
                    chargeAbortController.abort();
                    cleanup();
                    const unmountError = new GoPaySDKError(
                        '[GoPayBrowserSDK] Apple Pay button unmounted.',
                        { errorCode: GoPayErrorCodes.WALLET_BUTTON_ERROR },
                    );
                    rejectResult(unmountError, { telemetry: false });
                    try {
                        client.emitError(unmountError);
                    } catch {
                        // emitError throws after firing onError — swallow here
                    }
                },
            };
        },

        // -----------------------------------------------------------------------
        // mountGooglePayButton
        // -----------------------------------------------------------------------

        /**
         * Fetch Google Pay configuration, auto-inject the Google Pay JS library,
         * render a Google Pay button into `container`, and return a
         * {@link WalletButtonController}.
         *
         * - Requires `attachPayment({ paymentId, paymentSecret })` to have been called first.
         * - Automatically calls `GET /payments/{id}/google-pay/info`.
         * - On user authorisation, charges the payment and polls to terminal state.
         */
        async mountGooglePayButton(
            container: HTMLElement,
            options: GooglePayButtonOptions = {},
        ): Promise<WalletButtonController> {
            const paymentsApi = getPaymentsApi();
            if (!paymentsApi) {
                return makeNotAttachedController(client);
            }

            if (activeGoogleCleanup) {
                const alreadyActive = new GoPaySDKError(
                    '[GoPayBrowserSDK] Google Pay button is already active. Call unmount() on the existing controller first.',
                    { errorCode: GoPayErrorCodes.WALLET_BUTTON_ERROR },
                );
                client.reportError(alreadyActive);
                const result =
                    Promise.reject<PaymentChargeStatusResponse>(alreadyActive);
                result.catch(() => {});
                return { result, unmount: () => {} };
            }

            // Inject Google Pay JS library
            const csp = watchCspViolation(GOOGLE_PAY_SCRIPT_SRC);
            try {
                await loadScriptOnce(GOOGLE_PAY_SCRIPT_SRC);
            } catch {
                // Same contract as the Apple Pay path and the availability
                // checks below: a blocked CDN has to reach the merchant's
                // fallback UI rather than leave an empty slot, and a policy
                // refusal is told apart from an ad-blocker rather than guessed.
                const blocked = csp.blocked();
                return makeUnavailableController({
                    client,
                    telemetry,
                    wallet: 'googlepay',
                    reason: blocked
                        ? WALLET_UNAVAILABLE.scriptBlockedCsp
                        : WALLET_UNAVAILABLE.scriptBlocked,
                    csp: blocked,
                    onUnavailable: options.onUnavailable,
                });
            } finally {
                csp.stop();
            }

            const googleGlobal = (
                globalThis.window as unknown as {
                    google?: {
                        payments: {
                            api: {
                                PaymentsClient: new (config: {
                                    environment?: string;
                                }) => GooglePaymentsClient;
                            };
                        };
                    };
                }
            )?.google;

            if (!googleGlobal) {
                return makeUnavailableController({
                    client,
                    telemetry,
                    wallet: 'googlepay',
                    reason: WALLET_UNAVAILABLE.libraryMissing,
                    onUnavailable: options.onUnavailable,
                });
            }

            let info: Awaited<ReturnType<typeof paymentsApi.getGooglePayInfo>>;
            try {
                info = await paymentsApi.getGooglePayInfo();
            } catch (err) {
                // A no-op for the errors the HTTP client already reported —
                // reportError dedupes. Here so this path does not depend on
                // which layer happened to construct the failure.
                client.reportError(err);
                const result = Promise.reject<PaymentChargeStatusResponse>(err);
                result.catch(() => {});
                return { result, unmount: () => {} };
            }

            const paymentsClient = new googleGlobal.payments.api.PaymentsClient(
                {
                    environment: info.environment,
                },
            );

            // Feature detection
            try {
                const readiness = await paymentsClient.isReadyToPay(
                    info.paymentDataRequest ?? {},
                );
                if (!readiness.result) {
                    return makeUnavailableController({
                        client,
                        telemetry,
                        wallet: 'googlepay',
                        reason: WALLET_UNAVAILABLE.unsupportedDevice,
                        onUnavailable: options.onUnavailable,
                    });
                }
            } catch (cause) {
                return makeUnavailableController({
                    client,
                    telemetry,
                    wallet: 'googlepay',
                    reason: WALLET_UNAVAILABLE.readinessCheckFailed,
                    onUnavailable: options.onUnavailable,
                    cause,
                });
            }

            // Tear down any previous Google Pay button mount
            container.replaceChildren();

            const chargeAbortController = new AbortController();
            let active = true;
            /** True while runChargeFlow is running; read by unmount. */
            let charging = false;
            /**
             * Google Pay has no session object to inspect, the way Apple Pay's
             * `activeSession` can be — the sheet is simply `loadPaymentData`
             * being in flight, so it is tracked rather than derived.
             */
            let sheetOpen = false;
            const { result, isSettled, resolveResult, rejectResult } =
                createWalletResult(client, () => {
                    activeGoogleCleanup = undefined;
                });

            const cleanup = () => {
                active = false;
                container.replaceChildren();
            };

            activeGoogleCleanup = cleanup;

            const onClick = async () => {
                if (!active) {
                    return;
                }

                // Google Pay's `checkout` is Apple Pay's `begin`: the tap and
                // the start of the sheet are one moment here, because there is
                // no session to construct first. Two names for it rather than
                // one because gw-ui uses two, and a step vocabulary that only
                // half matches is worse than either. No separate `begin`, so
                // the pair to compare across wallets is begin/checkout.
                telemetry.walletStep({
                    paymentMethod: 'googlepay',
                    step: 'checkout',
                    status: 'start',
                });

                let paymentData: unknown;
                sheetOpen = true;
                try {
                    paymentData = await paymentsClient.loadPaymentData(
                        info.paymentDataRequest ?? {},
                    );
                } catch (err) {
                    sheetOpen = false;
                    // Not gated on `instanceof Error`: Google Pay rejects
                    // with a plain object, and requiring an Error turned a
                    // customer dismissing the sheet into a reported failure
                    // with no onCancel. Broadening it cannot regress the
                    // Error-shaped case, so it is right under either shape.
                    const statusCode = readProp(err, 'statusCode');
                    const isCancel =
                        statusCode === 'CANCELED' ||
                        (err instanceof DOMException &&
                            err.name === 'AbortError');
                    if (isCancel) {
                        telemetry.walletStep({
                            paymentMethod: 'googlepay',
                            step: 'cancel',
                            status: 'info',
                        });
                        callIntegrator(
                            'onCancel',
                            () => options.onCancel?.(),
                            telemetry,
                        );
                    } else {
                        cleanup();
                        rejectResult(err);
                    }
                    return;
                }

                sheetOpen = false;
                cleanup();

                const paymentMethodData =
                    paymentData != null &&
                    typeof paymentData === 'object' &&
                    'paymentMethodData' in paymentData
                        ? (
                              paymentData as {
                                  paymentMethodData: {
                                      tokenizationData: { token: string };
                                  };
                              }
                          ).paymentMethodData
                        : undefined;

                if (!paymentMethodData) {
                    rejectResult(
                        new GoPaySDKError(
                            '[GoPayBrowserSDK] Google Pay: missing paymentMethodData in loadPaymentData response.',
                            { errorCode: GoPayErrorCodes.WALLET_BUTTON_ERROR },
                        ),
                    );
                    return;
                }

                let instrument: ReturnType<typeof extractGooglePayInstrument>;
                try {
                    instrument = extractGooglePayInstrument(paymentMethodData);
                } catch (err) {
                    rejectResult(err);
                    return;
                }

                telemetry.submit('googlepay-button', {
                    paymentMethod: 'googlepay',
                });

                // No `refuseActionRequired`: unlike Apple Pay, Google Pay can
                // return a PAN_ONLY token — a card stored in the Google
                // account with no device cryptogram — for which a 3DS
                // challenge is the correct next step, not a fault.
                charging = true;
                const outcome = await runChargeFlow({
                    paymentsApi,
                    container,
                    instrument,
                    options,
                    chargeAbort: chargeAbortController,
                    telemetry,
                });
                charging = false;

                if (outcome.ok) {
                    resolveResult(outcome.state);
                } else {
                    rejectResult(outcome.error);
                }
            };

            const btn = paymentsClient.createButton({
                onClick,
                ...options.googleButtonOptions,
            });
            container.appendChild(btn);
            telemetry.lifecycle('ready', { paymentMethod: 'googlepay' });

            return {
                result,
                unmount: () => {
                    if (isSettled()) {
                        return;
                    }
                    telemetry.walletUnmount({
                        paymentMethod: 'googlepay',
                        sheetOpen,
                        chargeInFlight: charging,
                    });
                    chargeAbortController.abort();
                    cleanup();
                    const unmountError = new GoPaySDKError(
                        '[GoPayBrowserSDK] Google Pay button unmounted.',
                        { errorCode: GoPayErrorCodes.WALLET_BUTTON_ERROR },
                    );
                    rejectResult(unmountError, { telemetry: false });
                    try {
                        client.emitError(unmountError);
                    } catch {
                        // emitError throws after firing onError — swallow here
                    }
                },
            };
        },
    };
}
