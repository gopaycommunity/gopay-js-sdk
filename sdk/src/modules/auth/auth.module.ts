import { GoPaySDKError } from '../../errors.js';
import type { HttpClient } from '../../http/client.js';
import type { components } from '../../types/generated.js';
import type { AuthenticateRequest } from '../../types/index.js';

type TokenPair =
    components['responses']['Token-Pair-Response']['content']['application/json'];

export class AuthModule {
    constructor(private readonly client: HttpClient) {}

    /**
     * Initialise the SDK with a refresh token obtained server-side.
     * The SDK will exchange it for an access token on the first API call.
     * Use this in browser environments where client credentials must not be exposed.
     * `clientId` is required to identify the OAuth2 client during token refresh.
     */
    setRefreshToken(refreshToken: string, clientId: string): void {
        this.client.setRefreshToken(refreshToken, clientId);
    }

    /**
     * Obtain an access/refresh token pair.
     *
     * Grant types:
     * - `client_credentials` — use HTTP Basic credentials (pass via Authorization header)
     * - `refresh_token` — exchange an existing refresh token
     *
     * POST /oauth2/token
     */
    async authenticate(params: AuthenticateRequest): Promise<TokenPair> {
        const form: Record<string, string> = { grant_type: params.grant_type };

        const headers: Record<string, string> = {};

        if (params.grant_type === 'client_credentials') {
            form.scope = params.scope;
            const raw = `${params.client_id}:${params.client_secret}`;
            headers.Authorization = `Basic ${globalThis.btoa(raw)}`;
        } else {
            form.refresh_token = params.refresh_token;
            if (params.client_id) form.client_id = params.client_id;
            if (params.scope) form.scope = params.scope;
        }

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
            throw new GoPaySDKError(
                '[GoPaySDK] Invalid token response: missing required fields.',
            );
        }
        this.client.setToken({
            access_token: tokenPair.access_token,
            refresh_token: tokenPair.refresh_token,
            expires_in: tokenPair.expires_in,
            refresh_expires_in: tokenPair.refresh_expires_in,
            token_type: 'bearer',
        });

        return tokenPair;
    }
}
