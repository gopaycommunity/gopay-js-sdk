import { GoPayErrorCodes, GoPaySDKError } from './errors.js';
import { runPollLoop } from './polling.js';

export type AwaitChargeOptions<T extends { state: string }> = {
    intervalMs?: number;
    initialTimeoutMs?: number;
    onStateChange?: (state: T) => void;
    onActionRequired?: (redirectUrl: string) => void;
    /** Abort the polling loop. The returned promise rejects with CHARGE_FAILED when aborted. */
    signal?: AbortSignal;
};

/**
 * Poll `poll()` until the charge reaches a terminal state.
 *
 * - Resolves on `SUCCEEDED`.
 * - Rejects with `CHARGE_FAILED` on `FAILED`.
 * - Rejects with `CHARGE_TIMEOUT` if the charge does not leave
 *   `REQUESTED`/`PROCESSING` within `initialTimeoutMs` (default 30 s).
 *   The timeout is cancelled once `ACTION_REQUIRED` is seen — 3DS can
 *   take an unlimited amount of time.
 * - `onStateChange` fires for every polled state, including terminal ones
 *   (before resolve/reject), so callers can display the final state.
 * - `onActionRequired` fires when `ACTION_REQUIRED` with a `redirect_url`
 *   is first seen; subsequent polls with the same URL are silently skipped.
 */
export function awaitCharge<
    T extends { state: string; action?: { redirect_url?: string } },
>(poll: () => Promise<T>, options?: AwaitChargeOptions<T>): Promise<T> {
    const intervalMs = options?.intervalMs ?? 2_000;
    const initialTimeoutMs = options?.initialTimeoutMs ?? 30_000;

    if (options?.signal?.aborted) {
        return Promise.reject(
            new GoPaySDKError('[GoPaySDK] Charge polling aborted.', {
                errorCode: GoPayErrorCodes.CHARGE_FAILED,
            }),
        );
    }

    return new Promise<T>((resolve, reject) => {
        let lastActionRequiredUrl: string | null = null;
        let initialTimer: ReturnType<typeof setTimeout> | undefined;

        const stop = runPollLoop(
            poll,
            intervalMs,
            options?.signal,
            reject,
            (state, stop) => {
                options?.onStateChange?.(state);

                if (state.state === 'SUCCEEDED') {
                    stop(() => resolve(state));
                    return;
                }

                if (state.state === 'FAILED') {
                    stop(() =>
                        reject(
                            new GoPaySDKError('[GoPaySDK] Charge failed', {
                                errorCode: GoPayErrorCodes.CHARGE_FAILED,
                                chargeState: state,
                            }),
                        ),
                    );
                    return;
                }

                if (state.state === 'ACTION_REQUIRED') {
                    clearTimeout(initialTimer);
                    if (
                        state.action?.redirect_url &&
                        state.action.redirect_url !== lastActionRequiredUrl
                    ) {
                        lastActionRequiredUrl = state.action.redirect_url;
                        options?.onActionRequired?.(state.action.redirect_url);
                    }
                }
            },
            (stop) =>
                stop(() =>
                    reject(
                        new GoPaySDKError(
                            '[GoPaySDK] Charge polling aborted.',
                            {
                                errorCode: GoPayErrorCodes.CHARGE_FAILED,
                            },
                        ),
                    ),
                ),
            () => clearTimeout(initialTimer),
        );

        initialTimer = setTimeout(() => {
            stop(() =>
                reject(
                    new GoPaySDKError(
                        '[GoPaySDK] Charge did not progress within the initial timeout',
                        { errorCode: GoPayErrorCodes.CHARGE_TIMEOUT },
                    ),
                ),
            );
        }, initialTimeoutMs);
    });
}
