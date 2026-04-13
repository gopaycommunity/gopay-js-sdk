import type { HttpClient } from '../../http/client.js';
import type { components } from '../../types/generated.js';
import { collectBrowserData } from './browser-data.js';

type PaymentCreateRequest =
    components['requestBodies']['Payment-Create-Request']['content']['application/json'];
type PaymentCreateResponse =
    components['responses']['Payment-Status-Response']['content']['application/json'];
type PaymentChargeRequest =
    components['requestBodies']['Payment-Charge-Request']['content']['application/json'];
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

/**
 * Manages payment sessions and charging flows.
 *
 * All methods that call the API may additionally throw {@link GoPayHTTPError}
 * (non-2xx response) or {@link GoPaySDKError} (auth / network failures —
 * see {@link GoPayErrorCodes}).
 */
export class PaymentsModule {
    constructor(private readonly client: HttpClient) {}

    /**
     * Retrieve the current status of an existing payment.
     *
     * GET /payments/{payment_id}
     *
     * @param paymentId - Payment session ID returned by {@link create}
     */
    async getStatus(paymentId: string): Promise<PaymentStatusResponse> {
        requirePaymentId(paymentId);
        return this.client.get<PaymentStatusResponse>(`/payments/${paymentId}`);
    }

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
     * Browser context (`browser_data`) is collected automatically via
     * {@link collectBrowserData} and merged into the request. Any fields
     * supplied in `params.browser_data` take precedence over the collected values.
     *
     * POST /payments/{payment_id}/charge
     *
     * @param paymentId - Payment session ID returned by {@link create}
     * @param params    - Charge parameters including payment instrument details
     *
     * @throws {@link GoPayHTTPError} when the API returns a non-2xx response.
     *   Inspect `err.status` and `err.body` to distinguish failure reasons
     *   (e.g. card declined, invalid params, server error).
     */
    async charge(
        paymentId: string,
        params: PaymentChargeRequest,
    ): Promise<PaymentChargeResponse> {
        requirePaymentId(paymentId);
        const mergedParams = {
            ...params,
            browser_data: { ...collectBrowserData(), ...params.browser_data },
        };
        return this.client.post<PaymentChargeResponse>(
            `/payments/${paymentId}/charge`,
            mergedParams,
        );
    }

    /**
     * Retrieve the current state of a payment charge.
     *
     * GET /payments/{payment_id}/charge
     *
     * @param paymentId - Payment session ID returned by {@link create}
     */
    async getChargeState(
        paymentId: string,
    ): Promise<PaymentChargeStateResponse> {
        requirePaymentId(paymentId);
        return this.client.get<PaymentChargeStateResponse>(
            `/payments/${paymentId}/charge`,
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
        requirePaymentId(paymentId);
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
        requirePaymentId(paymentId);
        return this.client.get<ApplePayInfoResponse>(
            `/payments/${paymentId}/apple-pay/info`,
        );
    }

    private async validateApplePayMerchant(
        paymentId: string,
        origin: string,
    ): Promise<ValidateMerchantResponse> {
        requirePaymentId(paymentId);
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
     * Also wires `oncancel` — if the user dismisses the Apple Pay sheet,
     * `callbacks.oncancel` is called with the cancel event.
     *
     * The caller is still responsible for creating the session (must happen
     * synchronously from a user-gesture handler) and for handling
     * `onpaymentauthorized`.
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
        // Validate the origin sent to the Apple Pay merchant-validation endpoint.
        // It must be an https: URL whose origin equals itself (no path/query/hash).
        // Callers cannot spoof an arbitrary host through this parameter.
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
            this.validateApplePayMerchant(paymentId, origin)
                .then((merchantSession) =>
                    session.completeMerchantValidation(merchantSession),
                )
                .catch(() => session.abort());
        };
        session.oncancel = (event) => {
            callbacks?.oncancel?.(event);
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
        requirePaymentId(paymentId);
        const path = format
            ? `/payments/${paymentId}/qr-payment/info?format=${format}`
            : `/payments/${paymentId}/qr-payment/info`;
        return this.client.get<QRPaymentInfoResponse>(path);
    }
}
