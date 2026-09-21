import type { BrowserTelemetry } from './gw-logger.js';

/**
 * Reports the visit ending, once.
 *
 * Without it the most telling failure is the one that reports nothing: a
 * customer who gives up while the form is still loading produces an `init`, no
 * `ready`, and then silence — indistinguishable from a page still open in a
 * background tab. The beacon turns that into a fact with a timestamp.
 *
 * `visibilitychange` rather than `beforeunload` or `unload`: those two are not
 * fired reliably on mobile Safari or Chrome for Android, where a tab is more
 * often discarded than closed. `hidden` is the last callback a page is
 * guaranteed to get.
 *
 * The event is a plain `fetch` with `keepalive` inside the telemetry emitter,
 * which is what lets it outlive the page — the same mechanism the charge event
 * relies on to survive the 3DS redirect.
 */
export function registerLeaveBeacon(telemetry: BrowserTelemetry): void {
    // A visit ends once. `hidden` fires on every tab switch, and a shopper who
    // switches to their banking app and back would otherwise report a leave
    // per switch, inflating exactly the number this exists to measure.
    let sent = false;

    if (typeof globalThis.document?.addEventListener !== 'function') {
        return;
    }

    globalThis.document.addEventListener('visibilitychange', () => {
        if (sent || globalThis.document.visibilityState !== 'hidden') {
            return;
        }
        sent = true;
        telemetry.lifecycle('leave');
    });
}
