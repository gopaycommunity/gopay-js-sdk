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
let left = false;

/** The leave has been reported; the beacon stays quiet. */
export function markLeft(): void {
    left = true;
}

export function hasLeft(): boolean {
    return left;
}

/**
 * A new SDK on the page starts a new visit — after a restore from the
 * back/forward cache, say — which gets a leave of its own.
 */
export function resetLeft(): void {
    left = false;
}
