import { createGoPaySDK } from 'gopay-js-sdk';

export const clientId = import.meta.env.GP_GW_JS_SDK_CLIENT_ID;
export const clientSecret = import.meta.env.GP_GW_JS_SDK_CLIENT_SECRET;
export const goid = import.meta.env.GP_GW_JS_SDK_GOID;
export const hasProxy = Boolean(import.meta.env.GP_GW_JS_SDK_BASE_URL);

export const sdkConfig = hasProxy
    ? { baseUrl: `${window.location.origin}/proxy` }
    : { environment: 'sandbox' };

// Create a single SDK instance shared across the app.
// In production, use { environment: 'production' } (default) or { environment: 'sandbox' } for testing.
// You can also pass a custom { baseUrl } to route through your own proxy.
export const sdk = createGoPaySDK(sdkConfig);
