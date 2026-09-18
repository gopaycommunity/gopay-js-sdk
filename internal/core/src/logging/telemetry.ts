import type { GoPayHTTPError, GoPaySDKError } from '../errors.js';

/**
 * One completed HTTP call: what was asked, how it ended, how long it took.
 *
 * `endpoint` is the template (`/payments/{id}/charge`), never the raw path —
 * the raw one opens a fresh group per payment in any monitoring tool, and it
 * carries the id into a log line that has no business holding one.
 */
export interface ApiCallRecord {
    method: string;
    endpoint: string;
    /** HTTP status, or `null` when the request never produced a response. */
    statusCode: number | null;
    durationMs: number;
}

/**
 * The seam between the SDK core and whatever ships its operational data.
 *
 * It lives here because the timing and the error funnel do, but core never
 * decides to send anything: the browser SDK installs a real implementation, the
 * server SDK installs none. A Node process must not start phoning home because
 * it happens to share an HTTP client with a browser bundle.
 */
export interface Telemetry {
    apiCall(record: ApiCallRecord): void;
    /**
     * An SDK-raised failure that is not an HTTP response — argument validation,
     * a config guard, a card form or wallet button giving up.
     *
     * `GoPayHTTPError` is deliberately not routed here: it already left through
     * `apiCall` carrying its real status, and reporting it twice would double
     * every failed request in the data.
     */
    error(error: GoPaySDKError | GoPayHTTPError): void;
}

/**
 * The default. Every call site can stay unconditional, which is what keeps the
 * instrumentation out of the read path of the code it measures.
 */
export const NO_TELEMETRY: Telemetry = {
    apiCall: () => {},
    error: () => {},
};

/**
 * Monotonic where it exists. `performance.now()` is unaffected by the wall
 * clock being adjusted mid-request, which `Date.now()` is — and a duration is
 * exactly the measurement a clock step corrupts.
 */
export function nowMs(): number {
    return typeof globalThis.performance?.now === 'function'
        ? globalThis.performance.now()
        : Date.now();
}
