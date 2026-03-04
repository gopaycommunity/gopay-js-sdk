import type { TokenScope } from '../../types/common.js';

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

export interface ClientCredentialsRequest {
  grant_type: 'client_credentials';
  /** Space-separated scopes to request. */
  scope: TokenScope | string;
}

export interface RefreshTokenRequest {
  grant_type: 'refresh_token';
  refresh_token: string;
  client_id?: string;
  /** Space-separated scopes to request. */
  scope?: TokenScope | string;
}

export type AuthenticateRequest = ClientCredentialsRequest | RefreshTokenRequest;

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export interface TokenPair {
  token_type: 'bearer';
  access_token: string;
  refresh_token: string;
  scope: string;
  /** Seconds until the access token expires. */
  expires_in: number;
  /** Seconds until the refresh token expires. */
  refresh_expires_in: number;
}
