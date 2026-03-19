import type { HttpClient } from '../../http/client.js';
import type { components } from '../../types/generated.js';

type PaymentCreateRequest =
    components['requestBodies']['Payment-Create-Request']['content']['application/json'];
type PaymentCreateResponse =
    components['responses']['Payment-Create-Response']['content']['application/json'];
type PaymentChargeRequest =
    components['requestBodies']['Payment-Charge-Request']['content']['application/json'];
type PaymentChargeResponse =
    components['responses']['Payment-Charge-Response']['content']['application/json'];
type GooglePayInfoResponse =
    components['responses']['Google-Pay-Info-Response']['content']['application/json'];
type ApplePayInfoResponse =
    components['responses']['Apple-Pay-Info-Response']['content']['application/json'];
type ValidateMerchantResponse =
    components['responses']['Validate-Merchant-Response']['content']['application/json'];
type QRPaymentInfoResponse =
    components['responses']['QR-Payment-Info-Response']['content']['application/json'];

export class PaymentsModule {
    constructor(private readonly client: HttpClient) {}

    /**
     * Create a new payment session.
     *
     * POST /eshops/{goid}/payments
     *
     * @param goid   - Merchant's GoPay ID (eshop identifier)
     * @param params - Payment creation parameters
     */
    async create(
        goid: string,
        params: PaymentCreateRequest,
    ): Promise<PaymentCreateResponse> {
        return this.client.post<PaymentCreateResponse>(
            `/eshops/${goid}/payments`,
            params,
        );
    }

    /**
     * Charge a payment using a payment instrument.
     * Requires the `payment:create` OAuth2 scope.
     *
     * POST /payments/{payment_id}/charge
     *
     * @param paymentId - Payment session ID returned by {@link create}
     * @param params    - Charge parameters including payment instrument details
     */
    async charge(
        paymentId: string,
        params: PaymentChargeRequest,
    ): Promise<PaymentChargeResponse> {
        return this.client.post<PaymentChargeResponse>(
            `/payments/${paymentId}/charge`,
            params,
        );
    }

    /**
     * Retrieve Google Pay configuration for this payment.
     *
     * Returns the fields needed to initialise a Google Pay flow:
     * - `environment` — `"TEST"` or `"PRODUCTION"`, pass to `PaymentsClient`
     * - `paymentDataRequest` — pre-filled `PaymentDataRequest` object (allowed
     *   auth methods/networks, transaction info, merchant info, etc.)
     *
     * GET /payments/{payment_id}/google-pay/info
     *
     * @param paymentId - Payment session ID
     */
    async getGooglePayInfo(paymentId: string): Promise<GooglePayInfoResponse> {
        return this.client.get<GooglePayInfoResponse>(
            `/payments/${paymentId}/google-pay/info`,
        );
    }

    /**
     * Retrieve Apple Pay configuration for this payment.
     *
     * Returns the fields needed to initialise an `ApplePaySession`:
     * - `applepayVersion` — Apple Pay JS API version number
     * - `merchantIdentifier` — registered Apple Pay merchant ID
     * - `applePayPaymentRequest` — pre-filled `PaymentRequest` object (supported
     *   networks, country/currency codes, total, etc.)
     *
     * GET /payments/{payment_id}/apple-pay/info
     *
     * @param paymentId - Payment session ID
     */
    async getApplePayInfo(paymentId: string): Promise<ApplePayInfoResponse> {
        return this.client.get<ApplePayInfoResponse>(
            `/payments/${paymentId}/apple-pay/info`,
        );
    }

    private async validateApplePayMerchant(
        paymentId: string,
        origin: string,
    ): Promise<ValidateMerchantResponse> {
        return this.client.post<ValidateMerchantResponse>(
            `/payments/${paymentId}/apple-pay/validate`,
            undefined,
            { headers: { Origin: origin } },
        );
    }

    /**
     * Wire merchant validation onto an `ApplePaySession` and begin it.
     *
     * Handles the `onvalidatemerchant` callback automatically:
     * calls `validateApplePayMerchant`, passes the result to
     * `session.completeMerchantValidation`, and aborts the session on failure.
     *
     * The caller is still responsible for creating the session (must happen
     * synchronously from a user-gesture handler) and for handling
     * `onpaymentauthorized` and `oncancel`.
     *
     * @param paymentId - Payment session ID
     * @param session   - `ApplePaySession` instance created by the caller
     * @param origin    - Origin of the page; defaults to `window.location.origin`
     */
    startApplePaySession(
        paymentId: string,
        session: {
            onvalidatemerchant: ((event: unknown) => void) | null;
            completeMerchantValidation(merchantSession: unknown): void;
            abort(): void;
            begin(): void;
        },
        origin: string = globalThis.location?.origin ?? '',
    ): void {
        session.onvalidatemerchant = async () => {
            try {
                const merchantSession = await this.validateApplePayMerchant(
                    paymentId,
                    origin,
                );
                session.completeMerchantValidation(merchantSession);
            } catch (err) {
                session.abort();
                throw err;
            }
        };
        session.begin();
    }

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
        const path = format
            ? `/payments/${paymentId}/qr-payment/info?format=${format}`
            : `/payments/${paymentId}/qr-payment/info`;
        return this.client.get<QRPaymentInfoResponse>(path);
    }
}
