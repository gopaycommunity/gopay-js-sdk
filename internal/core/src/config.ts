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
    /**
     * Called for every `GoPaySDKError` and `GoPayHTTPError` the SDK raises,
     * exactly once per error.
     *
     * "Raises" rather than "throws" on purpose: the card form and the wallet
     * buttons deliver their failures by rejecting `result`, never by throwing,
     * and those reach this callback too.
     *
     * Observes rather than handles — the error still propagates to the caller.
     * Anything this callback throws is swallowed, including a rejection from an
     * `async` handler, so monitoring being down cannot replace the SDK's own
     * error or crash the host process.
     */
    onError?: (error: GoPaySDKError | GoPayHTTPError) => void;
    /**
     * Shareable key (X-API-Key for browser requests). Public — safe to expose in
     * the browser. Set this on the server SDK so `getBrowserKeys()` can return it
     * alongside `client_id` for initializing the browser SDK.
     */
    shareableKey?: string;
}

export const BASE_URLS: Record<GoPayEnvironment, string> = {
    sandbox: 'https://gw.sandbox.gopay.com/gp-gw/api/4.0',
    production: 'https://gate.gopay.com/gp-gw/api/4.0',
};

/**
 * gw-logger ingest, keyed on the same `environment` the API base URL is keyed
 * on. Deliberately a second entry in this table rather than a new setting: the
 * operational data the browser SDK emits is GoPay's, so there is nothing here
 * for an integrator to point elsewhere, and nothing new to configure.
 *
 * Not derived from BASE_URLS either — `lx` is its own host, and a rule that
 * rewrote `gw.` into `lx.` would silently produce a wrong host the moment
 * `config.baseUrl` is overridden for a mock server.
 */
export const LOGGER_URLS: Record<GoPayEnvironment, string> = {
    sandbox: 'https://lx.sandbox.gopay.com',
    production: 'https://lx.gopay.com',
};
