import {
    GoPayErrorCodes,
    GoPaySDKError,
    type HttpClient,
} from '@gopay-internal/core';
import type { components } from '../../types/generated.js';

type RefundCreateRequest = components['schemas']['Refund-Create-Request'];
type RefundDetails = components['schemas']['Refund-Details'];

function requirePaymentId(paymentId: string): string {
    if (typeof paymentId !== 'string' || !paymentId.trim()) {
        throw new GoPaySDKError('[GoPaySDK] paymentId is required', {
            errorCode: GoPayErrorCodes.INVALID_ARGUMENT,
        });
    }
    return paymentId.trim();
}

function requireRefundId(refundId: string): string {
    if (typeof refundId !== 'string' || !refundId.trim()) {
        throw new GoPaySDKError('[GoPaySDK] refundId is required', {
            errorCode: GoPayErrorCodes.INVALID_ARGUMENT,
        });
    }
    return refundId.trim();
}

export function createRefundsApi(client: HttpClient) {
    return {
        /**
         * Refund a payment (fully or partially).
         * Requires the `payment:write` OAuth2 scope.
         *
         * POST /payments/{payment_id}/refunds
         *
         * @param paymentId - Payment session ID returned by {@link createPayment}
         * @param params    - Refund parameters, including the amount in cents
         */
        async refundPayment(
            paymentId: string,
            params: RefundCreateRequest,
        ): Promise<RefundDetails> {
            const pid = requirePaymentId(paymentId);
            return client.post<RefundDetails>(
                `/payments/${pid}/refunds`,
                params,
            );
        },

        /**
         * List all refunds for a payment.
         * Requires the `payment:read` OAuth2 scope.
         *
         * GET /payments/{payment_id}/refunds
         *
         * @param paymentId - Payment session ID returned by {@link createPayment}
         */
        async listRefunds(paymentId: string): Promise<RefundDetails[]> {
            const pid = requirePaymentId(paymentId);
            return client.get<RefundDetails[]>(`/payments/${pid}/refunds`);
        },

        /**
         * Retrieve details of a single refund.
         * Requires the `payment:read` OAuth2 scope.
         *
         * GET /refunds/{refund_id}
         *
         * @param refundId - Refund ID returned by {@link refundPayment}
         */
        async getRefund(refundId: string): Promise<RefundDetails> {
            const rid = requireRefundId(refundId);
            return client.get<RefundDetails>(`/refunds/${rid}`);
        },
    };
}
