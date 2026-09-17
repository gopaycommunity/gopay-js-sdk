import type { HttpClient } from './http/client.js';

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
 * `reportError` only reports an error the first time it sees it, so a failure
 * already reported deeper down is not reported again here.
 *
 * **Only for objects whose properties are plain values and methods.**
 * `Object.entries` *evaluates* a getter, so wrapping an object that has one
 * replaces it with whatever it happened to return at wrap time. That rules out
 * `CardFormController`, whose `isValid` is a live getter and would freeze at its
 * mount-time `false`; the card form reports through `rejectResult` instead.
 */
export function reportErrors<T extends object>(client: HttpClient, api: T): T {
    const wrapped: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(api)) {
        if (typeof value !== 'function') {
            wrapped[key] = value;
            continue;
        }

        const method = value as (...args: unknown[]) => unknown;
        // A plain function rather than an arrow, and Reflect.apply rather than a
        // bare call, so a method invoked as `sdk.foo()` still receives a
        // receiver. Today's modules all close over `client` and ignore `this`,
        // but this is an exported generic and the next object through it need
        // not.
        wrapped[key] = function (this: unknown, ...args: unknown[]): unknown {
            let result: unknown;
            try {
                result = Reflect.apply(method, this, args);
            } catch (error) {
                client.reportError(error);
                throw error;
            }

            // Rejections have to be caught separately — the try above is long
            // done by the time an async method fails.
            if (result instanceof Promise) {
                return result.catch((error: unknown) => {
                    client.reportError(error);
                    throw error;
                });
            }

            return result;
        };
    }

    return wrapped as T;
}
