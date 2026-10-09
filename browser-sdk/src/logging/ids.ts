/**
 * ECS `transaction.id` — one id per visit, so every event a customer generates
 * in one tab can be pulled together later.
 *
 * A visit, not a checkout: a shopper whose card is declined and who then pays
 * a second order in the same tab keeps this id, so the two payments share it.
 * That is deliberate and matches what gw-logger's schema says the field means;
 * `payment_session_id` is what separates the two payments.
 *
 * Kept in `sessionStorage` rather than in a module variable: the 3DS flow
 * navigates the top window away and back, and an in-memory id would split one
 * payment into two unrelatable halves at exactly the point where the data is
 * most needed. Storage is therefore read on each call rather than memoised —
 * it is a synchronous read of one short string, against a cap of 200 events per
 * visit, and it keeps the id correct across a reload instead of merely fast.
 *
 * Storage can throw or be absent (private mode, blocked site data, a
 * non-browser host). That path falls back to an in-memory id, which is the only
 * case where a reload starts a new transaction.
 */
const STORAGE_KEY = 'gopay.sdk.transaction_id';

let memoryFallback: string | null = null;

/** Only reached where the Web Crypto API is missing entirely. */
let idCounter = 0;

/**
 * These ids are correlation keys, never secrets — but `Math.random()` in a
 * payment SDK is worth not having at all, and a scanner cannot tell the two
 * uses apart. `randomUUID` first; `getRandomValues` where only the UUID helper
 * is missing (it needs a secure context, the byte source does not); and where
 * there is no Web Crypto at all, a timestamp plus an in-page counter, which
 * cannot collide inside the page that produced it — the only scope in which
 * the id has to be unique.
 */
function newId(): string {
    const webCrypto = globalThis.crypto;
    if (webCrypto?.randomUUID) {
        return webCrypto.randomUUID();
    }
    if (webCrypto?.getRandomValues) {
        const bytes = webCrypto.getRandomValues(new Uint8Array(8));
        const hex = Array.from(bytes, (b) =>
            b.toString(16).padStart(2, '0'),
        ).join('');
        return `txn-${Date.now()}-${hex}`;
    }
    idCounter += 1;
    return `txn-${Date.now()}-${idCounter}`;
}

export function getTransactionId(): string {
    try {
        const store = globalThis.sessionStorage;
        if (store) {
            const stored = store.getItem(STORAGE_KEY);
            if (stored) {
                return stored;
            }
            const created = newId();
            store.setItem(STORAGE_KEY, created);
            return created;
        }
    } catch {
        // Unavailable or blocked — fall through to the in-memory id.
    }

    memoryFallback ??= newId();
    return memoryFallback;
}

/**
 * ECS `event.sequence` — the events sent from one tab, numbered 1, 2, 3 across
 * every SDK instance and every page load in it, so a gap in a transaction's
 * numbering is an event lost on the way to gw-logger.
 *
 * Per tab rather than per instance, and kept beside the transaction id for the
 * same reason that id is: a count that restarts with every instance cannot see
 * an instance lost whole. mixit.fr builds a new SDK on every re-render and on
 * every return from 3DS, and a page load whose only event — its `init` — went
 * missing left no gap anywhere, which is exactly the visit that matters when
 * the question is whether the merchant's page ran at all at a given moment.
 *
 * Read and written in two steps, so a number is spent only on an event that is
 * actually handed to `fetch`: a refused or unbuildable event leaves no gap, or
 * a gap would stop meaning "lost".
 *
 * Storage that throws or is absent falls back to a count in memory, like the
 * transaction id, and like it restarts with the page. Storage that reads but
 * cannot be written repeats the last number rather than skipping one — a
 * repeat cannot be mistaken for a lost event.
 */
const SEQUENCE_KEY = 'gopay.sdk.sequence';

let memorySequence = 0;

/** The number the tab's last sent event carried; 0 before the first. */
export function lastSequence(): number {
    try {
        const store = globalThis.sessionStorage;
        if (store) {
            const stored = Number(store.getItem(SEQUENCE_KEY));
            return Number.isSafeInteger(stored) && stored > 0 ? stored : 0;
        }
    } catch {
        // Unavailable or blocked — fall through to the in-memory count.
    }
    return memorySequence;
}

/** Records the number an event just went out with. */
export function recordSequence(sent: number): void {
    try {
        const store = globalThis.sessionStorage;
        if (store) {
            store.setItem(SEQUENCE_KEY, String(sent));
            return;
        }
    } catch {
        // Unavailable or blocked — fall through to the in-memory count.
    }
    memorySequence = sent;
}

/**
 * ECS `trace.id` — one user action. A fresh one per event: the SDK has no
 * notion of a gesture spanning several calls, and inventing one would group
 * unrelated requests under a single id.
 */
export function newTraceId(): string {
    return newId();
}

/**
 * One browser SDK instance, for `sdk_instance_id`. From the same source as the
 * other ids; never stored, since an instance does not outlive its page.
 */
export function newInstanceId(): string {
    return newId();
}
