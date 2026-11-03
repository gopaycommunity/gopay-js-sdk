/**
 * Request ids the API v4 gateway logs, so a call can be found from either side. Server SDK
 * only: from a browser these headers need the gateway's CORS to allow them first (GPOMA-2730).
 */
export interface Correlation {
    /** The whole `User-Agent` value. */
    userAgent?: string;
    /** The transaction id of the SDK call this request belongs to. */
    transactionId(): string;
}

export interface CorrelationIds {
    traceId: string;
    transactionId: string;
}

const PAYMENT_PATH = /^\/?payments\/([^/?#]+)/;

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
        traceId: crypto.randomUUID(),
        transactionId: correlation.transactionId(),
    };
    headers.set('X-GoPay-Trace-Id', ids.traceId);
    headers.set('X-GoPay-Transaction-Id', ids.transactionId);
    // Still percent-encoded as it went into the path: a header value must stay ASCII.
    const paymentId = PAYMENT_PATH.exec(path)?.[1];
    if (paymentId) {
        headers.set('X-GoPay-Payment-Session-Id', paymentId);
    }
    if (correlation.userAgent) {
        headers.set('User-Agent', correlation.userAgent);
    }
    return ids;
}
