/**
 * Request ids the API v4 gateway logs, so a call can be found from either side. The server
 * SDK sets them per SDK call, the browser SDK per page load (as gw-ui does); the gateway's
 * CORS allows all three from a page.
 */
export interface Correlation {
    /**
     * The whole `User-Agent` value. Server only: a page that set it would fail every call at
     * the CORS preflight, which allows the three `X-GoPay-*` headers but not `User-Agent`.
     */
    userAgent?: string;
    /** The transaction id this request belongs to: one per SDK call on a server, one per page load in a browser. */
    transactionId(): string;
    /**
     * The payment the SDK is working on, for a request whose path names none — the token
     * exchange and the card endpoints in the browser. A payment in the path wins.
     */
    paymentId?(): string | undefined;
    /**
     * A new trace id. `crypto.randomUUID` by default; the browser passes its own, because a
     * page served over plain http, and an older browser, has no `randomUUID`, and a missing
     * one would fail every request before it went out.
     */
    newTraceId?(): string;
}

export interface CorrelationIds {
    traceId: string;
    transactionId: string;
}

const PAYMENT_PATH = /^\/?payments\/([^/?#]+)/;

/** The ids `correlate` put on a request, read back where only its headers travel. */
export function correlationIdsOf(headers: Headers): CorrelationIds | undefined {
    const traceId = headers.get('X-GoPay-Trace-Id');
    const transactionId = headers.get('X-GoPay-Transaction-Id');
    return traceId && transactionId ? { traceId, transactionId } : undefined;
}

/**
 * Sets the ids on a request's headers and returns them. One trace id per request: a retry
 * resends the same headers and so keeps it, which is what lets the attempts be grouped.
 */
export function correlate(
    correlation: Correlation | undefined,
    headers: Headers,
    path: string,
): CorrelationIds | undefined {
    if (!correlation) {
        return undefined;
    }
    const ids = {
        traceId: correlation.newTraceId?.() ?? crypto.randomUUID(),
        transactionId: correlation.transactionId(),
    };
    headers.set('X-GoPay-Trace-Id', ids.traceId);
    headers.set('X-GoPay-Transaction-Id', ids.transactionId);
    // Percent-encoded, as it goes into a path: a header value must stay ASCII.
    const attached = correlation.paymentId?.();
    const paymentId =
        PAYMENT_PATH.exec(path)?.[1] ??
        (attached ? encodeURIComponent(attached) : undefined);
    if (paymentId) {
        headers.set('X-GoPay-Payment-Session-Id', paymentId);
    }
    if (correlation.userAgent) {
        headers.set('User-Agent', correlation.userAgent);
    }
    return ids;
}
