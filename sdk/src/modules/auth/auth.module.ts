import type { HttpClient } from '../../http/client.js';
import type { AuthenticateRequest, TokenPair } from './auth.types.js';

export class AuthModule {
  constructor(private readonly client: HttpClient) {}

  /**
   * Obtain an access/refresh token pair.
   *
   * Grant types:
   * - `client_credentials` — use HTTP Basic credentials (pass via Authorization header)
   * - `refresh_token` — exchange an existing refresh token
   *
   * POST /oauth2/token
   */
  async authenticate(_params: AuthenticateRequest): Promise<TokenPair> {
    throw new Error('Not implemented');
  }
}
