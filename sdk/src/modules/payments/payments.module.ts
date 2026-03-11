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
     * GET /payments/{payment_id}/apple-pay/info
     *
     * @param paymentId - Payment session ID
     */
    async getApplePayInfo(paymentId: string): Promise<ApplePayInfoResponse> {
        return this.client.get<ApplePayInfoResponse>(
            `/payments/${paymentId}/apple-pay/info`,
        );
    }

    /**
     * Validate the Apple Pay merchant session.
     * Pass the `origin` from the document where the Apple Pay button is displayed.
     *
     * POST /payments/{payment_id}/apple-pay/validate
     *
     * @param paymentId - Payment session ID
     * @param origin    - Origin of the page displaying the Apple Pay button (e.g. "https://shop.example.com")
     */
    async validateApplePayMerchant(
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
