import type { BrowserTelemetry } from './gw-logger.js';

/**
 * Reports the visit ending, once.
 *
 * Without it the most telling failure is the one that reports nothing: a
 * customer who gives up while the form is still loading produces an `init`, no
 * `ready`, and then silence — indistinguishable from a page still open in a
 * background tab. The beacon turns that into a fact with a timestamp.
 *
 * `pagehide` rather than `visibilitychange`, which is what this used first.
 * `hidden` fires on every tab switch, so a shopper glancing at their banking
 * app for an SMS code produced a `leave` mid-payment — and the latch that was
 * meant to stop duplicates then blocked the real end of the visit, so the
 * event fired at the wrong moment and never at the right one. `pagehide`
 * fires when the document is actually being torn down: a navigation away
 * (including the 3DS redirect, which genuinely ends the visit to this page),
 * a closed tab, or entry into the back/forward cache. It does not fire on a
 * tab switch, which is the whole difference.
 *
 * What that costs: a mobile tab backgrounded and later discarded by the OS
 * never fires it. That is a lost event rather than a wrong one, and the data
 * is documented as a lower bound.
 *
 * `once` rather than a latch, so the listener also removes itself — an SDK
 * built per step in an SPA would otherwise leave one live listener per
 * construction, each pinning its own telemetry closure.
 *
 * The event is a plain `fetch` with `keepalive` inside the telemetry emitter,
 * which is what lets it outlive the page — the same mechanism the charge event
 * relies on to survive the 3DS redirect.
 */
export function registerLeaveBeacon(telemetry: BrowserTelemetry): void {
    if (typeof globalThis.addEventListener !== 'function') {
        return;
    }

    globalThis.addEventListener(
        'pagehide',
        () => {
            telemetry.lifecycle('leave');
        },
        { once: true },
    );
}
