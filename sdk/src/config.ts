import type { GoPayHTTPError, GoPaySDKError } from './errors.js';
import type { GoPayEnvironment } from './types/index.js';

export interface GoPayConfig {
    /** Target environment. Defaults to 'sandbox'. */
    environment?: GoPayEnvironment;
    /** Override the API base URL (useful for mock servers in testing). */
    baseUrl?: string;
    /**
     * Request timeout in milliseconds.
     * Defaults to 10 000 ms. Set to `false` to disable (not recommended in production).
     */
    requestTimeoutMs?: number;
    /**
     * Log outgoing requests and incoming responses to `console.debug`.
     * Enable during development to inspect traffic. Never enable in production.
     */
    debugLoggingEnabled?: boolean;
    /**
     * Called whenever the SDK throws a `GoPaySDKError` or `GoPayHTTPError`.
     * Use this to integrate with your analytics or error-reporting system.
     *
     * @example
     * ```ts
     * new GoPaySDK({
     *   environment: 'production',
     *   onError: (err) => Sentry.captureException(err),
     * });
     * ```
     */
    onError?: (error: GoPaySDKError | GoPayHTTPError) => void;
}

export const BASE_URLS: Record<
    NonNullable<GoPayConfig['environment']>,
    string
> = {
    sandbox: 'https://api.sandbox.gopay.com/api/merchant/payments/4.0',
    production: 'https://api.gopay.com/api/merchant/payments/4.0',
};
