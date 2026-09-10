import { createGoPaySDK } from '@gopaycz/gopay-js-sdk';

// /env.js wins over the build-time value for every setting, because the deployed image is built
// once and handed its merchant at startup (see ../runtime-config.js). `??` skips the payload's
// nulls, so an unset runtime value still falls back to what `sdk/.env` baked in for local runs.
const runtime = (key) => window._gpConfig?.[key] ?? undefined;

export const clientId =
    runtime('clientId') ?? import.meta.env.GOPAY_PAYMENTS_V4_CLIENT_ID;
export const clientSecret =
    runtime('clientSecret') ?? import.meta.env.GOPAY_PAYMENTS_V4_CLIENT_SECRET;
export const goid = runtime('goid') ?? import.meta.env.GOPAY_PAYMENTS_V4_GOID;
export const shareableKey =
    runtime('shareableKey') ?? import.meta.env.GOPAY_PAYMENTS_V4_SHAREABLE_KEY;
const baseUrl =
    runtime('baseUrl') ?? import.meta.env.GOPAY_PAYMENTS_V4_BASE_URL;
// Anything other than an explicit 'production' stays on sandbox — a typo must
// never silently point the demo at live traffic.
export const environment =
    (runtime('environment') ??
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
