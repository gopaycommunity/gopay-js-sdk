import { createGoPaySDK } from '@gopaycz/gopay-js-sdk';

export const clientId = import.meta.env.GOPAY_PAYMENTS_V4_CLIENT_ID;
export const clientSecret = import.meta.env.GOPAY_PAYMENTS_V4_CLIENT_SECRET;
export const goid = import.meta.env.GOPAY_PAYMENTS_V4_GOID;
export const shareableKey = import.meta.env.GOPAY_PAYMENTS_V4_SHAREABLE_KEY;
const baseUrl =
    window._gpConfig?.baseUrl ?? import.meta.env.GOPAY_PAYMENTS_V4_BASE_URL;
const baseConfig = baseUrl ? { baseUrl } : { environment: 'sandbox' };
export const sdkConfig = shareableKey
    ? { ...baseConfig, shareableKey }
    : baseConfig;

// Create a single SDK instance shared across the app.
// Defaults to 'sandbox'. For production use { environment: 'production' }.
// You can also pass a custom { baseUrl } to point at a different API environment.
export const sdk = createGoPaySDK(sdkConfig);
