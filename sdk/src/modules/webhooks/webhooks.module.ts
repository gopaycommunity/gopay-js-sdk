import {
    GoPayErrorCodes,
    GoPayHTTPError,
    GoPaySDKError,
    type HttpClient,
} from '@gopay-internal/core';
import type { components } from '../../types/generated.js';
import type { GoPayEvent } from '../events/events.module.js';
import {
    bodyBytes,
    invalidWebhook,
    parseEvent,
    parseSignatureHeader,
    verifySignature,
    type WebhookBody,
    type WebhookSignatureHeader,
} from './signature.js';

export type WebhookPublicKeys = components['schemas']['JWK-Set'];
type SigningJwk = components['schemas']['Signing-JWK'];

/**
 * An unknown `kid` refetches the keys at most this often: anyone can send a request naming
 * a made-up key, and each one must not become a call to GoPay. Short, because a real webhook
 * signed with a rotated-in key waits it out as a 5xx GoPay retries.
 */
const REFETCH_INTERVAL_MS = 10_000;
/** Older keys are refetched before use, so a key GoPay withdraws stops verifying. */
const KEYS_MAX_AGE_MS = 60 * 60_000;

const PUBLIC_KEYS_PATH = '/webhooks/public-keys';

function keysUnavailable(cause: unknown): GoPaySDKError {
    if (cause === undefined) {
        return new GoPaySDKError(
            '[GoPaySDK] The webhook names a signing key the SDK has not loaded, and the keys were fetched moments ago, so it was not verified yet.',
            { errorCode: GoPayErrorCodes.WEBHOOK_KEYS_UNAVAILABLE },
        );
    }
    const hint =
        cause instanceof GoPayHTTPError && cause.status === 403
            ? ' The access token needs the shared:read scope.'
            : '';
    return new GoPaySDKError(
        `[GoPaySDK] The webhook signing keys could not be loaded, so the webhook was not verified.${hint}`,
        { errorCode: GoPayErrorCodes.WEBHOOK_KEYS_UNAVAILABLE, cause },
    );
}

