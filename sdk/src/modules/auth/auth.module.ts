import { GoPayErrorCodes, GoPaySDKError } from '../../errors.js';
import type { HttpClient } from '../../http/client.js';
import type { components } from '../../types/generated.js';
import type { AuthenticateRequest, ClientToken } from '../../types/index.js';

type TokenPair =
    components['responses']['Token-Pair-Response']['content']['application/json'];

/**
 * Handles OAuth2 authentication flows for the GoPay API.
 *
 * All methods that call the API may additionally throw {@link GoPayHTTPError}
 * (non-2xx response) or {@link GoPaySDKError} (auth / network failures —
 * see {@link GoPayErrorCodes}).
 */
export class AuthModule {
    constructor(private readonly client: HttpClient) {}

    /**
     * Authenticate the server-side SDK instance using client credentials.
     *
     * Stores the resulting token pair internally. All subsequent API calls
     * will attach the Bearer token automatically, and the SDK will refresh
     * it transparently before expiry.
     *
     * The token pair is intentionally **not** returned — tokens must remain
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
        this.client.setClientCredentials(
            params.client_id,
            params.client_secret,
        );

        const tokenPair = await this.client.postForm<TokenPair>(
            '/oauth2/token',
            form,
            { headers },
        );

        if (
            !tokenPair.access_token ||
            !tokenPair.refresh_token ||
            tokenPair.expires_in === undefined ||
            tokenPair.refresh_expires_in === undefined
        ) {
            throw this.client.emitError(
                new GoPaySDKError(
                    '[GoPaySDK] Invalid token response: missing required fields.',
                    { errorCode: GoPayErrorCodes.AUTH_INVALID_RESPONSE },
                ),
            );
        }
        this.client.setToken({
            access_token: tokenPair.access_token,
            refresh_token: tokenPair.refresh_token,
            expires_in: tokenPair.expires_in,
            refresh_expires_in: tokenPair.refresh_expires_in,
            token_type: 'bearer',
        });
    }

    /**
     * Issue a token pair for a browser client without affecting the server's
     * own session.
     *
     * The server calls this after `authenticate()` to obtain a fresh token
     * pair — typically with a reduced scope — that it can hand to a browser
     * client. The returned `ClientToken` should be sent to the browser (e.g.
     * via a session endpoint) and passed to `setClientToken()` there.
     *
     * The browser client may request a narrower scope than the server (e.g.
     * `payment:create` only) to limit what the browser-side token can do.
     *
     * POST /oauth2/token (`client_credentials` grant, does **not** store tokens)
     *
     * @throws {@link GoPaySDKError} with `AUTH_CREDENTIALS_MISSING` if
     *   `authenticate()` has not been called yet.
     * @throws {@link GoPaySDKError} with `AUTH_INVALID_RESPONSE` if the token
     *   response is missing required fields.
     */
    async issueClientToken(scope?: string): Promise<ClientToken> {
        const creds = this.client.getClientCredentials();
        if (!creds) {
            throw this.client.emitError(
                new GoPaySDKError(
                    '[GoPaySDK] No client credentials stored. Call authenticate() first.',
                    { errorCode: GoPayErrorCodes.AUTH_CREDENTIALS_MISSING },
                ),
            );
        }

        const form: Record<string, string> = {
            grant_type: 'client_credentials',
        };
        if (scope) form.scope = scope;
        const raw = `${creds.clientId}:${creds.clientSecret}`;
        const headers = { Authorization: `Basic ${globalThis.btoa(raw)}` };

        const tokenPair = await this.client.postForm<TokenPair>(
            '/oauth2/token',
            form,
            { headers },
        );

        if (
            !tokenPair.access_token ||
            !tokenPair.refresh_token ||
            tokenPair.expires_in === undefined ||
            tokenPair.refresh_expires_in === undefined
        ) {
            throw this.client.emitError(
                new GoPaySDKError(
                    '[GoPaySDK] Invalid token response: missing required fields.',
                    { errorCode: GoPayErrorCodes.AUTH_INVALID_RESPONSE },
                ),
            );
        }

        return {
            access_token: tokenPair.access_token,
            refresh_token: tokenPair.refresh_token,
            expires_in: tokenPair.expires_in,
            refresh_expires_in: tokenPair.refresh_expires_in,
        };
    }

    /**
     * Seed a browser SDK instance with a token pair obtained from the server
     * via `issueClientToken()`.
     *
     * The `client_id` is extracted automatically from the `sub` claim of the
     * JWT access token — no credentials are required in the browser. The
     * access token is used immediately; the refresh token renews the session
     * transparently before expiry.
     *
     * **Client credentials must never be passed to the browser.** Obtain a
     * `ClientToken` server-side and pass only that to this method.
     *
     * @throws {@link GoPaySDKError} with `AUTH_INVALID_TOKEN` if the access
     *   token is not a valid JWT or is missing the `sub` claim.
     */
    setClientToken(token: ClientToken): void {
        let clientId: string;
        try {
            const payload = JSON.parse(
                globalThis.atob(token.access_token.split('.')[1]),
            ) as Record<string, unknown>;
            if (!payload.sub || typeof payload.sub !== 'string') {
                throw new Error('missing sub claim');
            }
            clientId = payload.sub;
        } catch {
            throw this.client.emitError(
                new GoPaySDKError(
                    '[GoPaySDK] Cannot extract client_id from access_token JWT. Ensure the token is a valid JWT with a "sub" claim.',
                    { errorCode: GoPayErrorCodes.AUTH_INVALID_TOKEN },
                ),
            );
        }

        this.client.setToken({
            access_token: token.access_token,
            refresh_token: token.refresh_token,
            expires_in: token.expires_in,
            refresh_expires_in: token.refresh_expires_in,
            token_type: 'bearer',
        });
        this.client.setClientId(clientId);
    }

    /**
     * Returns `true` if a token pair is currently stored (the SDK is
     * authenticated). Does not check expiry — expired tokens are refreshed
     * transparently on the next API call.
     */
    isAuthenticated(): boolean {
        return this.client.isAuthenticated();
    }

    /**
     * Clear all stored tokens and credentials.
     * After calling this, all API calls will throw until the SDK is
     * re-authenticated via `authenticate()` or `setClientToken()`.
     */
    logout(): void {
        this.client.clearTokens();
    }
}
