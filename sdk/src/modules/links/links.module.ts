import { type HttpClient, requireNonEmptyString } from '@gopay-internal/core';
import type { components } from '../../types/generated.js';

type LinkCreateRequest = components['schemas']['Link-Create-Request'];
type LinkDetails = components['schemas']['Link-Details'];

export function createLinksApi(client: HttpClient) {
    return {
        /**
         * Create a payment link.
         * Requires the `payment:write` OAuth2 scope.
         *
         * POST /eshops/{goid}/links
         *
         * @param goid   - Merchant's GoPay ID (eshop identifier)
         * @param params - Link creation parameters including payment data, expiry, and reusability
         */
        async createPaymentLink(
            goid: string,
            params: LinkCreateRequest,
        ): Promise<LinkDetails> {
            return client.post<LinkDetails>(`/eshops/${goid}/links`, params);
        },

        /**
         * Link status.
         * Requires the `payment:read` OAuth2 scope.
         *
         * GET /links/{link_id}
         *
         * @param linkId - Link ID returned by {@link createPaymentLink}
         */
        async linkStatus(linkId: string): Promise<LinkDetails> {
            const lid = requireNonEmptyString(linkId, 'linkId');
            return client.get<LinkDetails>(`/links/${lid}`);
        },

        /**
         * Disable a link.
         * Requires the `payment:write` OAuth2 scope.
         *
         * DELETE /links/{link_id}
         *
         * @param linkId - Link ID returned by {@link createPaymentLink}
         */
        async disableLink(linkId: string): Promise<void> {
            const lid = requireNonEmptyString(linkId, 'linkId');
            return client.delete(`/links/${lid}`);
        },
    };
}
