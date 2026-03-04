import { beforeAll, describe, expect, it } from 'vitest';
import { GoPaySDK } from '../../src/index.js';

describe('auth.authenticate() — E2E', () => {
    let sdk: GoPaySDK;
    let clientId: string;
    let clientSecret: string;

    beforeAll(() => {
        const baseUrl = process.env.GP_GW_JS_SDK_BASE_URL;
        clientId = process.env.GP_GW_JS_SDK_CLIENT_ID ?? '';
        clientSecret = process.env.GP_GW_JS_SDK_CLIENT_SECRET ?? '';

        if (!baseUrl || !clientId || !clientSecret) {
            throw new Error(
                'Missing required environment variables: GP_GW_JS_SDK_BASE_URL, GP_GW_JS_SDK_CLIENT_ID, GP_GW_JS_SDK_CLIENT_SECRET',
            );
        }

        sdk = new GoPaySDK({ baseUrl });
    });

    it('returns a token pair for client_credentials grant', async () => {
        const result = await sdk.auth.authenticate({
            grant_type: 'client_credentials',
            client_id: clientId,
            client_secret: clientSecret,
            scope: 'payment:create',
        });

        expect(result.token_type).toBe('bearer');
        expect(result.access_token).toBeTruthy();
        expect(result.refresh_token).toBeTruthy();
        expect(typeof result.expires_in).toBe('number');
        expect(typeof result.refresh_expires_in).toBe('number');
    });
});
