import type { HttpClient } from '@gopay-internal/core';

/**
 * Report a failure that is delivered by rejecting a controller's `result`,
 * passing the telemetry opt-out only when there is one.
 *
 * `reportError(err, undefined)` and `reportError(err)` mean the same thing to
 * core, but they are not the same call, and every caller that has no opinion
 * about telemetry should look like it has none. The card form and both wallet
 * buttons settle through this, so the fork exists once rather than per module.
 */
export function reportFailure(
    client: HttpClient,
    error: unknown,
    options?: { telemetry?: boolean },
): void {
    if (options) {
        client.reportError(error, options);
        return;
    }
    client.reportError(error);
}
