// Keep in sync with gw-ui-cc-v4 manually — no shared package.
export const SENSITIVE_KEYS = new Set([
    'card_number',
    'card_pan',
    'pan',
    'cardToken',
    'card_token',
    'token',
    'shareable_key',
    'cvv',
    'cvv2',
    'security_code',
    'expiry',
    'expiration',
    'exp_month',
    'exp_year',
    'account_number',
    'payment_secret',
]);

const PAN_PATTERN = /^\d{16,}$/;

export function sanitizeBody(value) {
    if (Array.isArray(value)) {
        return value.map(sanitizeBody);
    }
    if (value !== null && typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            out[k] = SENSITIVE_KEYS.has(k) ? '[REDACTED]' : sanitizeBody(v);
        }
        return out;
    }
    if (typeof value === 'string' && PAN_PATTERN.test(value)) {
        return '[REDACTED]';
    }
    return value;
}
