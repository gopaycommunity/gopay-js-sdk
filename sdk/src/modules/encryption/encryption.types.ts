// ---------------------------------------------------------------------------
// JWK public key (RFC 7517) returned by GET /encryption/public-key
// ---------------------------------------------------------------------------

export interface JWK {
  /** Key type, always "RSA" */
  kty: string;
  /** Key ID */
  kid: string;
  /** Intended use — "enc" for encryption */
  use: string;
  /** Algorithm — typically "RSA-OAEP-256" */
  alg: string;
  /** Base64url-encoded modulus */
  n: string;
  /** Base64url-encoded public exponent */
  e: string;
}
