import type { HttpClient } from '../../http/client.js';
import type { CardTokenRequest, CardTokenResponse } from './cards.types.js';

export class CardsModule {
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
