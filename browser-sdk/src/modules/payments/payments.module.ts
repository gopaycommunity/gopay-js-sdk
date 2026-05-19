import {
    awaitCharge,
    type AwaitChargeOptions as CoreAwaitChargeOptions,
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
type BankAccountChargeData = components['schemas']['Bank-Account-Charge-Data'];
type GooglePayInfoResponse =
    components['responses']['Google-Pay-Info-Response']['content']['application/json'];
type ApplePayInfoResponse =
    components['responses']['Apple-Pay-Info-Response']['content']['application/json'];
type ApplePayAppInfoResponse =
    components['responses']['Appe-Pay-App-Info-Response']['content']['application/json'];
type ValidateMerchantResponse =
    components['responses']['Validate-Merchant-Response']['content']['application/json'];
type QRPaymentDetails = components['schemas']['QR-Payment-Details'];

// Allow callers to omit browser_data — the SDK collects and injects it automatically.
type CardChargeDataInput = Omit<PaymentCardChargeData, 'browser_data'> & {
    browser_data?: Partial<BrowserDataSchema>;
};
type PaymentChargeRequestInput = Omit<
    PaymentChargeRequest,
    'payment_instrument'
> & {
    payment_instrument?: CardChargeDataInput | BankAccountChargeData;
};

/** Options for {@link awaitChargeState}. */
export type AwaitChargeOptions =
    CoreAwaitChargeOptions<PaymentChargeStatusResponse>;

function mountRedirectIframe(
    container: HTMLElement,
    redirectUrl: string,
): HTMLIFrameElement {
    const iframe = document.createElement('iframe');
    iframe.src = redirectUrl;
    iframe.referrerPolicy = 'strict-origin';
    iframe.style.display = 'block';
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = 'none';
    container.appendChild(iframe);
    return iframe;
}

export function createPaymentsApi(client: HttpClient, paymentId: string) {
    async function validateApplePayMerchant(
        validationURL?: string,
    ): Promise<ValidateMerchantResponse> {
        // TODO: move Apple-Validation-Url from header to request body once the revised spec lands
        const headers: Record<string, string> = {};
        if (validationURL) {
            headers['Apple-Validation-Url'] = validationURL;
        }
        return client.post<ValidateMerchantResponse>(
            `/payments/${paymentId}/apple-pay/validate`,
            undefined,
            { headers },
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
                            } as BrowserDataSchema,
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
         * When `container` is provided, a 3DS redirect iframe is mounted
         * inside it on `ACTION_REQUIRED`. Pass `null` to suppress iframe
         * mounting and handle `ACTION_REQUIRED` via `options.onActionRequired`
         * instead (e.g. show a link or redirect the top frame).
         *
         * Resolves on `SUCCEEDED`. Rejects with `CHARGE_FAILED` on `FAILED`,
         * or `CHARGE_TIMEOUT` if the charge does not leave `REQUESTED`/
         * `PROCESSING` within `initialTimeoutMs` (default 30 s).
         */
        awaitChargeState(
            container: HTMLElement | null,
            options?: AwaitChargeOptions,
        ): Promise<PaymentChargeStatusResponse> {
            let redirectIframe: HTMLIFrameElement | undefined;

            const removeRedirectIframe = () => {
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
                        if (container && !redirectIframe) {
                            redirectIframe = mountRedirectIframe(
                                container,
                                redirectUrl,
                            );
                        }
                        options?.onActionRequired?.(redirectUrl);
                    },
                },
            ).then(
                (state) => {
                    removeRedirectIframe();
                    return state;
                },
                (err) => {
                    removeRedirectIframe();
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
                let parsed: URL | undefined;
                try {
                    parsed = new URL(origin);
                } catch {
                    throw new Error(
                        `[GoPayBrowserSDK] startApplePaySession: invalid origin "${origin}"`,
                    );
                }
                if (parsed.protocol !== 'https:' || parsed.origin !== origin) {
                    throw new Error(
                        `[GoPayBrowserSDK] startApplePaySession: origin must be an https: origin. Got "${origin}"`,
                    );
                }
            }
            session.onvalidatemerchant = (event: unknown) => {
                const validationURL = (event as { validationURL?: string })
                    ?.validationURL;
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
