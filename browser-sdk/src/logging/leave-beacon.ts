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
 * The event is a plain `fetch` with `keepalive` inside the telemetry emitter,
 * which is what lets it outlive the page — the same mechanism the charge event
 * relies on to survive the 3DS redirect.
 */
/**
 * The page ends once, however many SDK instances were built on it.
 *
 * One listener per instance is what this replaces, and live sandbox data is
 * what showed it: an integrator that rebuilds the SDK when its configuration
 * changes left every previous instance's listener registered, so one page
 * teardown produced three `leave` events, and an earlier one produced five —
 * some carrying a payment session, some from instances created before the
 * attach. That inflates the abandonment count, which is the single number
 * this beacon exists to produce.
 *
 * It also sent real events from the test suite. A test stubs `fetch`, builds
 * an SDK, and restores `fetch` in its teardown while the listener stays
 * behind; the next test to dispatch `pagehide` then woke every abandoned
 * listener with the real `fetch` back in place, and the sandbox ingest has
 * the `browser-sdk-test` rows to prove it.
 *
 * So: one listener, retargeted at whichever SDK was built last, which is the
 * one the page is actually using. After it fires it is gone and a later
 * instance may install a fresh one — a page restored from the back/forward
 * cache is a second visit, not a continuation.
 *
 * What keeps it to one listener is that `onPageHide` is a module-level
 * reference: `addEventListener` ignores a repeat registration of the same
 * function with the same options, so calling this per instance adds nothing.
 * That is the load-bearing detail, and it is load-bearing invisibly — turn
 * `onPageHide` into a closure built per call and every instance registers
 * again, which is the bug this replaced. The guard is the test that dispatches
 * one `pagehide` after several registrations and expects one `leave`; it fails
 * on exactly that change.
 */
let activeTelemetry: BrowserTelemetry | undefined;

function onPageHide(): void {
    activeTelemetry?.lifecycle('leave');
}

export function registerLeaveBeacon(telemetry: BrowserTelemetry): void {
    activeTelemetry = telemetry;

    if (typeof globalThis.addEventListener !== 'function') {
        return;
    }
    globalThis.addEventListener('pagehide', onPageHide, { once: true });
}
