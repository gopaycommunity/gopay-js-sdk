import { type HttpClient, requireNonEmptyString } from '@gopay-internal/core';
import type { components } from '../../types/generated.js';

type EncryptedCardRequest = components['schemas']['Token-Create-Request'];
type PermanentCardToken = components['schemas']['Permanent-Card-Token-Details'];

export function createCardsApi(client: HttpClient) {
    return {
        /**
         * Retrieve details of a stored permanent card token.
         * Requires the `card:read` OAuth2 scope.
         *
         * GET /cards/tokens/{card_id}
         *
         * @param cardId - Unique identifier of the stored card token
         */
        async getCardDetails(cardId: string): Promise<PermanentCardToken> {
            const cid = requireNonEmptyString(cardId, 'cardId');
            return client.get<PermanentCardToken>(`/cards/tokens/${cid}`);
        },

        /**
         * Delete a stored permanent card token.
         *
         * DELETE /cards/tokens/{card_id}
         *
         * @param cardId - Unique identifier of the stored card token
         */
        async deleteCard(cardId: string): Promise<void> {
            const cid = requireNonEmptyString(cardId, 'cardId');
            return client.delete(`/cards/tokens/${cid}`);
        },

        /**
         * Tokenize an encrypted card payload received from the browser
         * (via `mountCardForm` flow: `'return-payload'`).
         * Requires the `card:write` OAuth2 scope.
         *
         * The `payload` is a JWE compact serialization string produced by the
         * GoPay-hosted card form iframe. It must be forwarded from the browser
         * to your server without modification.
         *
         * POST /cards/tokens
         *
         * @param payload - JWE compact serialization string from the card form
         */
        async tokenizeEncryptedCard(
            payload: string,
        ): Promise<PermanentCardToken> {
            const validPayload = requireNonEmptyString(payload, 'payload');
            const body: EncryptedCardRequest = { payload: validPayload };
            return client.post<PermanentCardToken>('/cards/tokens', body);
        },
    };
}
