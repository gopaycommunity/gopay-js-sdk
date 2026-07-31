import {
    GoPayErrorCodes,
    GoPaySDKError,
    SDK_ACCEPT_HEADER,
} from '@gopay-internal/core';
import type { BrowserData } from '../../types/index.js';

// Accept-Encoding is a forbidden request header per the Fetch spec — JavaScript
// cannot read the value the browser actually sends, so we report the set all
// current browsers advertise as a documented approximation.
const ACCEPT_ENCODING_APPROXIMATION = 'gzip, deflate, br, zstd';

/**
 * Format `navigator.languages` as an Accept-Language header value with
 * q-values, mirroring how browsers derive the real header from the
 * preference list (e.g. `cs-CZ,cs;q=0.9,en;q=0.8`).
 */
function buildAcceptLanguage(): string {
    const languages =
        navigator.languages && navigator.languages.length > 0
            ? navigator.languages
            : [navigator.language];
    return languages
        .map((language, index) => {
            if (index === 0) {
                return language;
            }
            const q = Math.max(1 - index * 0.1, 0.1);
            return `${language};q=${q.toFixed(1)}`;
        })
        .join(',');
}

/**
 * Build the JSON-encoded `accept_header` value required by the API.
 *
 * - `accept` — the Accept header the SDK itself sets on the charge request.
 * - `accept-language` — derived from `navigator.languages` with q-values.
 * - `accept-encoding` — constant approximation; see
 *   {@link ACCEPT_ENCODING_APPROXIMATION}.
 */
function buildAcceptHeader(): string {
    return JSON.stringify({
        'accept-language': buildAcceptLanguage(),
        'accept-encoding': ACCEPT_ENCODING_APPROXIMATION,
        accept: SDK_ACCEPT_HEADER,
    });
}

/**
 * Collect browser context data for 3D Secure and fraud detection.
 *
 * Reads `navigator`, `screen`, and `Date` globals.
 *
 * The result is automatically merged into every {@link chargePayment}
 * call. You can also call this directly to inspect or override individual
 * fields before passing them as `params.browser_data`.
 *
 * The `ip` field is not collectable client-side and is omitted — the GoPay
 * backend populates it from the HTTP request.
 *
 * @example
 * const data = collectBrowserData();
 * await sdk.chargePayment(paymentId, {
 *   ...chargeParams,
 *   browser_data: { ...data, language: 'en-US' }, // override one field
 * });
 */
export function collectBrowserData(): BrowserData {
    if (typeof navigator === 'undefined' || typeof screen === 'undefined') {
        throw new GoPaySDKError(
            '[GoPaySDK] collectBrowserData() must be called in a browser environment.',
            { errorCode: GoPayErrorCodes.INVALID_CONFIG },
        );
    }

    return {
        language: navigator.language,
        timezone: new Date().getTimezoneOffset(),
        user_agent: navigator.userAgent,
        javascript_enabled: true,
        screen_width: screen.width,
        screen_height: screen.height,
        color_depth: screen.colorDepth,
        accept_header: buildAcceptHeader(),
    };
}
