import { createGoPaySDK } from '@gopaycz/gopay-js-sdk';

import { RUNTIME_ENV_VARS } from '../runtime-keys.js';

// /env.js wins over the build-time value for every setting, because the deployed image is built
// once and handed its merchant at startup (see ../runtime-config.js). A missing runtime value is
// null, which the `??` below carries through to the build-time fallback `sdk/.env` baked in.
//
// The key is checked against the shared list because a misspelling is otherwise invisible here:
// the lookup yields nothing, the fallback takes over, and the demo runs on the wrong merchant.
const runtime = (key) => {
    if (!(key in RUNTIME_ENV_VARS)) {
        throw new Error(`Unknown runtime config key: ${key}`);
    }
    return window._gpConfig?.[key];
};

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
