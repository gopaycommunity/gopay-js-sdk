import type { BrowserTelemetry } from '../logging/gw-logger.js';

/**
 * Invoke a callback the integrator supplied, without letting their bug become
 * ours and without swallowing it.
 *
 * These call sites used to be a bare `try { cb() } catch {}`. The catch is
 * right — a throwing `onStateChange` must not abort a charge that is already
 * in flight — but discarding the error made a bug in the merchant's own code
 * invisible to everybody, including the merchant. It is the one class of
 * failure the SDK can see and they cannot.
 *
 * So: catch, then rethrow on a fresh task. By the time the timeout runs the
 * SDK is long out of the call stack, so nothing downstream is affected, and
 * the error surfaces through `window.onerror` with its original stack —
 * reaching whatever error monitoring the page already has. That is the right
 * owner for a bug in the page's own code, and it is why the SDK installs no
 * global handler of its own.
 */
/**
 * `Error.name` is writable — `err.name = someCustomerEmail` is legal — and a
 * custom error class can be named anything its author likes. So the class
 * name is not the safe constant it looks like, and this event's whole promise
 * is that it carries nothing the merchant's code chose. An allowlist of the
 * built-ins makes that promise true instead of approximately true; anything
 * else reports as the base class it is.
 */
const REPORTABLE_ERROR_NAMES: ReadonlySet<string> = new Set([
    'AggregateError',
    'DOMException',
    'Error',
    'EvalError',
    'RangeError',
    'ReferenceError',
    'SyntaxError',
    'TypeError',
    'URIError',
]);

function safeErrorName(error: unknown): string {
    if (!(error instanceof Error)) {
        // A fixed vocabulary: 'string', 'object', 'undefined', …
        return typeof error;
    }
    return REPORTABLE_ERROR_NAMES.has(error.name) ? error.name : 'Error';
}

export function callIntegrator(
    label: string,
    fn: () => void,
    telemetry?: BrowserTelemetry,
): void {
    try {
        fn();
    } catch (error) {
        setTimeout(() => {
            throw error;
        });
        // Never the message, and never a name the merchant's code supplied
        // — see safeErrorName.
        telemetry?.integratorError(label, safeErrorName(error));
    }
}
