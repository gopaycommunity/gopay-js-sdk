import {
    GoPayErrorCodes,
    GoPaySDKError,
    type HttpClient,
} from '@gopay-internal/core';
import type { components } from '../../types/generated.js';
import { createLoadingSpinner } from '../cards/loading-spinner.js';
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
const APPLE_PAY_SCRIPT_SRC =
    'https://applepay.cdn-apple.com/jsapi/v1/apple-pay-sdk.js';

/** Google Pay JS library. */
const GOOGLE_PAY_SCRIPT_SRC = 'https://pay.google.com/gp/p/js/pay.js';

// ---------------------------------------------------------------------------
// Shared helpers (module-level — no closure over factory state)
// ---------------------------------------------------------------------------

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
    const spinner = createLoadingSpinner('#1899d6');
    container.replaceChildren(spinner);

    try {
        await paymentsApi.chargePayment({
            payment_instrument: instrument,
        });

        const chargeState = await paymentsApi.awaitChargeState({
            ...options.awaitOptions,
            threeDS: options.threeDS,
            signal: abortSignal,
            onStateChange: (state) => {
                if (
                    state.state === 'ACTION_REQUIRED' &&
                    state.action?.redirect_url
                ) {
                    spinner.remove();
                }
                options.awaitOptions?.onStateChange?.(state);
            },
        });

        spinner.remove();
        resolveResult(chargeState);
    } catch (err) {
        spinner.remove();
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

            // Inject Apple Pay JS SDK (needed for the <apple-pay-button> web component)
            try {
                await loadScriptOnce(APPLE_PAY_SCRIPT_SRC);
            } catch {
                const err = new GoPaySDKError(
                    '[GoPayBrowserSDK] Failed to load Apple Pay SDK script.',
                    { errorCode: GoPayErrorCodes.WALLET_BUTTON_ERROR },
                );
                const result = Promise.reject<PaymentChargeStatusResponse>(err);
                result.catch(() => {});
                return { result, unmount: () => {} };
            }

            // Feature detection — ApplePaySession is a browser global not in the TS lib types
            const ApplePaySession = (
                globalThis as unknown as {
                    ApplePaySession?: ApplePaySessionGlobal;
                }
            ).ApplePaySession;
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

                const session = new ApplePaySession(
                    info.applepayVersion ?? 3,
                    info.applePayPaymentRequest ?? {},
                );

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
