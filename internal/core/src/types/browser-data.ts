import type { components } from './generated.js';

/** The wire shape the API validates, `ip` included. */
type BrowserDataWire = components['schemas']['Browser-Data'];

/**
 * Browser context data collected for 3DS / fraud detection.
 *
 * `ip` is optional here even though the API requires it, and deliberately so:
 * the SDK fills it in from `GET /cards/browser-data` before charging, so code
 * that assembles `browser_data` itself — or passes {@link collectBrowserData}
 * straight through — keeps compiling exactly as it did before the endpoint
 * existed. Reach for `getBrowserData()` when you need the value itself.
 */
export type BrowserData = Omit<BrowserDataWire, 'ip'> & { ip?: string };

/**
 * The three fields the customer's browser cannot determine on its own, as
 * returned by `GET /cards/browser-data`: they describe the connection rather
 * than the page.
 */
export type BrowserDataDetected =
    components['schemas']['Browser-Data-Detected'];
