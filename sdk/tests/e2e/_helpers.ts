import {
    createGoPaySDK,
    GoPayHTTPError,
    type GoPaySDK,
} from '../../src/index.js';

/**
 * Shared guards for the write-capable E2E suites.
 *
 * Every suite here creates records on the merchant account it points at —
 * payments, refunds, links — so each one refuses production outright rather
 * than validating it. `auth.e2e.test.ts` does not use this: it only exchanges
 * credentials, so it is the one suite allowed to run against production, and
 * it needs the raw client id and secret for its own assertions.
 */
export type SandboxSdk = { sdk: GoPaySDK; goid: string };

/**
 * @param writes - What the suite creates, quoted back in the production
 *                 refusal so the message names the actual risk.
 * @param scope  - OAuth2 scopes to request. Defaults to read + write on
 *                 payments, which is what every suite needs at minimum.
 */
export async function createSandboxSdk(
    writes: string,
    scope = 'payment:write payment:read',
): Promise<SandboxSdk> {
    const baseUrl = process.env.GOPAY_PAYMENTS_V4_BASE_URL;
    const rawEnvironment = process.env.GOPAY_PAYMENTS_V4_ENVIRONMENT;

    if (rawEnvironment !== undefined && rawEnvironment !== 'sandbox') {
        throw new Error(
            `These E2E tests only run against sandbox — they ${writes}. GOPAY_PAYMENTS_V4_ENVIRONMENT was: '${rawEnvironment}'`,
        );
    }
    const environment = rawEnvironment as 'sandbox' | undefined;
    const clientId = process.env.GOPAY_PAYMENTS_V4_CLIENT_ID ?? '';
    const clientSecret = process.env.GOPAY_PAYMENTS_V4_CLIENT_SECRET ?? '';
    const goid = process.env.GOPAY_PAYMENTS_V4_GOID ?? '';

    if (!baseUrl && !environment) {
        throw new Error(
            'Missing required environment variables: set GOPAY_PAYMENTS_V4_ENVIRONMENT=sandbox or GOPAY_PAYMENTS_V4_BASE_URL for a mock/alpha endpoint',
        );
    }
    // A custom base URL is meant for mocks and alpha envs; catch the obvious
    // production host so the override cannot smuggle these writes into prod.
    if (baseUrl?.includes('gate.gopay.com')) {
        throw new Error(
            `These E2E tests must not target production. GOPAY_PAYMENTS_V4_BASE_URL was: '${baseUrl}'`,
        );
    }
    if (!clientId || !clientSecret) {
        throw new Error(
            'Missing required environment variables: GOPAY_PAYMENTS_V4_CLIENT_ID, GOPAY_PAYMENTS_V4_CLIENT_SECRET',
        );
    }
    // Every suite creates a payment or a link first, so an unset goid would
    // post to /eshops//… and fail with an opaque HTTP error.
    if (!goid) {
        throw new Error(
            'Missing required environment variable: GOPAY_PAYMENTS_V4_GOID',
        );
    }

    const sdk = createGoPaySDK(baseUrl ? { baseUrl } : { environment });
    try {
        await sdk.authenticate({
            grant_type: 'client_credentials',
            client_id: clientId,
            client_secret: clientSecret,
            scope,
        });
    } catch (error) {
        throw describeAuthFailure(
            error,
            baseUrl ?? `environment=${environment}`,
        );
    }
    return { sdk, goid };
}

/**
 * Say why the token exchange failed, instead of letting a bare status through.
 *
 * Every suite here authenticates in `beforeAll`, so one unreachable gateway fails
 * all six files at once and vitest reports six failures with the ~85 tests behind
 * those hooks merely skipped. That reads as a broken SDK and is usually a sleeping
 * environment, so the message has to name the difference.
 */
function describeAuthFailure(error: unknown, target: string): Error {
    if (!(error instanceof GoPayHTTPError)) {
        return new Error(
            `Could not reach ${target} to exchange credentials (${String(error)}). A TLS or DNS failure at this point is the environment, not the SDK: dev certificates are reissued often, and a wildcard covers one label only - '*.dev.gopay.com' does not match 'gw.<env>.dev.gopay.com'.`,
        );
    }
    if (error.status === 404) {
        return new Error(
            `Token exchange 404'd at ${target}. A 404 from the whole host means the environment is not serving rather than that the endpoint moved - alpha and the personal namespaces are switched off overnight and at weekends. Start it, or point GOPAY_PAYMENTS_V4_BASE_URL at one that is up.`,
        );
    }
    if (error.status === 401) {
        return new Error(
            `Token exchange was rejected at ${target} with 401: ${JSON.stringify(error.body)}. That is not always the credential pair - a gateway that has lost its database connection reports the same status, with the reason in 'detail'. Read it before changing any credentials.`,
        );
    }
    return error;
}

/** Payment body every suite reuses; `overrides` tweak one field at a time. */
export function paymentBody(
    orderNumber: string,
    overrides: Record<string, unknown> = {},
) {
    return {
        amount: 100,
        currency: 'CZK' as const,
        order_number: orderNumber,
        customer: { email: 'john.doe@example.com' },
        callback: {
            return_url: 'https://example.com/return',
            notification_url: 'https://example.com/notify',
        },
        ...overrides,
    };
}

/**
 * Browser data for a charge attempt. Real values must come from the customer's
 * browser via the browser SDK's `getBrowserData()`; these are fixed stand-ins,
 * which is fine because every charge here is asserted on its rejection, never
 * driven through 3-D Secure.
 */
export const PROBE_BROWSER_DATA = {
    language: 'cs-CZ',
    timezone: -60,
    screen_width: 1920,
    screen_height: 1080,
    color_depth: 24,
    user_agent: 'Mozilla/5.0 (gopay-js-sdk e2e)',
    accept_header: '{"accept":"application/json"}',
    javascript_enabled: true,
    ip: '192.0.2.42',
} as const;
