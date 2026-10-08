import { nowMs } from '@gopay-internal/core';

/**
 * Whether this page has already reported its `leave`.
 *
 * A 3DS redirect reports the leave itself, ahead of the navigation, with the
 * ACS as its target — and the navigation then fires `pagehide`, whose beacon
 * would report a second, plain one. Two leaves per 3DS payment would count
 * every one of them as abandoned as well.
 *
 * Its own module because both sides need it and they already import each
 * other's types: the emitter sets it, the beacon reads it.
 */

/**
 * How long the redirect's leave stands in for the pagehide one. The same 30 s
 * the payments module gives a redirect to take the page away
 * (THREE_DS_REDIRECT_TIMEOUT_MS): a page still alive after that was not
 * navigated — a webview that dropped the redirect — and its real end, whenever
 * it comes, is a leave of its own.
 */
const LATCH_MS = 30_000;

let leftAt: number | undefined;

/** The leave has been reported; the beacon stays quiet for a while. */
export function markLeft(): void {
    leftAt = nowMs();
}

export function hasLeft(): boolean {
    return leftAt !== undefined && nowMs() - leftAt < LATCH_MS;
}

/**
 * A new SDK on the page starts a new visit — after a restore from the
 * back/forward cache, say — which gets a leave of its own.
 */
export function resetLeft(): void {
    leftAt = undefined;
}
