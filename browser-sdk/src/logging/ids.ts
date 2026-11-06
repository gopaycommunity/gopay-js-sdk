/**
 * ECS `transaction.id` — one id per page load, the same unit gw-ui uses, so a
 * checkout's events in gw-logger and the API v4 requests it made
 * (`X-GoPay-Transaction-Id`, see gopay-browser-sdk.ts) group the same way on
 * both sides.
 *
 * A page load, not a checkout: a shopper whose card is declined and who then
 * pays a second order on the same page keeps this id, so the two payments
 * share it; `payment_session_id` is what separates them.
 *
 * Kept in memory, deliberately: the 3DS flow navigates the top window away
 * and back, and the page that comes back is a new load with a new id. The two
 * halves of that payment are joined by `payment_session_id`, which both carry —
 * exactly as gw-ui's are.
 */
let transactionId: string | null = null;

/** Only reached where the Web Crypto API is missing entirely. */
let idCounter = 0;

/**
 * These ids are correlation keys, never secrets — but `Math.random()` in a
 * payment SDK is worth not having at all, and a scanner cannot tell the two
 * uses apart. `randomUUID` first; where only the UUID helper is missing (it
 * needs a secure context, the byte source does not), the same version 4 UUID
 * built from `getRandomValues`; and where there is no Web Crypto at all, a
 * timestamp plus an in-page counter, which cannot collide inside the page that
 * produced it — the only scope in which the id has to be unique.
 */
function newId(): string {
    const webCrypto = globalThis.crypto;
    if (webCrypto?.randomUUID) {
        return webCrypto.randomUUID();
    }
    if (webCrypto?.getRandomValues) {
        const bytes = webCrypto.getRandomValues(new Uint8Array(16));
        // RFC 9562 §5.4: version 4 in the high nibble of byte 6, variant 10 in byte 8.
        bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
        bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
        const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
        return [
            hex.slice(0, 4),
            hex.slice(4, 6),
            hex.slice(6, 8),
            hex.slice(8, 10),
            hex.slice(10, 16),
        ]
            .map((group) => group.join(''))
            .join('-');
    }
    idCounter += 1;
    return `txn-${Date.now()}-${idCounter}`;
}

export function getTransactionId(): string {
    transactionId ??= newId();
    return transactionId;
}

/**
 * ECS `event.sequence` — the events sent from one page load, numbered 1, 2, 3
 * across every SDK instance on it, so a gap in a transaction's numbering is an
 * event lost on the way to gw-logger.
 *
 * Per page rather than per instance: mixit.fr builds a new SDK on every
 * re-render, and a count that restarted with each instance could not see an
 * instance whose only event — its `init` — went missing. It starts again from
 * 1 with the page, as gw-ui's does, so a page load lost whole leaves no gap;
 * that is the price of the per-page transaction id above.
 *
 * Read and written in two steps, so a number is spent only on an event that is
 * actually handed to `fetch`: a refused or unbuildable event leaves no gap, or
 * a gap would stop meaning "lost".
 */
let sequence = 0;

/** The number the page's last sent event carried; 0 before the first. */
export function lastSequence(): number {
    return sequence;
}

/** Records the number an event just went out with. */
export function recordSequence(sent: number): void {
    sequence = sent;
}

/**
 * ECS `trace.id` — a fresh one per gw-logger event, and per API v4 request as
 * its `X-GoPay-Trace-Id` (the request's `api_call` event carries the same one).
 * The SDK has no notion of a gesture spanning several calls, and inventing one
 * would group unrelated requests under a single id.
 */
export function newTraceId(): string {
    return newId();
}
