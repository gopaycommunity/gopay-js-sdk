import {
    awaitCharge,
    type AwaitChargeOptions as CoreAwaitChargeOptions,
    type HttpClient,
} from '@gopay-internal/core';
import type { components } from '../../types/generated.js';

type PaymentCreateRequest = components['schemas']['Payment-Create-Request'];
type PaymentDetails = components['schemas']['Payment-Details'];
type PaymentChargeRequest = components['schemas']['Payment-Charge-Input'];
type PaymentChargeResponse = components['schemas']['Payment-Charge-Response'];
type PaymentChargeStatusResponse =
    components['schemas']['Payment-Charge-Status-Response'];

/** Options for {@link awaitChargeState}. */
export type AwaitChargeOptions =
    CoreAwaitChargeOptions<PaymentChargeStatusResponse>;
type GooglePayInfoResponse =
    components['responses']['Google-Pay-Info-Response']['content']['application/json'];
type ApplePayInfoResponse =
    components['responses']['Apple-Pay-Info-Response']['content']['application/json'];
type ValidateMerchantResponse =
    components['responses']['Validate-Merchant-Response']['content']['application/json'];
type QRPaymentDetails = components['schemas']['QR-Payment-Details'];

function requirePaymentId(paymentId: string): void {
    if (!paymentId) {
        throw new Error('paymentId is required');
    }
}

export function createPaymentsApi(client: HttpClient) {
    return {
        /**
         * Retrieve the current status of an existing payment.
         *
         * GET /payments/{payment_id}
         *
         * @param paymentId - Payment session ID returned by {@link createPayment}
         */
        async getPaymentStatus(paymentId: string): Promise<PaymentDetails> {
            requirePaymentId(paymentId);
            return client.get<PaymentDetails>(`/payments/${paymentId}`);
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
        ): Promise<PaymentDetails> {
            return client.post<PaymentDetails>(
                `/eshops/${goid}/payments`,
                params,
            );
        },

        /**
         * Charge a payment using a payment instrument.
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
            return client.post<PaymentChargeResponse>(
                `/payments/${paymentId}/charge`,
                params,
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
        ): Promise<PaymentChargeStatusResponse> {
            requirePaymentId(paymentId);
            return client.get<PaymentChargeStatusResponse>(
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
         * Wire merchant validation onto an ApplePaySession and begin it.
         * Handles the onvalidatemerchant callback via POST /payments/{payment_id}/apple-pay/validate.
         *
         * @param paymentId - Payment session ID
         * @param session   - ApplePaySession instance
         * @param origin    - Merchant origin (https:); defaults to current page origin
         * @param callbacks - Optional lifecycle callbacks
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
            callbacks?: { oncancel?: (event: unknown) => void },
        ): void {
            requirePaymentId(paymentId);
            if (origin) {
                let parsed: URL | undefined;
                try {
                    parsed = new URL(origin);
                } catch {
                    throw new Error(
                        `startApplePaySession: invalid origin "${origin}"`,
                    );
                }
                if (parsed.protocol !== 'https:' || parsed.origin !== origin) {
                    throw new Error(
                        `startApplePaySession: origin must be an https: origin. Got "${origin}"`,
                    );
                }
            }
            session.onvalidatemerchant = (event: unknown) => {
                const validationURL = (event as { validationURL?: string })
                    ?.validationURL;
                const headers: Record<string, string> = { Origin: origin };
                // TODO: move Apple-Validation-Url from header to request body once the revised spec lands
                if (validationURL)
                    headers['Apple-Validation-Url'] = validationURL;
                client
                    .post<ValidateMerchantResponse>(
                        `/payments/${paymentId}/apple-pay/validate`,
                        undefined,
                        { headers },
                    )
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
        ): Promise<QRPaymentDetails> {
            requirePaymentId(paymentId);
            const path = format
                ? `/payments/${paymentId}/qr-payment/info?format=${format}`
                : `/payments/${paymentId}/qr-payment/info`;
            return client.get<QRPaymentDetails>(path);
        },

        /**
         * Poll the charge state until a terminal outcome.
         *
         * Resolves on `SUCCEEDED`. Rejects with `CHARGE_FAILED` on `FAILED`,
         * or `CHARGE_TIMEOUT` if the charge does not leave `REQUESTED`/
         * `PROCESSING` within `initialTimeoutMs` (default 30 s).
         *
         * Use `options.onActionRequired` to handle 3DS redirects
         * (e.g. redirect the customer or open a popup).
         *
         * @param paymentId - Payment session ID
         * @param options   - Polling configuration and callbacks
         */
        awaitChargeState(
            paymentId: string,
            options?: AwaitChargeOptions,
        ): Promise<PaymentChargeStatusResponse> {
            requirePaymentId(paymentId);
            return awaitCharge(
                () =>
                    client.get<PaymentChargeStatusResponse>(
                        `/payments/${paymentId}/charge`,
                    ),
                options,
            );
        },
    };
}
