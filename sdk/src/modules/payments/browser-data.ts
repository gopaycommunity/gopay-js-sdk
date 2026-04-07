import type { BrowserData } from '../../types/index.js';

/**
 * Collect browser context data for 3D Secure and fraud detection.
 *
 * Reads `navigator`, `screen`, and `Date` globals. Returns an empty object
 * when called outside a browser environment (e.g. Node.js / SSR).
 *
 * The result is automatically merged into every {@link PaymentsModule.charge}
 * call. You can also call this directly to inspect or override individual
 * fields before passing them as `params.browser_data`.
 *
 * Fields not collectable client-side (`ip`, `accept_header`) are omitted —
 * the GoPay backend populates them from the HTTP request.
 *
 * @example
 * const data = collectBrowserData();
 * await sdk.payments.charge(paymentId, {
 *   ...chargeParams,
 *   browser_data: { ...data, language: 'en-US' }, // override one field
 * });
 */
export function collectBrowserData(): Partial<BrowserData> {
    if (typeof navigator === 'undefined') return {};

    return {
        language: navigator.language,
        timezone: new Date().getTimezoneOffset(),
        screen_width: screen.width,
        screen_height: screen.height,
        color_depth: screen.colorDepth,
        user_agent: navigator.userAgent,
        javascript_enabled: true,
    };
}
