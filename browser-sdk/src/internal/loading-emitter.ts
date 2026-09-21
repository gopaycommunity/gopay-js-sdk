import type { BrowserTelemetry } from '../logging/gw-logger.js';
import { callIntegrator } from './integrator-callback.js';
import type { LoadingState } from './loading-spinner.js';

export function makeLoadingEmitter(
    cb: ((state: LoadingState) => void) | undefined,
    telemetry?: BrowserTelemetry,
): (state: LoadingState) => void {
    return (state: LoadingState) => {
        callIntegrator(
            'onLoadingStateChange',
            () => {
                cb?.(state);
            },
            telemetry,
        );
    };
}
