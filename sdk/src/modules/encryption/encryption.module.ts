/**
 * Card data encryption must never be performed in publicly reachable
 * JavaScript. The public key fetch (`GET /encryption/public-key`) and the
 * actual JWE construction must happen inside an isolated iframe served from
 * a separate, non-public origin — never from the merchant's page bundle.
 *
 * For this reason the `encryption` module is intentionally absent from the
 * SDK's public API surface.
 */
export class EncryptionModule {
    // biome-ignore lint/correctness/noUnusedPrivateClassMembers: reserved for server-side use
    constructor(private readonly _client: unknown) {}
}
