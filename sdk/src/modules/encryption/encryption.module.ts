import type { HttpClient } from '../../http/client.js';
import type { components } from '../../types/generated.js';

type JWK = components['schemas']['JWK'];

export class EncryptionModule {
    // biome-ignore lint/correctness/noUnusedPrivateClassMembers: stub — will be used when implemented
    constructor(private readonly client: HttpClient) {}

    /**
     * Fetch the RSA public key used to encrypt card data (JWK, RFC 7517).
     * Requires the `card:save` OAuth2 scope.
     *
     * GET /encryption/public-key
     */
    async fetchPublicKey(): Promise<JWK> {
        throw new Error('Not implemented');
    }
}
