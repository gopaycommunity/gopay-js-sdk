import {
    awaitPaymentStatus,
    type AwaitPaymentStatusOptions as CoreAwaitPaymentStatusOptions,
    type HttpClient,
    requireNonEmptyString,
} from '@gopay-internal/core';
import type { components } from '../../types/generated.js';

type RefundCreateRequest = components['schemas']['Refund-Create-Request'];
type RefundDetails = components['schemas']['Refund-Details'];

/** Options for {@link awaitRefundState}. */
export type AwaitRefundStateOptions =
    CoreAwaitPaymentStatusOptions<RefundDetails>;

/** A refund is done when it reaches one of these; `REQUESTED` means still processing. */
const REFUND_TERMINAL_STATES = ['SUCCESS', 'FAILED'];

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
            options?: { signal?: AbortSignal },
        ): Promise<RefundDetails> {
            const pid = requireNonEmptyString(paymentId, 'paymentId');
            return client.post<RefundDetails>(
                `/payments/${pid}/refunds`,
                params,
                options,
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
        async listRefunds(
            paymentId: string,
            options?: { signal?: AbortSignal },
        ): Promise<RefundDetails[]> {
            const pid = requireNonEmptyString(paymentId, 'paymentId');
            return client.get<RefundDetails[]>(
                `/payments/${pid}/refunds`,
                options,
            );
        },

        /**
         * Retrieve details of a single refund.
         * Requires the `payment:read` OAuth2 scope.
         *
         * GET /refunds/{refund_id}
         *
         * @param refundId - Refund ID returned by {@link refundPayment}
         */
        async getRefund(
            refundId: string,
            options?: { signal?: AbortSignal },
        ): Promise<RefundDetails> {
            const rid = requireNonEmptyString(refundId, 'refundId');
            return client.get<RefundDetails>(`/refunds/${rid}`, options);
        },

        /**
         * Poll a refund until it settles.
         *
         * `refundPayment` only returns `REQUESTED` — the refund is accepted, not
         * settled — so callers otherwise have to write this loop themselves.
         * Resolves with the refund once it reaches `SUCCESS` or `FAILED`; note
         * that `FAILED` resolves rather than rejects, since it is a legitimate
         * outcome the caller has to inspect.
         *
         * No client-side timeout by default. Pass `options.timeoutMs` for a
         * ceiling, or `options.signal` to abort.
         *
         * @param refundId - Refund ID returned by {@link refundPayment}
         * @param options  - Polling configuration and callbacks
         */
        awaitRefundState(
            refundId: string,
            options?: AwaitRefundStateOptions,
        ): Promise<RefundDetails> {
            const rid = requireNonEmptyString(refundId, 'refundId');
            return awaitPaymentStatus(
                () =>
                    client.get<RefundDetails>(`/refunds/${rid}`, {
                        signal: options?.signal,
                    }),
                {
                    ...options,
                    terminalStates:
                        options?.terminalStates ?? REFUND_TERMINAL_STATES,
                },
            );
        },
    };
}
