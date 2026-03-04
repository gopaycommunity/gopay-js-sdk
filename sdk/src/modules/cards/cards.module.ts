import type { HttpClient } from '../../http/client.js';
import type { components } from '../../types/generated.js';

type CardTokenRequest =
    components['requestBodies']['Card-Token-Request']['content']['application/json'];
type CardTokenResponse =
    components['responses']['Card-Token-Response']['content']['application/json'];

export class CardsModule {
    // biome-ignore lint/correctness/noUnusedPrivateClassMembers: stub — will be used when implemented
    constructor(private readonly client: HttpClient) {}

    /**
     * Tokenize encrypted card data.
     * Requires the `card:save` OAuth2 scope.
     *
     * POST /cards/tokens
     */
    async createToken(_params: CardTokenRequest): Promise<CardTokenResponse> {
        throw new Error('Not implemented');
    }
}
