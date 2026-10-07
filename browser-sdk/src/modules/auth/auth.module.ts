import {
    GoPayErrorCodes,
    GoPaySDKError,
    type HttpClient,
    type StoredTokenPair,
} from '@gopay-internal/core';
import type { components } from '../../types/generated.js';

type TokenPair = components['schemas']['Access-Token'];

/** Scope issued for payment-credentials tokens. */
const DEFAULT_PAYMENT_SCOPE = 'payment:read payment:charge';

/**
 * Exchange a payment_id + payment_secret for a payment-scoped token pair.
 * Called internally by attachPayment() — not exposed on the public API.
 */
export async function exchangePaymentCredentials(
    client: HttpClient,
    paymentId: string,
    paymentSecret: string,
    scope = DEFAULT_PAYMENT_SCOPE,
): Promise<void> {
    // The previous payment goes first, token and credentials both: a
    // re-exchange still in flight for it must not land once this attach has
    // begun, and a failed attach must not leave it behind, still looking
    // authenticated.
    client.setPaymentCredentials(null);
    client.tokenStore.clearToken();

    const form: Record<string, string> = {
        grant_type: 'payment_credentials',
        scope,
    };
    const credentials = `${paymentId}:${paymentSecret}`;
    const headers = {
        Authorization: `Basic ${globalThis.btoa(credentials)}`,
    };

    const tokenPair = await client.postForm<TokenPair>('/oauth2/token', form, {
        headers,
    });

    if (!tokenPair.access_token || tokenPair.expires_in === undefined) {
        throw client.emitError(
            new GoPaySDKError(
                '[GoPayBrowserSDK] Invalid token response: missing required fields.',
                { errorCode: GoPayErrorCodes.AUTH_INVALID_RESPONSE },
            ),
        );
    }

    const tokenData: Omit<StoredTokenPair, 'issued_at'> = {
        access_token: tokenPair.access_token,
        expires_in: tokenPair.expires_in,
        token_type: 'bearer',
    };
    client.setToken(tokenData);
    // Kept, in memory only, so an expired token can be exchanged again: the
    // grant issues no refresh token and the token lives fifteen minutes, which
    // a customer filling the card form can outlast. The merchant already holds
    // the secret in this page, so keeping it here exposes nothing new.
    client.setPaymentCredentials({ paymentId, paymentSecret, scope });
}

export function createAuthApi(client: HttpClient) {
    return {
        /** Returns `true` if a payment-scoped token is currently stored. */
        isAuthenticated(): boolean {
            return client.isAuthenticated();
        },

        /** Clear all stored tokens. After calling this, payment-scoped calls will throw. */
        logout(): void {
            client.clearTokens();
        },
    };
}
