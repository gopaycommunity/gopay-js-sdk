import type { components } from './generated.js';

/** Browser context data collected for 3DS / fraud detection. */
export type BrowserData = components['schemas']['Browser-Data'];

/**
 * The three fields the customer's browser cannot determine on its own, as
 * returned by `GET /cards/browser-data`: they describe the connection rather
 * than the page.
 */
export type BrowserDataDetected =
    components['schemas']['Browser-Data-Detected'];

/**
 * Everything in {@link BrowserData} that a browser can read locally — the whole
 * object apart from `ip`, which only the browser data endpoint can supply.
 */
export type BrowserDeviceData = Omit<BrowserData, 'ip'>;
