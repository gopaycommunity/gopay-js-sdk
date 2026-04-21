import type { HttpClient } from '../../http/client.js';
import type { components } from '../../types/generated.js';
import { collectBrowserData } from './browser-data.js';

type PaymentCreateRequest = components['schemas']['Payment-Create-Request'];
type PaymentCreateResponse =
    components['responses']['Payment-Status-Response']['content']['application/json'];
type PaymentChargeRequest = components['schemas']['Payment-Charge-Input'];
type PaymentChargeResponse =
    components['responses']['Payment-Charge-Response']['content']['application/json'];
type GooglePayInfoResponse =
    components['responses']['Google-Pay-Info-Response']['content']['application/json'];
type ValidateMerchantResponse =
    components['responses']['Validate-Merchant-Response']['content']['application/json'];
type ApplePayInfoResponse =
    components['responses']['Apple-Pay-Info-Response']['content']['application/json'];
type QRPaymentInfoResponse =
    components['responses']['QR-Payment-Info-Response']['content']['application/json'];
type PaymentStatusResponse =
    components['responses']['Payment-Status-Response']['content']['application/json'];
type PaymentChargeStateResponse =
    components['responses']['Payment-Charge-State-Response']['content']['application/json'];

function requirePaymentId(paymentId: string): void {
    if (!paymentId) {
        throw new Error('paymentId is required');
    }
}

export function createPaymentsApi(client: HttpClient) {
    async function validateApplePayMerchant(
        paymentId: string,
        origin: string,
    ): Promise<ValidateMerchantResponse> {
        requirePaymentId(paymentId);
        return client.post<ValidateMerchantResponse>(
            `/payments/${paymentId}/apple-pay/validate`,
            undefined,
            { headers: { Origin: origin } },
        );
    }

    return {
        /**
         * Retrieve the current status of an existing payment.
         *
         * GET /payments/{payment_id}
         *
         * @param paymentId - Payment session ID returned by {@link createPayment}
         */
        async getPaymentStatus(
            paymentId: string,
        ): Promise<PaymentStatusResponse> {
            requirePaymentId(paymentId);
            return client.get<PaymentStatusResponse>(`/payments/${paymentId}`);
        },

        /**
         * Create a new payment session.
         *
         * POST /eshops/{goid}/payments
         *
         * The response includes a `gw_url` field — **ignore it**. It exists only for
         * backward compatibility with pre-SDK redirect-based integrations. This SDK's
         * flow is always: create → charge (via card token, Apple Pay, or Google Pay).
         *
         * @param goid   - Merchant's GoPay ID (eshop identifier)
         * @param params - Payment creation parameters
         */
        async createPayment(
            goid: string,
            params: PaymentCreateRequest,
        ): Promise<PaymentCreateResponse> {
            return client.post<PaymentCreateResponse>(
                `/eshops/${goid}/payments`,
                params,
            );
        },

        /**
         * Charge a payment using a payment instrument.
         * Requires the `payment:create` OAuth2 scope.
         *
         * Browser context (`browser_data`) is collected automatically via
         * {@link collectBrowserData} and merged into the request. Any fields
         * supplied in `params.browser_data` take precedence over the collected values.
         *
         * POST /payments/{payment_id}/charge
         *
         * @param paymentId - Payment session ID returned by {@link createPayment}
         * @param params    - Charge parameters including payment instrument details
         */
        async chargePayment(
            paymentId: string,
            params: PaymentChargeRequest,
        ): Promise<PaymentChargeResponse> {
            requirePaymentId(paymentId);
            const mergedParams = {
                ...params,
                browser_data: {
                    ...collectBrowserData(),
                    ...params.browser_data,
                },
            };
            return client.post<PaymentChargeResponse>(
                `/payments/${paymentId}/charge`,
                mergedParams,
            );
        },

        /**
         * Retrieve the current state of a payment charge.
         *
         * GET /payments/{payment_id}/charge
         *
         * @param paymentId - Payment session ID returned by {@link createPayment}
         */
        async getChargeState(
            paymentId: string,
        ): Promise<PaymentChargeStateResponse> {
            requirePaymentId(paymentId);
            return client.get<PaymentChargeStateResponse>(
                `/payments/${paymentId}/charge`,
            );
        },

        /**
         * Retrieve Google Pay configuration for this payment.
         *
         * GET /payments/{payment_id}/google-pay/info
         *
         * @param paymentId - Payment session ID
         */
        async getGooglePayInfo(
            paymentId: string,
        ): Promise<GooglePayInfoResponse> {
            requirePaymentId(paymentId);
            return client.get<GooglePayInfoResponse>(
                `/payments/${paymentId}/google-pay/info`,
            );
        },

        /**
         * Retrieve Apple Pay configuration for this payment.
         *
         * GET /payments/{payment_id}/apple-pay/info
         *
         * @param paymentId - Payment session ID
         */
        async getApplePayInfo(
            paymentId: string,
        ): Promise<ApplePayInfoResponse> {
            requirePaymentId(paymentId);
            return client.get<ApplePayInfoResponse>(
                `/payments/${paymentId}/apple-pay/info`,
            );
        },

        /**
         * Wire merchant validation onto an `ApplePaySession` and begin it.
         *
         * Handles the `onvalidatemerchant` callback automatically.
         *
         * @param paymentId - Payment session ID
         * @param session   - `ApplePaySession` instance created by the caller
         * @param origin    - Origin of the page; defaults to `window.location.origin`
         * @param callbacks - Optional event callbacks (`oncancel`)
         */
        startApplePaySession(
            paymentId: string,
            session: {
                onvalidatemerchant: ((event: unknown) => void) | null;
                oncancel: ((event: unknown) => void) | null;
                completeMerchantValidation(merchantSession: unknown): void;
                abort(): void;
                begin(): void;
            },
            origin: string = globalThis.location?.origin ?? '',
            callbacks?: {
                oncancel?: (event: unknown) => void;
            },
        ): void {
            requirePaymentId(paymentId);
            if (origin) {
                let parsed: URL | undefined;
                try {
                    parsed = new URL(origin);
                } catch {
                    throw new Error(
                        `[GoPaySDK] startApplePaySession: invalid origin "${origin}"`,
                    );
                }
                if (parsed.protocol !== 'https:' || parsed.origin !== origin) {
                    throw new Error(
                        `[GoPaySDK] startApplePaySession: origin must be an https: origin (e.g. "https://example.com"). Got "${origin}"`,
                    );
                }
            }
            session.onvalidatemerchant = () => {
                validateApplePayMerchant(paymentId, origin)
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
         * Returns recipient details and base64-encoded QR code image(s).
         *
         * GET /payments/{payment_id}/qr-payment/info
         *
         * @param paymentId - Payment session ID
         * @param format    - Image format of the QR code: 'png' (default) or 'svg'
         */
        async getQRPaymentInfo(
            paymentId: string,
            format?: 'png' | 'svg',
        ): Promise<QRPaymentInfoResponse> {
            requirePaymentId(paymentId);
            const path = format
                ? `/payments/${paymentId}/qr-payment/info?format=${format}`
                : `/payments/${paymentId}/qr-payment/info`;
            return client.get<QRPaymentInfoResponse>(path);
        },
    };
}
