import {
    GoPayErrorCodes,
    GoPaySDKError,
    type HttpClient,
} from '@gopay-internal/core';
import type { components } from '../../types/generated.js';
import type { AuthenticateRequest } from '../../types/index.js';

type TokenPair = components['schemas']['Access-Token'];

export function createAuthApi(client: HttpClient) {
    return {
        /**
         * Authenticate the server-side SDK instance using client credentials.
         *
         * Stores the resulting access token internally. All subsequent API calls
         * will attach the Bearer token automatically.
         *
         * The token is intentionally **not** returned — tokens must remain
         * server-side only and must never be exposed to callers or logged.
         * Use `isAuthenticated()` to confirm the SDK is ready.
         *
         * POST /oauth2/token (`client_credentials` grant)
         *
         * @throws {@link GoPaySDKError} with `AUTH_INVALID_RESPONSE` if the token
         *   response is missing required fields.
         */
        async authenticate(params: AuthenticateRequest): Promise<void> {
            const form: Record<string, string> = {
                grant_type: params.grant_type,
                scope: params.scope,
            };
            const raw = `${params.client_id}:${params.client_secret}`;
            const headers = {
                Authorization: `Basic ${globalThis.btoa(raw)}`,
            };
            client.setClientCredentials(
                params.client_id,
                params.client_secret,
                params.scope,
            );

            const tokenPair = await client.postForm<TokenPair>(
                '/oauth2/token',
                form,
                { headers },
            );

            if (!tokenPair.access_token || tokenPair.expires_in === undefined) {
                throw client.emitError(
                    new GoPaySDKError(
                        '[GoPaySDK] Invalid token response: missing required fields.',
                        { errorCode: GoPayErrorCodes.AUTH_INVALID_RESPONSE },
                    ),
                );
            }
            client.setToken({
                access_token: tokenPair.access_token,
                expires_in: tokenPair.expires_in,
                token_type: 'bearer',
            });
        },

        /**
         * Returns `true` if a token pair is currently stored (the SDK is
         * authenticated). Does not check expiry — expired tokens are refreshed
         * transparently on the next API call.
         */
        isAuthenticated(): boolean {
            return client.isAuthenticated();
        },

        /**
         * Clear all stored tokens and credentials.
         * After calling this, all API calls will throw until the SDK is
         * re-authenticated via `authenticate()`.
         */
        logout(): void {
            client.clearTokens();
        },

        /**
         * Store the publishable key on the SDK instance.
         * Useful when the key is obtained separately from the SDK config
         * (e.g. entered at runtime in a dev tool or fetched from an admin API).
         */
        setPublishableKey(key: string): void {
            client.setPublishableKey(key);
        },

        getBrowserKeys(): { publishable_key: string; client_id: string } {
            const publishableKey = client.getPublishableKey();
            const clientId = client.getClientId();
            if (!publishableKey || !clientId) {
                throw client.emitError(
                    new GoPaySDKError(
                        '[GoPaySDK] getBrowserKeys() requires publishableKey in config and a prior authenticate() call.',
                        { errorCode: GoPayErrorCodes.AUTH_CREDENTIALS_MISSING },
                    ),
                );
            }
            return { publishable_key: publishableKey, client_id: clientId };
        },
    };
}
