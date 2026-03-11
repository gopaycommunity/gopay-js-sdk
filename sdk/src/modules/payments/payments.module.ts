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
     * GET /payments/{payment_id}/info/google-pay
     *
     * @param paymentId - Payment session ID
     */
    async getGooglePayInfo(_paymentId: string): Promise<GooglePayInfoResponse> {
        throw new Error('Not implemented');
    }

    /**
     * Retrieve Apple Pay configuration for this payment.
     *
     * GET /payments/{payment_id}/apple-pay/info
     *
     * @param paymentId - Payment session ID
     */
    async getApplePayInfo(_paymentId: string): Promise<ApplePayInfoResponse> {
        throw new Error('Not implemented');
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
        _paymentId: string,
        _origin: string,
    ): Promise<ValidateMerchantResponse> {
        throw new Error('Not implemented');
    }
}
