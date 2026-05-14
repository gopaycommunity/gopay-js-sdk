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
    // Card form errors
    /** The GoPay card encryption iframe reported an error */
    CARD_FORM_ERROR: 'CARD_FORM_ERROR',
    // Charge polling errors
    /** Charge did not leave REQUESTED/PROCESSING within the initial timeout */
    CHARGE_TIMEOUT: 'CHARGE_TIMEOUT',
    /** Charge reached terminal FAILED state */
    CHARGE_FAILED: 'CHARGE_FAILED',
    // Browser SDK payment attachment
    /** attachPayment() must be called before payment-scoped operations (charge, Apple/Google Pay, status) */
    PAYMENT_NOT_ATTACHED: 'PAYMENT_NOT_ATTACHED',
} as const;

export type GoPayErrorCode =
    (typeof GoPayErrorCodes)[keyof typeof GoPayErrorCodes];

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

export class GoPayHTTPError extends Error {
    readonly name = 'GoPayHTTPError';

    constructor(
        public readonly status: number,
        public readonly body: unknown,
    ) {
        super(`GoPay API error: HTTP ${status}`);
    }
}
