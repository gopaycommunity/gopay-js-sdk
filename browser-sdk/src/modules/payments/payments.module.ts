import {
    assertHttpsOrigin,
    awaitCharge,
    type AwaitChargeOptions as CoreAwaitChargeOptions,
    GoPayErrorCodes,
    GoPaySDKError,
    type HttpClient,
} from '@gopay-internal/core';
import type { components } from '../../types/generated.js';
import { collectBrowserData } from './browser-data.js';

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
 * - `{ mode: 'iframe', container }` — mount a sandboxed iframe inside `container`,
 *   removed automatically on terminal charge state.
 * - `{ mode: 'manual' }` — do nothing automatically; handle the redirect URL yourself
 *   via the `onActionRequired` callback in `AwaitChargeOptions`.
 */
export type ThreeDSConfig =
    | { mode?: 'redirect' }
    | { mode: 'iframe'; container: HTMLElement }
    | { mode: 'manual' };

/** Options for {@link awaitChargeState}. */
export type AwaitChargeOptions =
    CoreAwaitChargeOptions<PaymentChargeStatusResponse> & {
        threeDS?: ThreeDSConfig;
    };

function assertHttpsUrl(url: string): void {
    if (new URL(url).protocol !== 'https:') {
        throw new GoPaySDKError(
            `[GoPayBrowserSDK] Redirect URL must use https: protocol. Got "${url}"`,
            { errorCode: GoPayErrorCodes.CHARGE_FAILED },
        );
    }
}

function mountRedirectIframe(
    container: HTMLElement,
    redirectUrl: string,
): HTMLIFrameElement {
    assertHttpsUrl(redirectUrl);
    const iframe = document.createElement('iframe');
    iframe.src = redirectUrl;
    iframe.title = 'GoPay 3DS';
    iframe.setAttribute(
        'sandbox',
        'allow-scripts allow-forms allow-same-origin',
    );
    iframe.referrerPolicy = 'strict-origin';
    iframe.style.display = 'block';
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = 'none';
    container.appendChild(iframe);
    return iframe;
}

function handle3DS(
    threeDS: ThreeDSConfig | undefined,
    redirectUrl: string,
    onActionRequired: ((url: string) => void) | undefined,
): HTMLIFrameElement | undefined {
    const mode = threeDS && 'mode' in threeDS ? threeDS.mode : 'redirect';
    if (mode === 'redirect' || mode == null) {
        assertHttpsUrl(redirectUrl);
        onActionRequired?.(redirectUrl);
        globalThis.location.href = redirectUrl;
        return undefined;
    }
    if (mode === 'iframe') {
        const iframe = mountRedirectIframe(
            (threeDS as { mode: 'iframe'; container: HTMLElement }).container,
            redirectUrl,
        );
        onActionRequired?.(redirectUrl);
        return iframe;
    }
    // mode === 'manual'
    onActionRequired?.(redirectUrl);
    return undefined;
}

