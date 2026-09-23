import {
    awaitCharge,
    awaitPaymentStatus,
    type AwaitChargeOptions as CoreAwaitChargeOptions,
    type AwaitPaymentStatusOptions as CoreAwaitPaymentStatusOptions,
    GoPayErrorCodes,
    GoPayHTTPError,
    GoPaySDKError,
    type HttpClient,
    requirePathSegment,
} from '@gopay-internal/core';
import type { components } from '../../types/generated.js';
import { collectBrowserData, fetchBrowserData } from './browser-data.js';

type PaymentDetails = components['schemas']['Payment-Details'];
type PaymentChargeRequest = components['schemas']['Payment-Charge-Input'];
type PaymentChargeResponse = components['schemas']['Payment-Charge-Response'];
type PaymentChargeStatusResponse =
    components['schemas']['Payment-Charge-Status-Response'];
type BrowserDataSchema = components['schemas']['Browser-Data'];
type PaymentCardChargeData = components['schemas']['Payment-Card-Charge-Data'];
type GooglePayInfoResponse =
    components['responses']['Google-Pay-Info-Response']['content']['application/json'];
type ApplePayInfoResponse =
    components['responses']['Apple-Pay-Info-Response']['content']['application/json'];
type ApplePayAppInfoResponse =
    components['responses']['Apple-Pay-App-Info-Response']['content']['application/json'];
type ValidateMerchantResponse =
    components['schemas']['Validate-Merchant-Response'];
type QRPaymentDetails = components['schemas']['QR-Payment-Details'];

// Allow callers to omit browser_data — the SDK collects and injects it automatically.
type CardChargeDataInput = Omit<PaymentCardChargeData, 'browser_data'> & {
    browser_data?: Partial<BrowserDataSchema>;
};
type PaymentChargeRequestInput = Omit<
    PaymentChargeRequest,
    'payment_instrument'
> & {
    payment_instrument?: CardChargeDataInput;
};

/**
 * Controls how the SDK handles the 3DS redirect when `ACTION_REQUIRED` is encountered.
 *
 * - `{ mode: 'redirect' }` (default) — navigate the top-level page to the ACS URL.
 *   The returned promise stays pending as the page unloads.
 * - `{ mode: 'manual' }` — do nothing automatically; handle the redirect URL yourself
 *   via the `onActionRequired` callback in `AwaitChargeOptions`.
 */
export type ThreeDSConfig = { mode?: 'redirect' } | { mode: 'manual' };

/** Options for {@link awaitChargeState}. */
export type AwaitChargeOptions =
    CoreAwaitChargeOptions<PaymentChargeStatusResponse> & {
        threeDS?: ThreeDSConfig;
    };

/** Options for {@link awaitPaymentStatus}. */
export type AwaitPaymentStatusOptions =
    CoreAwaitPaymentStatusOptions<PaymentDetails>;

function assertHttpsUrl(url: string): void {
    if (new URL(url).protocol !== 'https:') {
        throw new GoPaySDKError(
            `[GoPayBrowserSDK] Redirect URL must use https: protocol. Got "${url}"`,
            { errorCode: GoPayErrorCodes.CHARGE_FAILED },
        );
    }
}

/**
 * How long a 3DS redirect gets to actually take the page away before the SDK
 * stops waiting for it.
 *
 * In redirect mode the documented contract is that the promise stays pending
 * as the page unloads. When the page does not unload — a webview that blocks
 * or silently drops a top-level navigation — nothing settles it, ever.
 * `CHARGE_TIMEOUT` cannot cover this: it is deliberately cancelled the moment
 * `ACTION_REQUIRED` is seen, because a customer answering a 3DS challenge has
 * no time limit. So the failure is pure silence, which is what the 22.09.
 * report "went into 3DS, confirmed it, never finished" looked like.
 *
 * 30 s, matching the initial charge timeout rather than undercutting it. The
 * page stays alive until the *next* document starts committing, so this is
 * racing the ACS's first response over the customer's connection — and a
 * tighter bound would report a redirect that is merely slow on mobile data as
 * one that never happened. Nothing is lost by waiting: the alternative to a
 * late answer here is no answer at all.
 */