async function importSigningKey(
    jwk: SigningJwk,
): Promise<CryptoKey | undefined> {
    if (jwk.kty !== 'RSA' || jwk.alg !== 'RS256' || jwk.use !== 'sig') {
        return undefined;
    }
    try {
        return await crypto.subtle.importKey(
            'jwk',
            { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
            { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
            false,
            ['verify'],
        );
    } catch {
        // One malformed key must not take the others down with it.
        return undefined;
    }
}

/** Keys by `kid`, replaced as a whole on each successful fetch; a failed one keeps the last set. */
function createKeyStore(client: HttpClient) {
    let keys = new Map<string, CryptoKey>();
    let loading: Promise<void> | undefined;
    // Last success and last attempt apart: a failed refresh is retried after the short
    // interval, not after another hour of trusting the old set.
    let fetchedAt = Number.NEGATIVE_INFINITY;
    let attemptedAt = Number.NEGATIVE_INFINITY;
    let lastFailure: unknown;

    async function load(): Promise<void> {
        try {
            const set = await client.get<WebhookPublicKeys>(PUBLIC_KEYS_PATH);
            const jwks = (Array.isArray(set?.keys) ? set.keys : []).filter(
                (jwk) => typeof jwk?.kid === 'string',
            );
            const imported = await Promise.all(jwks.map(importSigningKey));
            const next = new Map<string, CryptoKey>();
            jwks.forEach((jwk, index) => {
                const key = imported[index];
                if (key) {
                    next.set(jwk.kid, key);
                }
            });
            // A set with no key to verify with is not GoPay saying every webhook is forged.
            // Taken as one, it would replace a good set, and each webhook waiting on this
            // refetch would get WEBHOOK_INVALID, a 4xx that GoPay does not retry.
            if (next.size === 0) {
                throw new GoPaySDKError(
                    '[GoPaySDK] GET /webhooks/public-keys returned no usable signing key.',
                    { errorCode: GoPayErrorCodes.NETWORK_ERROR },
                );
            }
            keys = next;
            lastFailure = undefined;
            fetchedAt = Date.now();
        } catch (error) {
            // A failed request is already reported by the client, once per attempt; an empty
            // set is not reported at all. The webhooks that wait on it, and any that arrive
            // while the failure stands, must not report it again.
            lastFailure = error;
        } finally {
            attemptedAt = Date.now();
            loading = undefined;
        }
    }

    return {
        /**
         * The key, or undefined when GoPay's current keys do not include it. Throws when that
         * could not be established — not checked is not forged, and GoPay retries a 5xx only.
         */
        async keyFor(kid: string): Promise<CryptoKey | undefined> {
            const now = Date.now();
            const due = now - fetchedAt >= KEYS_MAX_AGE_MS || !keys.has(kid);
            if (!loading && due && now - attemptedAt >= REFETCH_INTERVAL_MS) {
                loading = load();
            }
            const checked = loading !== undefined;
            await loading;
            const key = keys.get(kid);
            if (key) {
                return key;
            }
            if (!checked || lastFailure !== undefined) {
                throw keysUnavailable(lastFailure);
            }
            return undefined;
        },
    };
}

export function createWebhooksApi(client: HttpClient) {
    const keyStore = createKeyStore(client);

    async function verify(
        rawBody: WebhookBody,
        signatureHeader: WebhookSignatureHeader,
    ): Promise<GoPayEvent> {
        const body = bodyBytes(rawBody);
        const signature = parseSignatureHeader(signatureHeader);
        const key = await keyStore.keyFor(signature.kid);
        if (!key) {
            throw invalidWebhook(
                'it is signed with a key GoPay does not publish',
            );
        }
        if (!(await verifySignature(key, signature, body))) {
            throw invalidWebhook('the signature does not match the body');
        }
        return parseEvent(body);
    }

    return {
        /**
         * Check that a webhook comes from GoPay and return its event. Requires the
         * `shared:read` OAuth2 scope, for the signing keys: cached by `kid`, refreshed once an
         * hour, and refetched for a `kid` not in the cache at most every 10 seconds.
         *
         * Pass the body exactly as received — `express.raw({ type: 'application/json' })`,
         * not `express.json()` — and the `X-GoPay-Signature` header.
         *
         * Throws `GoPaySDKError` with `WEBHOOK_INVALID` (answer 4xx); anything else —
         * `WEBHOOK_KEYS_UNAVAILABLE`, or `INVALID_ARGUMENT` for a parsed body — answer 5xx,
         * so GoPay retries once it is fixed. `WEBHOOK_INVALID` is not passed to `onError`:
         * anyone who can reach the endpoint can cause one, nor is `WEBHOOK_KEYS_UNAVAILABLE`.
         * A key load that failed is: the underlying `GoPayHTTPError`, once per attempt.
         */
        async verifyWebhook(
            rawBody: WebhookBody,
            signatureHeader: WebhookSignatureHeader,
        ): Promise<GoPayEvent> {
            try {
                return await verify(rawBody, signatureHeader);
            } catch (error) {
                // Neither is reported: WEBHOOK_INVALID is whatever anyone sends, and a failed
                // key load was reported by the HTTP client when it happened.
                if (
                    !(error instanceof GoPaySDKError) ||
                    (error.errorCode !== GoPayErrorCodes.WEBHOOK_INVALID &&
                        error.errorCode !==
                            GoPayErrorCodes.WEBHOOK_KEYS_UNAVAILABLE)
                ) {
                    client.reportError(error);
                }
                throw error;
            }
        },

        /**
         * The public keys GoPay signs webhooks with, as a JWK Set. `verifyWebhook` fetches
         * them itself; this is for verifying elsewhere. Requires the `shared:read` OAuth2 scope.
         *
         * GET /webhooks/public-keys
         */
        async getWebhookPublicKeys(options?: {
            signal?: AbortSignal;
        }): Promise<WebhookPublicKeys> {
            return await client.get<WebhookPublicKeys>(
                PUBLIC_KEYS_PATH,
                options,
            );
        },
    };
}
