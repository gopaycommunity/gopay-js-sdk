import { beforeAll, describe, expect, it } from 'vitest';
import { createGoPaySDK, type GoPaySDK } from '../../src/index.js';

describe('auth.authenticate() — E2E', () => {
    let sdk: GoPaySDK;
    let clientId: string;
    let clientSecret: string;

    beforeAll(() => {
        const baseUrl = process.env.GOPAY_PAYMENTS_V4_BASE_URL;
        const rawEnvironment = process.env.GOPAY_PAYMENTS_V4_ENVIRONMENT;
        const validEnvironments = ['sandbox', 'production'] as const;
        if (
            rawEnvironment !== undefined &&
            !validEnvironments.includes(
                rawEnvironment as (typeof validEnvironments)[number],
            )
        ) {
            throw new Error(
                `GOPAY_PAYMENTS_V4_ENVIRONMENT must be 'sandbox' or 'production', got: '${rawEnvironment}'`,
            );
        }
        const environment = rawEnvironment as
            | 'sandbox'
            | 'production'
            | undefined;
        clientId = process.env.GOPAY_PAYMENTS_V4_CLIENT_ID ?? '';
        clientSecret = process.env.GOPAY_PAYMENTS_V4_CLIENT_SECRET ?? '';

        if (!baseUrl && !environment) {
            throw new Error(
                'Missing required environment variables: set GOPAY_PAYMENTS_V4_ENVIRONMENT (sandbox|production) or GOPAY_PAYMENTS_V4_BASE_URL for a custom endpoint',
            );
        }
        if (!clientId || !clientSecret) {
            throw new Error(
                'Missing required environment variables: GOPAY_PAYMENTS_V4_CLIENT_ID, GOPAY_PAYMENTS_V4_CLIENT_SECRET',
            );
        }

        sdk = createGoPaySDK(baseUrl ? { baseUrl } : { environment });
    });

    it('authenticates and marks the SDK instance as authenticated', async () => {
        await sdk.authenticate({
            grant_type: 'client_credentials',
            client_id: clientId,
            client_secret: clientSecret,
            scope: 'payment:write',
        });

        // Token pair is stored internally only — never returned to callers.
        expect(sdk.isAuthenticated()).toBe(true);
    });
});
