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
 * ECS `trace.id` — one user action. A fresh one per event: the SDK has no
 * notion of a gesture spanning several calls, and inventing one would group
 * unrelated requests under a single id.
 */
export function newTraceId(): string {
    return newId();
}
