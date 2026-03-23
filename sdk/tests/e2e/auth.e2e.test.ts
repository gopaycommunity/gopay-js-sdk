import { beforeAll, describe, expect, it } from 'vitest';
import { GoPaySDK } from '../../src/index.js';

describe('auth.authenticate() — E2E', () => {
    let sdk: GoPaySDK;
    let clientId: string;
    let clientSecret: string;

    beforeAll(() => {
        const baseUrl = process.env.GP_GW_JS_SDK_BASE_URL;
        const rawEnvironment = process.env.GP_GW_JS_SDK_ENVIRONMENT;
        const validEnvironments = ['sandbox', 'production'] as const;
        if (
            rawEnvironment !== undefined &&
            !validEnvironments.includes(
                rawEnvironment as (typeof validEnvironments)[number],
            )
        ) {
            throw new Error(
                `GP_GW_JS_SDK_ENVIRONMENT must be 'sandbox' or 'production', got: '${rawEnvironment}'`,
            );
        }
        const environment = rawEnvironment as
            | 'sandbox'
            | 'production'
            | undefined;
        clientId = process.env.GP_GW_JS_SDK_CLIENT_ID ?? '';
        clientSecret = process.env.GP_GW_JS_SDK_CLIENT_SECRET ?? '';

        if (!baseUrl && !environment) {
            throw new Error(
                'Missing required environment variables: set GP_GW_JS_SDK_ENVIRONMENT (sandbox|production) or GP_GW_JS_SDK_BASE_URL for a custom endpoint',
            );
        }
        if (!clientId || !clientSecret) {
            throw new Error(
                'Missing required environment variables: GP_GW_JS_SDK_CLIENT_ID, GP_GW_JS_SDK_CLIENT_SECRET',
            );
        }

        sdk = new GoPaySDK(baseUrl ? { baseUrl } : { environment });
    });

    it('authenticates and marks the SDK instance as authenticated', async () => {
        await sdk.auth.authenticate({
            grant_type: 'client_credentials',
            client_id: clientId,
            client_secret: clientSecret,
            scope: 'payment:create',
        });

        // Token pair is stored internally only — never returned to callers.
        expect(sdk.auth.isAuthenticated()).toBe(true);
    });
});
