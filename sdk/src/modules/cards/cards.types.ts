import type { CardScheme, CardServiceType } from '../../types/common.js';

// ---------------------------------------------------------------------------
// Request body for POST /cards/tokens
// ---------------------------------------------------------------------------

export interface CardTokenRequest {
  /** JWE-encrypted card data produced using the public key from /encryption/public-key */
  payload: string;
  /** Whether to create a reusable (permanent) token. Defaults to false. */
  permanent?: boolean;
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

interface BaseCardTokenResponse {
  /** Masked PAN, e.g. "411111******1111" */
  masked_pan: string;
  expiration_month: string;
  expiration_year: string;
  scheme: CardScheme;
  /** Stable fingerprint for this card number */
  fingerprint: string;
  /** The card token to use in subsequent charge requests */
  token: string;
  brand?: string;
  service_type?: CardServiceType;
}

export interface OnetimeCardTokenResponse extends BaseCardTokenResponse {
  permanent: false;
}

export interface PermanentCardTokenResponse extends BaseCardTokenResponse {
  permanent: true;
  /** Identifier for the stored card */
  card_id: string;
  masked_virtual_pan?: string;
  card_art_url?: string;
}

export type CardTokenResponse = OnetimeCardTokenResponse | PermanentCardTokenResponse;
