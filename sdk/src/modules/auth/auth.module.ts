import type { HttpClient } from '../../http/client.js';
import type { components } from '../../types/generated.js';
import type { AuthenticateRequest } from '../../types/index.js';

type TokenPair =
    components['responses']['Token-Pair-Response']['content']['application/json'];

export class AuthModule {
    constructor(private readonly client: HttpClient) {}

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
            form.scope = params.scope as string;
            const raw = `${params.client_id}:${params.client_secret}`;
            const credentials =
                typeof globalThis.btoa === 'function'
                    ? globalThis.btoa(raw)
                    : Buffer.from(raw).toString('base64');
            headers.Authorization = `Basic ${credentials}`;
        } else {
            form.refresh_token = params.refresh_token;
            if (params.client_id) form.client_id = params.client_id;
            if (params.scope) form.scope = params.scope as string;
        }

        const tokenPair = await this.client.postForm<TokenPair>(
            '/oauth2/token',
            form,
            { headers },
        );

        // TODO: implement secure storage for tokenPair
        console.log('[GoPaySDK] authenticate response:', tokenPair);

        return tokenPair;
    }
}
