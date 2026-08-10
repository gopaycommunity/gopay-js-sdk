import {
    GoPayErrorCodes,
    GoPaySDKError,
    type HttpClient,
} from '@gopay-internal/core';
import { makeLoadingEmitter } from '../../internal/loading-emitter.js';
import type {
    LoadingState,
    SpinnerConfig,
} from '../../internal/loading-spinner.js';
import { showSpinnerIn } from '../../internal/loading-spinner.js';
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

function makeNotAttachedController(): WalletButtonController {
    const result = Promise.reject<PaymentChargeStatusResponse>(
        new GoPaySDKError(
            '[GoPayBrowserSDK] Payment not attached. Call attachPayment({ paymentId, paymentSecret }) before mounting a wallet button.',
            { errorCode: GoPayErrorCodes.PAYMENT_NOT_ATTACHED },
        ),
    );
    // Prevent unhandled-rejection noise — callers subscribe via .result
    result.catch(() => {});
    return { result, unmount: () => {} };
}

function makeUnavailableController(
    onUnavailable: (() => void) | undefined,
): WalletButtonController {
    onUnavailable?.();
    const result = Promise.reject<PaymentChargeStatusResponse>(
        new GoPaySDKError(
            '[GoPayBrowserSDK] Wallet payment method not available on this device or browser.',
            { errorCode: GoPayErrorCodes.WALLET_BUTTON_ERROR },
        ),
    );
    result.catch(() => {});
    return { result, unmount: () => {} };
}

