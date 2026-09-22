import { safeErrorLabel } from '@gopay-internal/core';
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
        // Never the message, and never a name the merchant's code supplied:
        // `safeErrorLabel` is core's one rule for that, shared so the SDK
        // cannot end up with two answers to the same question.
        telemetry?.integratorError(label, safeErrorLabel(error));
    }
}
