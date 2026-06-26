/**
 * OAuth2 scope strings for the GoPay Payments API.
 * Pass these to `authenticate({ scope: ... })`.
 *
 * Combine multiple scopes with a space: `GoPayScopes.PAYMENT_WRITE + ' ' + GoPayScopes.PAYMENT_READ`
 * or use the convenience {@link combineScopes} helper.
 */
export const GoPayScopes = {
    /** Create payments, charge, refund, manage recurrences and payment links. */
    PAYMENT_WRITE: 'payment:write',
    /** Read payment status, charge state, recurrences, refunds. */
    PAYMENT_READ: 'payment:read',
    /** Charge a single payment (browser/payment-credentials grant only). */
    PAYMENT_CHARGE: 'payment:charge',
    /** Tokenize card data via the hosted card form. */
    CARD_WRITE: 'card:write',
    /** Read and delete stored card tokens. */
    CARD_READ: 'card:read',
} as const;

export type GoPayScope = (typeof GoPayScopes)[keyof typeof GoPayScopes];

/** Combine multiple scope constants into a space-separated string. */
export function combineScopes(...scopes: GoPayScope[]): string {
    return scopes.join(' ');
}
