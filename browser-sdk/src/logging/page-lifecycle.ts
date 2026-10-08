import { nowMs } from '@gopay-internal/core';
import type { BrowserTelemetry, PageState } from './gw-logger.js';
import { rearmLeaveBeacon } from './leave-beacon.js';

/**
 * What happened to the page between the SDK's events, so a visit that stops
 * reporting can be told apart from one whose report was lost.
 *
 * The leave beacon cannot answer that on its own. It fires on `pagehide`, and a
 * mobile tab backgrounded and later discarded by the OS never fires it — on
 * live mixit.fr data a checkout's events simply stop, and nothing says whether
 * the customer closed the tab, the browser froze and threw it away, or the
 * `leave` was sent and lost on the way. These close that gap:
 *
 * - `PAGE.hidden` / `PAGE.visible` — the page left the screen and came back:
 *   another tab or app, the screen locked, the banking app opened for a 3DS
 *   code. A visit whose last event is `PAGE.hidden` was abandoned in the
 *   background, not cut off mid-flight.
 * - `PAGE.freeze` / `PAGE.resume` — the browser suspended the background tab,
 *   the step before it discards one. Chromium only.
 * - `PAGE.restored` — the page came back from the back/forward cache, a second
 *   visit on the same document.
 * - `PAGE.discarded` — this document is the reload of a tab the browser threw
 *   away. sessionStorage survives the discard, so it carries the same
 *   `transaction_id` as the visit that went silent, which is the explanation
 *   that visit never got to send. Chromium only.
 *
 * Together with `seq`, a gap in which is an event lost on the way, that makes
 * a missing `leave` either lost, never sent, or never possible.
 *
 * Not `blur` / `focus`. The card form is an iframe, so the window blurs every
 * time the customer taps into a card field, and the Apple Pay sheet blurs it
 * too — a stream of those would bury the transitions that matter.
 *
 * One set of listeners per page, retargeted at the SDK built last, for the
 * reason the leave beacon gives: every handler is a module-level reference,
 * and `addEventListener` ignores a repeat registration of the same function,
 * so an integrator that rebuilds the SDK adds nothing.
 */

let activeTelemetry: BrowserTelemetry | undefined;

/** The visibility last reported, and since when — what `duration` measures. */
let visibility: DocumentVisibilityState | undefined;
let visibilitySince = 0;

/** When the browser froze the page; `resume` is timed from it. */
let frozenAt: number | undefined;

/** When the page entered the back/forward cache; `restored` is timed from it. */
let cachedAt: number | undefined;

/** A discarded document says so once, however many SDKs it builds. */
let discardReported = false;

/** `wasDiscarded` is Chromium's, and not in the DOM typings. */
type DiscardableDocument = Document & { wasDiscarded?: boolean };

/** Whole milliseconds since `start`; null when there is no start to time from. */
function msSince(start: number | undefined): number | null {
    return start === undefined ? null : Math.round(nowMs() - start);
}

function report(state: PageState, durationMs: number | null): void {
    activeTelemetry?.page({ state, durationMs });
}

function onVisibilityChange(): void {
    const next = globalThis.document?.visibilityState;
    // Only the two states a page can move between; `prerender` is not one the
    // SDK can be running in by the time a customer sees it.
    if ((next !== 'hidden' && next !== 'visible') || next === visibility) {
        return;
    }
    // How long the page spent in the state it is leaving: on `hidden`, how
    // long the customer had it on screen; on `visible`, how long they were away.
    const durationMs = msSince(visibilitySince);
    visibility = next;
    visibilitySince = nowMs();
    report(next, durationMs);
}

function onFreeze(): void {
    frozenAt = nowMs();
    // Timed from the page going out of view: how long a background tab lasts
    // before the browser suspends it.
    report('freeze', visibility === 'hidden' ? msSince(visibilitySince) : null);
}

function onResume(): void {
    report('resume', msSince(frozenAt));
    frozenAt = undefined;
}

function onPageHide(event: PageTransitionEvent): void {
    // Only an entry into the back/forward cache can come back; any other
    // teardown is the leave beacon's to report.
    cachedAt = event.persisted ? nowMs() : undefined;
}

function onPageShow(event: PageTransitionEvent): void {
    if (!event.persisted) {
        return;
    }
    report('restored', msSince(cachedAt));
    cachedAt = undefined;
    // The leave beacon fired on the way into the cache and is gone. Nothing
    // rebuilds the SDK on a restore — the page's script state comes back as it
    // was — so without this the second departure from the same document is
    // never reported.
    rearmLeaveBeacon();
}

export function registerPageLifecycle(telemetry: BrowserTelemetry): void {
    activeTelemetry = telemetry;

    const doc = globalThis.document as DiscardableDocument | undefined;
    if (
        !doc ||
        typeof doc.addEventListener !== 'function' ||
        typeof globalThis.addEventListener !== 'function'
    ) {
        return;
    }

    if (visibility === undefined) {
        visibility = doc.visibilityState;
        visibilitySince = nowMs();
    }

    doc.addEventListener('visibilitychange', onVisibilityChange);
    doc.addEventListener('freeze', onFreeze);
    doc.addEventListener('resume', onResume);
    globalThis.addEventListener('pagehide', onPageHide);
    globalThis.addEventListener('pageshow', onPageShow);

    if (!discardReported && doc.wasDiscarded === true) {
        discardReported = true;
        report('discarded', null);
    }
}
