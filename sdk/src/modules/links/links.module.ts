import { type HttpClient, requireNonEmptyString } from '@gopay-internal/core';
import type { components } from '../../types/generated.js';

type LinkCreateRequest = components['schemas']['Link-Create-Request'];
type LinkDetails = components['schemas']['Link-Details'];

/**
 * Parameters for {@link createPaymentLink}.
 *
 * `reusable` defaults to `true` server-side, but the spec gives it a `default`
 * rather than leaving it out of `required`, so codegen emits it as mandatory.
 * Widened back to optional here so callers can omit it, as the API allows.
 */
export type CreatePaymentLinkParams = Omit<LinkCreateRequest, 'reusable'> & {
    reusable?: boolean;
};

export function createLinksApi(client: HttpClient) {
    return {
        /**
         * Create a payment link.
         * Requires the `payment:write` OAuth2 scope.
         *
         * POST /eshops/{goid}/links
         *
         * A link only stores payment data — no payment exists until a customer
         * opens it. The response carries two distinct identifiers: `id`, for
         * {@link getPaymentLink} and {@link disablePaymentLink}, and `url`, the
         * address to share with the customer. Neither can be derived from the
         * other, so keep `id` if you intend to manage the link later.
         *
         * @param goid   - Merchant's GoPay ID (eshop identifier)
         * @param params - Link parameters: the payment data, plus optional
         *                 `expires_in` (seconds; omit for a link that never
         *                 expires) and `reusable` (defaults to `true`)
         */
        async createPaymentLink(
            goid: string,
            params: CreatePaymentLinkParams,
            options?: { signal?: AbortSignal },
        ): Promise<LinkDetails> {
            const id = requireNonEmptyString(goid, 'goid');
            return client.post<LinkDetails>(
                `/eshops/${id}/links`,
                params,
                options,
            );
        },

        /**
         * Retrieve the current settings and state of a payment link.
         * Requires the `payment:read` OAuth2 scope.
         *
         * GET /eshops/{goid}/links/{link_id}
         *
         * Expiry is evaluated on read, so a link past its `expires_at` comes
         * back as `active: false` with `stop_reason: 'EXPIRED'` — there is no
         * need to compare `expires_at` against the clock yourself.
         *
         * @param goid   - Merchant's GoPay ID (eshop identifier)
         * @param linkId - Link ID returned by {@link createPaymentLink} — not
         *                 the code at the end of the link's `url`
         */
        async getPaymentLink(
            goid: string,
            linkId: string,
            options?: { signal?: AbortSignal },
        ): Promise<LinkDetails> {
            const id = requireNonEmptyString(goid, 'goid');
            const lid = requireNonEmptyString(linkId, 'linkId');
            return client.get<LinkDetails>(
                `/eshops/${id}/links/${lid}`,
                options,
            );
        },

        /**
         * Disable a payment link so it can no longer start a new payment.
         * Requires the `payment:write` OAuth2 scope.
         *
         * DELETE /eshops/{goid}/links/{link_id}
         *
         * This is not a delete: the link stays readable through
         * {@link getPaymentLink} and reports `stop_reason: 'FROM_API'`.
         * Disabling an already-inactive link is rejected with `409` — including
         * a one-shot link that has been used, which keeps redirecting to the
         * payment it created. Cancel that payment to stop it.
         *
         * @param goid   - Merchant's GoPay ID (eshop identifier)
         * @param linkId - Link ID returned by {@link createPaymentLink}
         */
        async disablePaymentLink(
            goid: string,
            linkId: string,
            options?: { signal?: AbortSignal },
        ): Promise<void> {
            const id = requireNonEmptyString(goid, 'goid');
            const lid = requireNonEmptyString(linkId, 'linkId');
            return client.delete(`/eshops/${id}/links/${lid}`, options);
        },
    };
}
