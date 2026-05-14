import type { GoPayHTTPError, GoPaySDKError } from './errors.js';

export type GoPayEnvironment = 'sandbox' | 'production';

export interface CoreConfig {
    /** Target environment. Defaults to 'sandbox'. */
    environment?: GoPayEnvironment;
    /** Override the API base URL (useful for mock servers in testing). */
    baseUrl?: string;
    /** Request timeout in milliseconds. Defaults to 10 000 ms. */
    requestTimeoutMs?: number;
    /** Log outgoing requests and incoming responses to console.debug. */
    debugLoggingEnabled?: boolean;
    /** Called whenever the SDK throws a GoPaySDKError or GoPayHTTPError. */
    onError?: (error: GoPaySDKError | GoPayHTTPError) => void;
    /**
     * Publishable key (X-API-Key for browser requests). Public — safe to expose in
     * the browser. Set this on the server SDK so `getBrowserKeys()` can return it
     * alongside `client_id` for initializing the browser SDK.
     */
    publishableKey?: string;
}

export const BASE_URLS: Record<GoPayEnvironment, string> = {
    sandbox: 'https://api.sandbox.gopay.com/api/merchant/payments/4.0',
    production: 'https://api.gopay.com/api/merchant/payments/4.0',
};
