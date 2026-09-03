import { createGoPaySDK } from '@gopaycz/gopay-js-sdk';

export const clientId = import.meta.env.GOPAY_PAYMENTS_V4_CLIENT_ID;
export const clientSecret = import.meta.env.GOPAY_PAYMENTS_V4_CLIENT_SECRET;
export const goid = import.meta.env.GOPAY_PAYMENTS_V4_GOID;
export const shareableKey = import.meta.env.GOPAY_PAYMENTS_V4_SHAREABLE_KEY;
const baseUrl =
    window._gpConfig?.baseUrl ?? import.meta.env.GOPAY_PAYMENTS_V4_BASE_URL;
// Anything other than an explicit 'production' stays on sandbox — a typo must
// never silently point the demo at live traffic.
export const environment =
    (window._gpConfig?.environment ??
        import.meta.env.GOPAY_PAYMENTS_V4_ENVIRONMENT) === 'production'
        ? 'production'
        : 'sandbox';
// An explicit baseUrl wins: it is how you target a dev/alpha/mock endpoint that
// has no `environment` shorthand.
const baseConfig = baseUrl ? { baseUrl } : { environment };
export const sdkConfig = shareableKey
    ? { ...baseConfig, shareableKey }
    : baseConfig;

// Create a single SDK instance shared across the app.
// Defaults to 'sandbox'. Set GOPAY_PAYMENTS_V4_ENVIRONMENT=production in sdk/.env
// for production, or GOPAY_PAYMENTS_V4_BASE_URL to point at a custom endpoint.
export const sdk = createGoPaySDK(sdkConfig);
