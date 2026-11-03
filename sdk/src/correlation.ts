import type { AsyncLocalStorage } from 'node:async_hooks';
import { GoPayErrorCodes, GoPaySDKError } from '@gopay-internal/core';
import { SDK_VERSION } from './version.js';

/** What gp-main accepts as a transaction id; anything else would be dropped from its log. */
const TRANSACTION_ID = /^[A-Za-z0-9._-]{1,64}$/;
/** Printable ASCII: a header value cannot carry anything else. */
const USER_AGENT_SUFFIX = /^[\x20-\x7E]{1,200}$/;

export function userAgentFor(suffix: string | undefined): string {
    const base = `GoPay JS v4 ${SDK_VERSION}`;
    if (suffix === undefined) {
        return base;
    }
    const trimmed = suffix.trim();
    if (!USER_AGENT_SUFFIX.test(trimmed)) {
        throw new GoPaySDKError(
            '[GoPaySDK] config.userAgentSuffix must be 1–200 printable ASCII characters',
            { errorCode: GoPayErrorCodes.INVALID_CONFIG },
        );
    }
    return `${base} ${trimmed}`;
}

type Scope = { transactionId: string };

// Taken from the process rather than imported, so that `node:` stays out of a browser bundle
// (the example app runs this SDK in a page). Node 20.12–20.15 lacks getBuiltinModule; there
// every request gets an id of its own.
const asyncHooks = (
    globalThis as {
        process?: { getBuiltinModule?: (id: string) => unknown };
    }
).process?.getBuiltinModule?.('node:async_hooks') as
    | { AsyncLocalStorage: typeof AsyncLocalStorage }
    | undefined;

/** A real async generator — the SDK's own iterateEvents — not any object that can be iterated. */
function isAsyncGenerator(value: unknown): value is AsyncGenerator<unknown> {
    return Object.prototype.toString.call(value) === '[object AsyncGenerator]';
}

/**
 * One transaction id per public SDK call, shared by every request it makes — the token
 * refresh, retries and the polls of an await* method — so the gateway's log groups them.
 */
export function createTransactions(report: (error: GoPaySDKError) => void) {
    const storage = asyncHooks
        ? new asyncHooks.AsyncLocalStorage<Scope>()
        : undefined;

    /** Runs an SDK method in `scope`; a generator it returns keeps the scope on each step. */
    function inScope(scope: Scope, call: () => unknown): unknown {
        if (!storage) {
            return call();
        }
        const result = storage.run(scope, call);
        if (!isAsyncGenerator(result)) {
            return result;
        }
        // A generator's body runs on each next(), outside the call that created it.
        const bound: AsyncGenerator<unknown> = {
            next: (...args) => storage.run(scope, () => result.next(...args)),
            return: (value) => storage.run(scope, () => result.return(value)),
            throw: (error) => storage.run(scope, () => result.throw(error)),
            [Symbol.asyncIterator]: () => bound,
            // Through return(): an async generator has no asyncDispose of its own before Node 24.
            [Symbol.asyncDispose]: async () => {
                await bound.return(undefined);
            },
        };
        return bound;
    }

    return {
        current(): string {
            return storage?.getStore()?.transactionId ?? crypto.randomUUID();
        },

        /** Wraps each method so a call runs in a transaction of its own, unless already in one. */
        bind<T extends object>(api: T): T {
            const bound: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(api)) {
                bound[key] =
                    typeof value === 'function'
                        ? function (this: unknown, ...args: unknown[]) {
                              const scope = storage?.getStore() ?? {
                                  transactionId: crypto.randomUUID(),
                              };
                              return inScope(scope, () =>
                                  Reflect.apply(value, this, args),
                              );
                          }
                        : value;
            }
            return bound as T;
        },

        /**
         * Run `fn` with SDK calls inside it sent under `transactionId` — your own request id,
         * say — instead of an id per call.
         */
        withTransactionId<T>(transactionId: string, fn: () => T): T {
            if (
                typeof transactionId !== 'string' ||
                !TRANSACTION_ID.test(transactionId)
            ) {
                const error = new GoPaySDKError(
                    '[GoPaySDK] transactionId must be 1–64 characters of A–Z, a–z, 0–9, ".", "_" or "-"',
                    { errorCode: GoPayErrorCodes.INVALID_ARGUMENT },
                );
                report(error);
                throw error;
            }
            if (!storage) {
                const error = new GoPaySDKError(
                    '[GoPaySDK] withTransactionId needs AsyncLocalStorage through process.getBuiltinModule (Node.js 20.16 or later)',
                    { errorCode: GoPayErrorCodes.INVALID_CONFIG },
                );
                report(error);
                throw error;
            }
            // fn's own result untouched: only the SDK's methods bind what they return.
            return storage.run({ transactionId }, fn);
        },
    };
}
