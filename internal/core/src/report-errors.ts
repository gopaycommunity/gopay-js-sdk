import { GoPayHTTPError, GoPaySDKError } from './errors.js';
import type { HttpClient } from './http/client.js';

function isSDKError(value: unknown): value is GoPaySDKError | GoPayHTTPError {
    return value instanceof GoPaySDKError || value instanceof GoPayHTTPError;
}

/**
 * Wraps an assembled API surface so every error its methods raise reaches
 * `config.onError`.
 *
 * Errors thrown *during* a request already pass through the HTTP client, but
 * argument validation and the mount-time guards run before any request is
 * issued, so they would otherwise reach the caller without the SDK ever
 * reporting them. That is most of the SDK's own error paths, and the half an
 * integrator's monitoring is least able to reconstruct on its own.
 *
 * Wrapping the assembled object — rather than every call site — keeps the
 * reporting in one place, so a module that grows a new guard is covered by
 * construction instead of by remembering.
 *
 * `emitError` only reports an error the first time it sees it, so a failure
 * already reported deeper down is not reported again here.
 */
export function reportErrors<T extends object>(client: HttpClient, api: T): T {
    const wrapped: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(api)) {
        if (typeof value !== 'function') {
            wrapped[key] = value;
            continue;
        }

        const method = value as (...args: unknown[]) => unknown;
        wrapped[key] = (...args: unknown[]): unknown => {
            let result: unknown;
            try {
                result = method(...args);
            } catch (error) {
                if (isSDKError(error)) {
                    client.emitError(error);
                }
                throw error;
            }

            // Rejections have to be caught separately — the try above is long
            // done by the time an async method fails.
            if (result instanceof Promise) {
                return result.catch((error: unknown) => {
                    if (isSDKError(error)) {
                        client.emitError(error);
                    }
                    throw error;
                });
            }

            return result;
        };
    }

    return wrapped as T;
}
