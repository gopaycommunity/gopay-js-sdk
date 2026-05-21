import {
    GoPayErrorCodes,
    GoPaySDKError,
    type HttpClient,
    type StoredTokenPair,
} from '@gopay-internal/core';
import type { components } from '../../types/generated.js';

type TokenPair = components['schemas']['Access-Token'] & {
    refresh_token?: string;
    refresh_expires_in?: number;
};

/** Scope issued for payment-secret tokens. */
const DEFAULT_PAYMENT_SCOPE = 'payment:read payment:charge shared:read';

/**
 * Exchange a payment_secret for a payment-scoped token pair.
 * Called internally by attachPayment() — not exposed on the public API.
 */
export async function exchangeAuthorizationCode(
    client: HttpClient,
    paymentSecret: string,
    clientId: string,
    scope = DEFAULT_PAYMENT_SCOPE,
): Promise<void> {
    const form: Record<string, string> = {
        grant_type: 'authorization_code',
        authorization_code: paymentSecret,
        client_id: clientId,
        scope,
    };

    const tokenPair = await client.postForm<TokenPair>('/oauth2/token', form);

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
        refresh_token: tokenPair.refresh_token ?? '',
        expires_in: tokenPair.expires_in,
        refresh_expires_in: tokenPair.refresh_expires_in ?? 0,
        token_type: 'bearer',
    };
    client.setToken(tokenData);
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
