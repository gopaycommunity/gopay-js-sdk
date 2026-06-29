export type StopFn = (fn: () => void) => void;

/**
 * Runs a polling loop and returns a stop function.
 *
 * Handles the shared mechanics: stopped flag, poll interval cleanup,
 * and AbortSignal teardown. Call stop(fn) to tear down the loop and invoke fn.
 *
 * @param poll         Function to call on each tick
 * @param intervalMs   Delay between ticks
 * @param signal       Optional abort signal
 * @param reject       Promise reject from the enclosing new Promise — called on poll errors
 * @param onTick       Called with each poll result; call stop(resolve/reject) to end the loop
 * @param onAbort      Called when signal fires; should call stop(reject(...))
 * @param extraCleanup Optional extra cleanup inside stop() (e.g. clear a timeout timer)
 */
export function runPollLoop<T>(
    poll: () => Promise<T>,
    intervalMs: number,
    signal: AbortSignal | undefined,
    reject: (reason: unknown) => void,
    onTick: (state: T, stop: StopFn) => void,
    onAbort: (stop: StopFn) => void,
    extraCleanup?: () => void,
): StopFn {
    let stopped = false;
    let pollHandle: ReturnType<typeof setTimeout> | undefined;

    const stop: StopFn = (fn) => {
        if (stopped) {
            return;
        }
        stopped = true;
        clearTimeout(pollHandle);
        extraCleanup?.();
        signal?.removeEventListener('abort', abortListener);
        fn();
    };

    const abortListener = () => onAbort(stop);
    signal?.addEventListener('abort', abortListener, { once: true });

    const doPoll = () => {
        if (stopped) {
            return;
        }
        poll()
            .then((state) => {
                if (stopped) {
                    return;
                }
                onTick(state, stop);
                if (!stopped) {
                    pollHandle = setTimeout(doPoll, intervalMs);
                }
            })
            .catch((err) => {
                if (stopped) {
                    return;
                }
                stop(() => reject(err));
            });
    };

    doPoll();
    return stop;
}
