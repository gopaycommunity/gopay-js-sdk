import {
    GoPayErrorCodes,
    GoPaySDKError,
    type HttpClient,
    SDK_ACCEPT_HEADER,
} from '@gopay-internal/core';
import type {
    BrowserData,
    BrowserDataDetected,
    BrowserDeviceData,
} from '../../types/index.js';

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
 * Collect the browser context data that a page can read locally — language,
 * timezone, screen metrics and the `user_agent` / `accept_header`
 * approximations built above.
 *
 * Reads `navigator`, `screen`, and `Date` globals.
 *
 * `ip` is absent: JavaScript cannot see the address the request originates
 * from, and the backend does **not** fill it in. Use
 * {@link fetchBrowserData} to obtain it — that also replaces `user_agent`
 * and `accept_header` with the values the API actually observed, which is
 * what 3-D Secure authenticates against.
 *
 * @example
 * const device = collectBrowserData();   // no `ip` — not chargeable on its own
 */
export function collectBrowserData(): BrowserDeviceData {
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

/**
 * Fetch the browser data fields the page cannot determine on its own from
 * `GET /cards/browser-data`, and merge them over the locally collected ones.
 *
 * The endpoint derives `ip`, `user_agent` and `accept_header` from the request
 * that reaches it, so it must be called **from the customer's browser** — a
 * call made by the merchant's server reports the server's own connection and
 * the card issuer rejects the resulting authentication. Call it immediately
 * before charging and do not cache the result: a customer who changes network
 * between the two calls authenticates from an address that no longer matches.
 *
 * The SDK does this automatically inside `chargePayment`. Call it directly when
 * the merchant's **server** performs the charge: fetch here, hand the values to
 * your backend along with the card input, and have the backend place them in
 * `browser_data` unchanged.
 *
 * @example
 * const browserData = await sdk.getBrowserData();
 * await fetch('/api/charge', {
 *   method: 'POST',
 *   body: JSON.stringify({ encryptedPayload, browserData }),
 * });
 */
export async function fetchBrowserData(
    client: HttpClient,
    options?: { signal?: AbortSignal },
): Promise<BrowserData> {
    // The endpoint is secured by `shareable_key` alone. After attachPayment()
    // the client holds a payment-scoped JWT, which the default auth handler
    // would send instead, so the Basic credentials are set explicitly here.
    const shareableKey = client.getShareableKey() ?? '';
    const clientId = client.getClientId();
    const credentials = clientId
        ? globalThis.btoa(`${clientId}:${shareableKey}`)
        : globalThis.btoa(`:${shareableKey}`);

    const detected = await client.get<BrowserDataDetected>(
        '/cards/browser-data',
        {
            headers: { Authorization: `Basic ${credentials}` },
            signal: options?.signal,
        },
    );

    return { ...collectBrowserData(), ...detected };
}