const THREE_DS_REDIRECT_TIMEOUT_MS = 30_000;

function handle3DS(
    threeDS: ThreeDSConfig | undefined,
    redirectUrl: string,
    onActionRequired: ((url: string) => void) | undefined,
): void {
    assertHttpsUrl(redirectUrl);
    onActionRequired?.(redirectUrl);
    if (threeDS?.mode !== 'manual') {
        globalThis.location.href = redirectUrl;
    }
}

export function createPaymentsApi(
    client: HttpClient,
    paymentId: string,
    defaultThreeDS?: ThreeDSConfig,
) {
    // Validated and encoded once here rather than at each of the twelve
    // interpolations below. buildUrl resolves a relative path with
    // `new URL(relative, base)`, which normalises `.` and `..` — so a raw
    // `../../oauth2/token` would address an endpoint the caller never named.
    // This factory owns every path the id reaches, so an endpoint added later is
    // covered by construction rather than by whoever copies an existing method
    // remembering to encode.
    //
    // attachPayment deliberately keeps the raw id: there it goes into the Basic
    // auth credentials, where percent-encoding would change the value being
    // authenticated rather than the path being addressed.
    const pid = requirePathSegment(paymentId, 'paymentId');
    async function validateApplePayMerchant(
        validationURL?: string,
    ): Promise<ValidateMerchantResponse> {
        const body = validationURL
            ? { validationUrl: validationURL }
            : undefined;
        return client.post<ValidateMerchantResponse>(
            `/payments/${pid}/apple-pay/validate`,
            body,
        );
    }

    return {
        /**
         * Retrieve the current status of this payment.
         * GET /payments/{payment_id}
         */
        async getStatus(options?: {
            signal?: AbortSignal;
        }): Promise<PaymentDetails> {
            return client.get<PaymentDetails>(`/payments/${pid}`, options);
        },

        /**
         * Charge this payment using a payment instrument.
         *
         * For a card charge the SDK assembles `browser_data` itself: `ip`,
         * `user_agent` and `accept_header` come from `GET /cards/browser-data`
         * (fetched per charge, never cached), the rest is read from the page.
         * Anything the caller passes in `browser_data` wins over both.
         *
         * POST /payments/{payment_id}/charge
         */
        async chargePayment(
            params: PaymentChargeRequestInput,
            options?: { signal?: AbortSignal },
        ): Promise<PaymentChargeResponse> {
            const pi = params.payment_instrument;
            if (pi?.payment_instrument === 'PAYMENT_CARD') {
                // Fetched per charge, never cached: the values describe the
                // connection this charge is authenticated from. The caller's
                // signal covers the fetch as well as the charge itself.
                let collected: Partial<BrowserDataSchema>;
                try {
                    collected = await fetchBrowserData(client, {
                        signal: options?.signal,
                    });
                } catch (err) {
                    // An aborted request means the caller tore the flow down
                    // (see CardFormController.unmount) — never charge after it.
                    if (options?.signal?.aborted) {
                        throw err;
                    }
                    // Tolerate only an environment where the endpoint is not
                    // deployed: charging with the locally readable fields is
                    // exactly what the SDK did before it existed. Anything else
                    // — 5xx, a timeout, a CORS failure — would otherwise be
                    // turned into a charge missing the now-required `ip`, which
                    // the API rejects with the real cause already lost.
                    const status =
                        err instanceof GoPayHTTPError ? err.status : undefined;
                    if (status !== 404 && status !== 501) {
                        throw err;
                    }
                    collected = collectBrowserData();
                }
                return client.post<PaymentChargeResponse>(
                    `/payments/${pid}/charge`,
                    {
                        ...params,
                        payment_instrument: {
                            ...pi,
                            browser_data: {
                                ...collected,
                                ...pi.browser_data,
                            },
                        },
                    },
                    options,
                );
            }
            return client.post<PaymentChargeResponse>(
                `/payments/${pid}/charge`,
                params,
                options,
            );
        },

        /**
         * Retrieve the current state of this payment's charge.
         * GET /payments/{payment_id}/charge
         */
        async getChargeState(options?: {
            signal?: AbortSignal;
        }): Promise<PaymentChargeStatusResponse> {
            return client.get<PaymentChargeStatusResponse>(
                `/payments/${pid}/charge`,
                options,
            );
        },

        /**
         * Poll the charge state until a terminal outcome.
         *
         * The 3DS redirect mode is resolved in order:
         * 1. The `threeDS` option passed to this call (highest priority).
         * 2. The `threeDS` option passed to `createGoPayBrowserSDK()` at SDK init.
         * 3. `{ mode: 'redirect' }` — navigate the top-level page to the ACS URL;
         *    the returned promise stays pending as the page unloads.
         *
         * Pass `threeDS: { mode: 'manual' }` to handle `ACTION_REQUIRED` yourself
         * via `options.onActionRequired`.
         *
         * Resolves on `SUCCEEDED`. Rejects with `CHARGE_FAILED` on `FAILED`,
         * or `CHARGE_TIMEOUT` if the charge does not leave `REQUESTED`/
         * `PROCESSING` within `initialTimeoutMs` (default 30 s) — or if a 3DS
         * redirect was issued and the page was still here 30 s later, which
         * means the navigation never happened.
         */
        awaitChargeState(
            options?: AwaitChargeOptions,
        ): Promise<PaymentChargeStatusResponse> {
            const effectiveThreeDS = options?.threeDS ?? defaultThreeDS;
            // Manual mode is excluded deliberately: there the integrator was
            // handed the URL and the page is *supposed* to stay, so a
            // watchdog would report their working integration as broken.
            const redirects = effectiveThreeDS?.mode !== 'manual';

            let stall: ReturnType<typeof setTimeout> | undefined;
            let giveUp!: (error: unknown) => void;
            const stalled = new Promise<never>((_, reject) => {
                giveUp = reject;
            });

            // Racing settles the promise the caller holds; it cancels nothing.
            // Without a controller of its own the poll would carry on hitting
            // /payments/{id}/charge every couple of seconds for as long as the
            // page stayed open — after the SDK had already announced it had
            // given up. So this call gets its own, chained to the caller's.
            const polling = new AbortController();
            const abortPolling = () => polling.abort();
            if (options?.signal?.aborted) {
                polling.abort();
            } else {
                options?.signal?.addEventListener('abort', abortPolling, {
                    once: true,
                });
            }

            const stopWatching = () => {
                clearTimeout(stall);
                if (typeof globalThis.removeEventListener === 'function') {
                    globalThis.removeEventListener('pagehide', stopWatching);
                }
                options?.signal?.removeEventListener('abort', abortPolling);
            };

            const settled = awaitCharge(
                () =>
                    client.get<PaymentChargeStatusResponse>(
                        `/payments/${pid}/charge`,
                        { signal: polling.signal },
                    ),
                {
                    ...options,
                    signal: polling.signal,
                    onActionRequired: (redirectUrl) => {
                        handle3DS(
                            effectiveThreeDS,
                            redirectUrl,
                            options?.onActionRequired,
                        );
                        if (!redirects || stall !== undefined) {
                            return;
                        }
                        // The page leaving is the success case, and it takes
                        // the timer with it. Listening as well covers the page
                        // that is frozen into the back/forward cache instead
                        // of destroyed: it would otherwise come back to life
                        // with an expired timer and report a stall for a
                        // navigation that did happen.
                        if (typeof globalThis.addEventListener === 'function') {
                            globalThis.addEventListener(
                                'pagehide',
                                stopWatching,
                                { once: true },
                            );
                        }
                        stall = setTimeout(() => {
                            giveUp(
                                new GoPaySDKError(
                                    '[GoPayBrowserSDK] The 3DS redirect did not navigate the page away. The charge cannot complete here; some embedded browsers block top-level navigation.',
                                    {
                                        errorCode:
                                            GoPayErrorCodes.CHARGE_TIMEOUT,
                                    },
                                ),
                            );
                            // Rejected first, so the race settles on this and
                            // not on the aborted poll's own CHARGE_FAILED.
                            polling.abort();
                        }, THREE_DS_REDIRECT_TIMEOUT_MS);
                    },
                },
            );

            return Promise.race([settled, stalled]).finally(stopWatching);
        },

        /**
         * Retrieve Google Pay configuration for this payment.
         * GET /payments/{payment_id}/google-pay/info
         */
        async getGooglePayInfo(): Promise<GooglePayInfoResponse> {
            return client.get<GooglePayInfoResponse>(
                `/payments/${pid}/google-pay/info`,
            );
        },

        /**
         * Retrieve Apple Pay configuration for this payment (web).
         * GET /payments/{payment_id}/apple-pay/info
         */
        async getApplePayInfo(): Promise<ApplePayInfoResponse> {
            return client.get<ApplePayInfoResponse>(
                `/payments/${pid}/apple-pay/info`,
            );
        },

        /**
         * Retrieve Apple Pay configuration for this payment (native app).
         * GET /payments/{payment_id}/apple-pay/app-info
         */
        async getApplePayAppInfo(): Promise<ApplePayAppInfoResponse> {
            return client.get<ApplePayAppInfoResponse>(
                `/payments/${pid}/apple-pay/app-info`,
            );
        },

        /**
         * Wire merchant validation onto an ApplePaySession and begin it.
         * Handles the onvalidatemerchant callback automatically.
         */
        startApplePaySession(
            session: {
                onvalidatemerchant: ((event: unknown) => void) | null;
                oncancel: ((event: unknown) => void) | null;
                completeMerchantValidation(merchantSession: unknown): void;
                abort(): void;
                begin(): void;
            },
            callbacks?: {
                oncancel?: (event: unknown) => void;
                /**
                 * Merchant validation failed and the session below was
                 * aborted. WebKit's `abort()` takes the session to its final
                 * state without dispatching a cancel event, so `oncancel`
                 * never runs and this is the only notice the caller gets that
                 * the sheet is gone.
                 */
                onvalidationfailure?: (error: unknown) => void;
            },
        ): void {
            session.onvalidatemerchant = (event: unknown) => {
                const validationURL =
                    event != null &&
                    typeof event === 'object' &&
                    'validationURL' in event &&
                    typeof (event as Record<string, unknown>).validationURL ===
                        'string'
                        ? ((event as Record<string, unknown>)
                              .validationURL as string)
                        : undefined;
                validateApplePayMerchant(validationURL)
                    .then((merchantSession) =>
                        session.completeMerchantValidation(merchantSession),
                    )
                    .catch((error: unknown) => {
                        session.abort();
                        callbacks?.onvalidationfailure?.(error);
                    });
            };
            session.oncancel = (event) => {
                callbacks?.oncancel?.(event);
            };
            session.begin();
        },

        /**
         * Retrieve QR payment info for this payment.
         * GET /payments/{payment_id}/qr-payment/info
         */
        async getQRPaymentInfo(
            format?: 'png' | 'svg',
        ): Promise<QRPaymentDetails> {
            const path = format
                ? `/payments/${pid}/qr-payment/info?format=${format}`
                : `/payments/${pid}/qr-payment/info`;
            return client.get<QRPaymentDetails>(path);
        },

        /**
         * Poll this payment's status until it reaches a terminal state.
         *
         * Use for QR and bank-transfer payments where completion is confirmed at
         * the payment level (`state === 'PAID'`) rather than the charge level.
         *
         * No client-side timeout by default — the server cancels the payment on
         * its own schedule. Pass `options.timeoutMs` for a client-side ceiling.
         */
        awaitPaymentStatus(
            options?: AwaitPaymentStatusOptions,
        ): Promise<PaymentDetails> {
            return awaitPaymentStatus(
                () =>
                    client.get<PaymentDetails>(`/payments/${pid}`, {
                        signal: options?.signal,
                    }),
                options,
            );
        },
    };
}