export function createPaymentsApi(client: HttpClient, paymentId: string) {
    async function validateApplePayMerchant(
        validationURL?: string,
    ): Promise<ValidateMerchantResponse> {
        const body = validationURL
            ? { validationUrl: validationURL }
            : undefined;
        return client.post<ValidateMerchantResponse>(
            `/payments/${paymentId}/apple-pay/validate`,
            body,
        );
    }

    return {
        /**
         * Retrieve the current status of this payment.
         * GET /payments/{payment_id}
         */
        async getStatus(): Promise<PaymentDetails> {
            return client.get<PaymentDetails>(`/payments/${paymentId}`);
        },

        /**
         * Charge this payment using a payment instrument.
         * Browser context data is collected automatically and merged into the request.
         *
         * POST /payments/{payment_id}/charge
         */
        async chargePayment(
            params: PaymentChargeRequestInput,
        ): Promise<PaymentChargeResponse> {
            const pi = params.payment_instrument;
            if (pi?.payment_instrument === 'PAYMENT_CARD') {
                const collected = collectBrowserData();
                return client.post<PaymentChargeResponse>(
                    `/payments/${paymentId}/charge`,
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
                );
            }
            return client.post<PaymentChargeResponse>(
                `/payments/${paymentId}/charge`,
                params,
            );
        },

        /**
         * Retrieve the current state of this payment's charge.
         * GET /payments/{payment_id}/charge
         */
        async getChargeState(): Promise<PaymentChargeStatusResponse> {
            return client.get<PaymentChargeStatusResponse>(
                `/payments/${paymentId}/charge`,
            );
        },

        /**
         * Poll the charge state until a terminal outcome.
         *
         * By default (`threeDS` omitted or `{ mode: 'redirect' }`), the top-level
         * page is navigated to the ACS URL on `ACTION_REQUIRED` and the returned
         * promise stays pending as the page unloads.
         *
         * Pass `threeDS: { mode: 'iframe', container }` to mount a sandboxed iframe
         * instead (removed automatically on terminal state).
         *
         * Pass `threeDS: { mode: 'manual' }` to handle `ACTION_REQUIRED` yourself
         * via `options.onActionRequired`.
         *
         * Resolves on `SUCCEEDED`. Rejects with `CHARGE_FAILED` on `FAILED`,
         * or `CHARGE_TIMEOUT` if the charge does not leave `REQUESTED`/
         * `PROCESSING` within `initialTimeoutMs` (default 30 s).
         */
        awaitChargeState(
            options?: AwaitChargeOptions,
        ): Promise<PaymentChargeStatusResponse> {
            let redirectIframe: HTMLIFrameElement | undefined;

            const cleanupIframe = () => {
                if (!redirectIframe) {
                    return;
                }
                redirectIframe.src = '';
                redirectIframe.remove();
                redirectIframe = undefined;
            };

            return awaitCharge(
                () =>
                    client.get<PaymentChargeStatusResponse>(
                        `/payments/${paymentId}/charge`,
                    ),
                {
                    ...options,
                    onActionRequired: (redirectUrl) => {
                        redirectIframe ??= handle3DS(
                            options?.threeDS,
                            redirectUrl,
                            options?.onActionRequired,
                        );
                    },
                },
            ).then(
                (state) => {
                    cleanupIframe();
                    return state;
                },
                (err) => {
                    cleanupIframe();
                    throw err;
                },
            );
        },

        /**
         * Retrieve Google Pay configuration for this payment.
         * GET /payments/{payment_id}/google-pay/info
         */
        async getGooglePayInfo(): Promise<GooglePayInfoResponse> {
            return client.get<GooglePayInfoResponse>(
                `/payments/${paymentId}/google-pay/info`,
            );
        },

        /**
         * Retrieve Apple Pay configuration for this payment (web).
         * GET /payments/{payment_id}/apple-pay/info
         */
        async getApplePayInfo(): Promise<ApplePayInfoResponse> {
            return client.get<ApplePayInfoResponse>(
                `/payments/${paymentId}/apple-pay/info`,
            );
        },

        /**
         * Retrieve Apple Pay configuration for this payment (native app).
         * GET /payments/{payment_id}/apple-pay/app-info
         */
        async getApplePayAppInfo(): Promise<ApplePayAppInfoResponse> {
            return client.get<ApplePayAppInfoResponse>(
                `/payments/${paymentId}/apple-pay/app-info`,
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
            origin: string = globalThis.location?.origin ?? '',
            callbacks?: { oncancel?: (event: unknown) => void },
        ): void {
            if (origin) {
                try {
                    assertHttpsOrigin(
                        origin,
                        '[GoPayBrowserSDK] startApplePaySession',
                    );
                } catch (e) {
                    throw client.emitError(e as GoPaySDKError);
                }
            }
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
                    .catch(() => session.abort());
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
                ? `/payments/${paymentId}/qr-payment/info?format=${format}`
                : `/payments/${paymentId}/qr-payment/info`;
            return client.get<QRPaymentDetails>(path);
        },
    };
}
