/**
 * Structured error codes for programmatic error handling and analytics.
 *
 * @example
 * ```ts
 * import { GoPayErrorCodes } from 'gopay-js-sdk';
 *
 * catch (err) {
 *   if (err instanceof GoPaySDKError) {
 *     switch (err.errorCode) {
 *       case GoPayErrorCodes.AUTH_TOKEN_MISSING:  authenticate(); break;
 *       case GoPayErrorCodes.NETWORK_TIMEOUT:     retryWithBackoff(); break;
 *     }
 *   }
 * }
 * ```
 */
export const GoPayErrorCodes = {
    // Authentication errors
    /** No access token in store — call authenticate() or setClientToken() */
    AUTH_TOKEN_MISSING: 'AUTH_TOKEN_MISSING',
    /** Token expired and no refresh token present */
    AUTH_REFRESH_TOKEN_MISSING: 'AUTH_REFRESH_TOKEN_MISSING',
    /** Refresh token request failed */
    AUTH_REFRESH_FAILED: 'AUTH_REFRESH_FAILED',
    /** Token response from server is missing required fields */
    AUTH_INVALID_RESPONSE: 'AUTH_INVALID_RESPONSE',
    /** No client credentials stored — call authenticate() first */
    AUTH_CREDENTIALS_MISSING: 'AUTH_CREDENTIALS_MISSING',
    /** Access token JWT is malformed or missing the sub claim */
    AUTH_INVALID_TOKEN: 'AUTH_INVALID_TOKEN',
    /** Request was unauthorized even after a successful token refresh */
    AUTH_UNAUTHORIZED: 'AUTH_UNAUTHORIZED',
    // Network errors
    /** Request timed out */
    NETWORK_TIMEOUT: 'NETWORK_TIMEOUT',
    /** Network-level failure (no response received) */
    NETWORK_ERROR: 'NETWORK_ERROR',
} as const;

export type GoPayErrorCode =
    (typeof GoPayErrorCodes)[keyof typeof GoPayErrorCodes];

/**
 * Thrown when the SDK encounters a lifecycle or configuration error —
 * e.g. no access token, session expired, or an unexpected token response.
 * These are SDK-level errors that require the integrator to take action
 * (re-authenticate, call setRefreshToken, check OAuth2 scopes, etc.).
 */
export class GoPaySDKError extends Error {
    readonly name = 'GoPaySDKError';
    readonly errorCode: GoPayErrorCode | undefined;

    constructor(
        message: string,
        options?: { cause?: unknown; errorCode?: GoPayErrorCode },
    ) {
        super(message);
        if (options?.cause !== undefined) {
            (this as { cause?: unknown }).cause = options.cause;
        }
        this.errorCode = options?.errorCode;
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
        super(
            `HTTP ${status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`,
        );
    }
}
