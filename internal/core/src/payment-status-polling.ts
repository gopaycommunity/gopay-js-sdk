import { GoPayErrorCodes, GoPaySDKError } from './errors.js';
import { runPollLoop } from './polling.js';

const DEFAULT_TERMINAL_STATES = new Set([
    'PAID',
    'CANCELED',
    'TIMEOUTED',
    'REFUNDED',
    'PARTIALLY_REFUNDED',
]);

export type AwaitPaymentStatusOptions<T extends { state: string }> = {
    /**
     * States that end polling and resolve the promise.
     * @default ['PAID', 'CANCELED', 'TIMEOUTED', 'REFUNDED', 'PARTIALLY_REFUNDED']
     */
    terminalStates?: string[];
    /** Polling interval in milliseconds. @default 3000 */
    intervalMs?: number;
    /**
     * Maximum wait in milliseconds before rejecting with `CHARGE_TIMEOUT`.
     * Omit (default) for indefinite polling — the server will cancel the payment on its own schedule.
     */
    timeoutMs?: number;
    /** Abort signal to cancel polling. Rejects with `CHARGE_FAILED` when aborted. */
    signal?: AbortSignal;
    /** Called after every poll, including on terminal state (before resolve). */
    onStateChange?: (state: T) => void;
};

/**
 * Poll `poll()` until the payment reaches a terminal state.
 *
 * Unlike `awaitCharge`, there is no default timeout — QR and bank-transfer
 * payments may stay pending until the server cancels them. Pass `timeoutMs`
 * explicitly if you need a client-side ceiling.
 *
 * Resolves with the terminal `PaymentDetails` response.
 * Rejects with `CHARGE_TIMEOUT` if `timeoutMs` is set and the payment does
 * not reach a terminal state in time.
 * Rejects with `CHARGE_FAILED` if the abort signal fires.
 */
export function awaitPaymentStatus<T extends { state: string }>(
    poll: () => Promise<T>,
    options?: AwaitPaymentStatusOptions<T>,
): Promise<T> {
    const intervalMs = options?.intervalMs ?? 3_000;
    const terminal = options?.terminalStates
        ? new Set(options.terminalStates)
        : DEFAULT_TERMINAL_STATES;

    if (options?.signal?.aborted) {
        return Promise.reject(
            new GoPaySDKError('[GoPaySDK] Payment status polling aborted.', {
                errorCode: GoPayErrorCodes.CHARGE_FAILED,
            }),
        );
    }

    return new Promise<T>((resolve, reject) => {
        let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

        const stop = runPollLoop(
            poll,
            intervalMs,
            options?.signal,
            reject,
            (status, stop) => {
                options?.onStateChange?.(status);
                if (terminal.has(status.state)) {
                    stop(() => resolve(status));
                }
            },
            (stop) =>
                stop(() =>
                    reject(
                        new GoPaySDKError(
                            '[GoPaySDK] Payment status polling aborted.',
                            { errorCode: GoPayErrorCodes.CHARGE_FAILED },
                        ),
                    ),
                ),
            () => clearTimeout(timeoutHandle),
        );

        if (options?.timeoutMs !== undefined) {
            timeoutHandle = setTimeout(() => {
                stop(() =>
                    reject(
                        new GoPaySDKError(
                            '[GoPaySDK] Payment did not reach a terminal state within the timeout.',
                            { errorCode: GoPayErrorCodes.CHARGE_TIMEOUT },
                        ),
                    ),
                );
            }, options.timeoutMs);
        }
    });
}
