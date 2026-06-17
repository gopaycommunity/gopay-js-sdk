import type { LoadingState } from './loading-spinner.js';

export function makeLoadingEmitter(
    cb: ((state: LoadingState) => void) | undefined,
): (state: LoadingState) => void {
    return (state: LoadingState) => {
        try {
            cb?.(state);
        } catch {
            // consumer callback errors must not corrupt SDK flows
        }
    };
}