async function runChargeFlow(
    paymentsApi: PaymentsApi,
    container: HTMLElement,
    instrument: Omit<
        components['schemas']['Payment-Card-Charge-Data'],
        'browser_data'
    >,
    options: WalletButtonBaseOptions,
    abortSignal: AbortSignal,
    resolveResult: (v: PaymentChargeStatusResponse) => void,
    rejectResult: (e: unknown) => void,
): Promise<void> {
    const spinnerColor = options.theme?.submitBackgroundColor ?? '#1899d6';
    const emitLoadingState = makeLoadingEmitter(options.onLoadingStateChange);
    container.replaceChildren();
    emitLoadingState('charging');
    let clearSpinner = showSpinnerIn(container, {
        color: spinnerColor,
        spinner: options.spinner,
    });

    try {
        await paymentsApi.chargePayment({
            payment_instrument: instrument,
        });

        emitLoadingState('polling-charge-state');

        const chargeState = await paymentsApi.awaitChargeState({
            ...options.awaitOptions,
            threeDS: options.threeDS,
            signal: abortSignal,
            onStateChange: (state) => {
                if (
                    state.state === 'ACTION_REQUIRED' &&
                    state.action?.redirect_url
                ) {
                    clearSpinner();
                    clearSpinner = () => {};
                    emitLoadingState('idle');
                }
                try {
                    options.awaitOptions?.onStateChange?.(state);
                } catch {
                    // consumer callback errors must not corrupt SDK flows
                }
            },
        });

        clearSpinner();
        emitLoadingState('idle');
        resolveResult(chargeState);
    } catch (err) {
        clearSpinner();
        emitLoadingState('idle');
        rejectResult(err);
    }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createWalletsApi(
    client: HttpClient,
    getPaymentsApi: () => PaymentsApi | null,
) {
    let activeAppleCleanup: (() => void) | undefined;
    let activeGoogleCleanup: (() => void) | undefined;

    // -----------------------------------------------------------------------
    // mountApplePayButton
    // -----------------------------------------------------------------------

    return {
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
                return makeNotAttachedController();
            }

            if (activeAppleCleanup) {
                const result = Promise.reject<PaymentChargeStatusResponse>(
                    new GoPaySDKError(
                        '[GoPayBrowserSDK] Apple Pay button is already active. Call unmount() on the existing controller first.',
                        { errorCode: GoPayErrorCodes.WALLET_BUTTON_ERROR },
                    ),
                );
                result.catch(() => {});
                return { result, unmount: () => {} };
            }

            // Inject the Apple Pay JS SDK unless both things it provides are already
            // there: the <apple-pay-button> element and an ApplePaySession global.
            //
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

            if (needsAppleSdk && !hasApplePayScriptTag()) {
                try {
                    await loadScriptOnce(APPLE_PAY_SCRIPT_SRC, {
                        crossOrigin: 'anonymous',
                    });
                } catch {
                    // The SDK is the only thing loading this script now, so a
                    // blocked CDN (ad-blocker, CSP, proxy) has to reach the
                    // merchant's fallback UI rather than leave an empty slot.
                    options.onUnavailable?.();
                    const err = new GoPaySDKError(
                        '[GoPayBrowserSDK] Failed to load Apple Pay SDK script.',
                        { errorCode: GoPayErrorCodes.WALLET_BUTTON_ERROR },
                    );
                    const result =
                        Promise.reject<PaymentChargeStatusResponse>(err);
                    result.catch(() => {});
                    return { result, unmount: () => {} };
                }
            }

            try {
                await whenApplePayButtonDefined();
            } catch (cause) {
                options.onUnavailable?.();
                const err = new GoPaySDKError(
                    `[GoPayBrowserSDK] Apple Pay SDK loaded but <${APPLE_PAY_BUTTON_TAG}> was never registered.`,
                    { errorCode: GoPayErrorCodes.WALLET_BUTTON_ERROR, cause },
                );
                const result = Promise.reject<PaymentChargeStatusResponse>(err);
                result.catch(() => {});
                return { result, unmount: () => {} };
            }

            const ApplePaySession = getApplePaySession();

            // Feature detection. `canMakePayments()` is the right gate on both paths:
            // Safari answers natively, and the non-Safari shim returns true on desktop
            // browsers that can run the code-scan flow and false on mobile ones that
            // cannot. `applePayCapabilities()` is deliberately not used — it needs a
            // merchant identifier and a network round-trip, and on Safari it resolves
            // through the deprecated `canMakePaymentsWithActiveCard()`, which would
            // newly hide the button from users with no provisioned card.
            if (!ApplePaySession?.canMakePayments()) {
                return makeUnavailableController(options.onUnavailable);
            }

            let info: Awaited<ReturnType<typeof paymentsApi.getApplePayInfo>>;
            try {
                info = await paymentsApi.getApplePayInfo();
            } catch (err) {
                const result = Promise.reject<PaymentChargeStatusResponse>(err);
                result.catch(() => {});
                return { result, unmount: () => {} };
            }

            // Tear down any previous Apple Pay button mount
            container.replaceChildren();

            const chargeAbortController = new AbortController();
            let active = true;
            let settled = false;
            let resolveResult!: (v: PaymentChargeStatusResponse) => void;
            let rejectResult!: (e: unknown) => void;
            const result = new Promise<PaymentChargeStatusResponse>(
                (res, rej) => {
                    resolveResult = (v) => {
                        settled = true;
                        activeAppleCleanup = undefined;
                        res(v);
                    };
                    rejectResult = (e) => {
                        settled = true;
                        activeAppleCleanup = undefined;
                        rej(e);
                    };
                },
            );

            const cleanup = () => {
                active = false;
                container.replaceChildren();
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
                if (!active) {
                    return;
                }

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
                        session.completePayment(ApplePaySession.STATUS_FAILURE);
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

                    try {
                        session.completePayment(ApplePaySession.STATUS_SUCCESS);
                    } catch {
                        // completePayment may throw if session is in wrong state
                    }

                    cleanup();

                    const instrument = extractApplePayInstrument(
                        paymentData as Parameters<
                            typeof extractApplePayInstrument
                        >[0],
                    );

                    await runChargeFlow(
                        paymentsApi,
                        container,
                        instrument,
                        options,
                        chargeAbortController.signal,
                        resolveResult,
                        rejectResult,
                    );
                };

                session.onpaymentauthorized = (event: unknown) => {
                    void handlePaymentAuthorized(event);
                };

                paymentsApi.startApplePaySession(session, {
                    oncancel: () => {
                        options.onCancel?.();
                    },
                });
            };

            container.appendChild(appleBtn);

            return {
                result,
                unmount: () => {
                    if (settled) {
                        return;
                    }
                    chargeAbortController.abort();
                    cleanup();
                    const unmountError = new GoPaySDKError(
                        '[GoPayBrowserSDK] Apple Pay button unmounted.',
                        { errorCode: GoPayErrorCodes.WALLET_BUTTON_ERROR },
                    );
                    rejectResult(unmountError);
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
                return makeNotAttachedController();
            }

            if (activeGoogleCleanup) {
                const result = Promise.reject<PaymentChargeStatusResponse>(
                    new GoPaySDKError(
                        '[GoPayBrowserSDK] Google Pay button is already active. Call unmount() on the existing controller first.',
                        { errorCode: GoPayErrorCodes.WALLET_BUTTON_ERROR },
                    ),
                );
                result.catch(() => {});
                return { result, unmount: () => {} };
            }

            // Inject Google Pay JS library
            try {
                await loadScriptOnce(GOOGLE_PAY_SCRIPT_SRC);
            } catch {
                const err = new GoPaySDKError(
                    '[GoPayBrowserSDK] Failed to load Google Pay script.',
                    { errorCode: GoPayErrorCodes.WALLET_BUTTON_ERROR },
                );
                const result = Promise.reject<PaymentChargeStatusResponse>(err);
                result.catch(() => {});
                return { result, unmount: () => {} };
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
                return makeUnavailableController(options.onUnavailable);
            }

            let info: Awaited<ReturnType<typeof paymentsApi.getGooglePayInfo>>;
            try {
                info = await paymentsApi.getGooglePayInfo();
            } catch (err) {
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
                    return makeUnavailableController(options.onUnavailable);
                }
            } catch {
                return makeUnavailableController(options.onUnavailable);
            }

            // Tear down any previous Google Pay button mount
            container.replaceChildren();

            const chargeAbortController = new AbortController();
            let active = true;
            let settled = false;
            let resolveResult!: (v: PaymentChargeStatusResponse) => void;
            let rejectResult!: (e: unknown) => void;
            const result = new Promise<PaymentChargeStatusResponse>(
                (res, rej) => {
                    resolveResult = (v) => {
                        settled = true;
                        activeGoogleCleanup = undefined;
                        res(v);
                    };
                    rejectResult = (e) => {
                        settled = true;
                        activeGoogleCleanup = undefined;
                        rej(e);
                    };
                },
            );

            const cleanup = () => {
                active = false;
                container.replaceChildren();
            };

            activeGoogleCleanup = cleanup;

            const onClick = async () => {
                if (!active) {
                    return;
                }

                let paymentData: unknown;
                try {
                    paymentData = await paymentsClient.loadPaymentData(
                        info.paymentDataRequest ?? {},
                    );
                } catch (err) {
                    const isCancel =
                        (err instanceof Error &&
                            'statusCode' in err &&
                            (err as { statusCode?: string }).statusCode ===
                                'CANCELED') ||
                        (err instanceof DOMException &&
                            err.name === 'AbortError');
                    if (isCancel) {
                        options.onCancel?.();
                    } else {
                        cleanup();
                        rejectResult(err);
                    }
                    return;
                }

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

                await runChargeFlow(
                    paymentsApi,
                    container,
                    instrument,
                    options,
                    chargeAbortController.signal,
                    resolveResult,
                    rejectResult,
                );
            };

            const btn = paymentsClient.createButton({
                onClick,
                ...options.googleButtonOptions,
            });
            container.appendChild(btn);

            return {
                result,
                unmount: () => {
                    if (settled) {
                        return;
                    }
                    chargeAbortController.abort();
                    cleanup();
                    const unmountError = new GoPaySDKError(
                        '[GoPayBrowserSDK] Google Pay button unmounted.',
                        { errorCode: GoPayErrorCodes.WALLET_BUTTON_ERROR },
                    );
                    rejectResult(unmountError);
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
