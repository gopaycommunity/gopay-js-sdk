/**
 * A signal that aborts after `ms`, or earlier with the caller's own signal.
 *
 * `AbortSignal.timeout` and especially `AbortSignal.any` are far newer than the
 * ES2020 baseline this package is built for — Safari 17.4, Chrome 116, Firefox
 * 124 for `any` — and the CDN bundle runs in whatever browser the merchant's
 * customer brought. Called bare, they throw a TypeError before the request is
 * even built, which on the token exchange takes the charge down with it. Where
 * they are missing, an `AbortController` is wired by hand instead.
 *
 * The fallback aborts with a `TimeoutError`, the name the HTTP client maps to
 * `NETWORK_TIMEOUT`, so a timeout reads the same on either path. An engine
 * too old to carry an abort reason rejects with a plain `AbortError` instead,
 * which still ends the request.
 *
 * `release` stops the hand-wired timer and detaches from the caller's signal.
 * Calling it is optional: without it the timer simply fires late against a
 * request that has already finished, which is what `AbortSignal.timeout` does
 * on the native path too. Call it only once the response body has been read —
 * `fetch` resolves on the headers, and a body that then stalls is exactly what
 * the timeout is for.
 */
export function timeoutSignal(
    ms: number,
    callerSignal?: AbortSignal,
): { signal: AbortSignal; release: () => void } {
    if (
        typeof AbortSignal.timeout === 'function' &&
        (callerSignal === undefined || typeof AbortSignal.any === 'function')
    ) {
        const timeout = AbortSignal.timeout(ms);
        return {
            signal: callerSignal
                ? AbortSignal.any([callerSignal, timeout])
                : timeout,
            release: () => {},
        };
    }

    const controller = new AbortController();
    const forwardAbort = () => controller.abort(callerSignal?.reason);
    if (callerSignal?.aborted) {
        forwardAbort();
    }
    callerSignal?.addEventListener('abort', forwardAbort, { once: true });
    const timer = setTimeout(() => {
        callerSignal?.removeEventListener('abort', forwardAbort);
        controller.abort(timeoutReason());
    }, ms);
    return {
        signal: controller.signal,
        release: () => {
            clearTimeout(timer);
            callerSignal?.removeEventListener('abort', forwardAbort);
        },
    };
}

function timeoutReason(): unknown {
    try {
        return new DOMException('The operation timed out.', 'TimeoutError');
    } catch {
        // DOMException is not constructible everywhere; the abort still ends
        // the request, only without the name.
        return undefined;
    }
}
