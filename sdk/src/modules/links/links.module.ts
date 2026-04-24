import type { HttpClient } from '../../http/client.js';
import type { components } from '../../types/generated.js';

type LinkCreateRequest = components['schemas']['Link-Create-Request'];
type LinkDetails =
    components['responses']['Link-Create-Response']['content']['application/json'];

function requireLinkId(linkId: string): void {
    if (!linkId) {
        throw new Error('linkId is required');
    }
}

export function createLinksApi(client: HttpClient) {
    return {
        /**
         * Create a payment link.
         * Requires the `payment:create` OAuth2 scope.
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
         * Requires the `payment:create` OAuth2 scope.
         *
         * Note: this endpoint uses the `payment:create` scope (not a read scope) — this
         * matches the spec and is intentional on the server side.
         *
         * GET /links/{link_id}
         *
         * @param linkId - Link ID returned by {@link createPaymentLink}
         */
        async linkStatus(linkId: string): Promise<LinkDetails> {
            requireLinkId(linkId);
            return client.get<LinkDetails>(`/links/${linkId}`);
        },

        /**
         * Disable a link.
         * Requires the `payment:create` OAuth2 scope.
         *
         * DELETE /links/{link_id}
         *
         * @param linkId - Link ID returned by {@link createPaymentLink}
         */
        async disableLink(linkId: string): Promise<void> {
            requireLinkId(linkId);
            return client.delete(`/links/${linkId}`);
        },
    };
}
