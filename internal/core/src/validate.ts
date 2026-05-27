import { GoPayErrorCodes, GoPaySDKError } from './errors.js';

/**
 * Validates that `value` is a non-empty, non-whitespace string.
 * Returns the trimmed value so callers can use it directly in URLs.
 */
export function requireNonEmptyString(value: string, field: string): string {
    if (typeof value !== 'string' || !value.trim()) {
        throw new GoPaySDKError(`[GoPaySDK] ${field} is required`, {
            errorCode: GoPayErrorCodes.INVALID_ARGUMENT,
        });
    }
    return value.trim();
}

/**
 * Throws GoPaySDKError if `origin` is not a valid https: origin string.
 * No-op when `origin` is empty — callers guard the optional case themselves.
 */
export function assertHttpsOrigin(origin: string, errorPrefix: string): void {
    let parsed: URL;
    try {
        parsed = new URL(origin);
    } catch {
        throw new GoPaySDKError(`${errorPrefix}: invalid origin "${origin}"`, {
            errorCode: GoPayErrorCodes.INVALID_ARGUMENT,
        });
    }
    if (parsed.protocol !== 'https:' || parsed.origin !== origin) {
        throw new GoPaySDKError(
            `${errorPrefix}: origin must be an https: origin. Got "${origin}"`,
            { errorCode: GoPayErrorCodes.INVALID_ARGUMENT },
        );
    }
}
