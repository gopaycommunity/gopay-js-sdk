/**
 * Thrown when the SDK encounters a lifecycle or configuration error —
 * e.g. no access token, session expired, or an unexpected token response.
 * These are SDK-level errors that require the integrator to take action
 * (re-authenticate, call setRefreshToken, check OAuth2 scopes, etc.).
 */
export class GoPaySDKError extends Error {
    readonly name = 'GoPaySDKError';

    constructor(message: string, options?: { cause?: unknown }) {
        super(message);
        if (options?.cause !== undefined) {
            (this as { cause?: unknown }).cause = options.cause;
        }
    }
}

/**
 * Thrown when the GoPay API returns a non-2xx HTTP response.
 * `status` is the HTTP status code; `body` is the parsed response body
 * (JSON object when the API returns one, plain string otherwise).
 *
 * @example
 * ```ts
 * import { GoPayHTTPError } from 'gopay-js-sdk';
 *
 * try {
 *   await sdk.payments.create(goid, params);
 * } catch (err) {
 *   if (err instanceof GoPayHTTPError) {
 *     console.error(err.status, err.body);
 *   }
 * }
 * ```
 */
export class GoPayHTTPError extends Error {
    readonly name = 'GoPayHTTPError';

    constructor(
        public readonly status: number,
        public readonly body: unknown,
    ) {
        super(`HTTP ${status}`);
    }
}
