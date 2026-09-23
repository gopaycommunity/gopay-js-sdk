import type { CoreConfig } from '../config.js';
import {
    GoPayErrorCodes,
    GoPayHTTPError,
    GoPaySDKError,
    safeErrorLabel,
} from '../errors.js';
import {
    type ApiCallRecord,
    NO_TELEMETRY,
    nowMs,
    type Telemetry,
} from '../logging/telemetry.js';
import { createAuthHandler } from './auth-handler.js';
import { buildUrl, resolveBaseUrl } from './build-url.js';
import { SDK_ACCEPT_HEADER } from './constants.js';
import { normalizeEndpoint } from './endpoint.js';
import { parseBody } from './response.js';
import { createTokenStore, type StoredTokenPair } from './token-store.js';
import type { RequestOptions } from './types.js';

/**
 * Errors already handed to `onError`.
 *
 * One failure crosses several layers on its way out — `throwIfNotOk` reports an
 * HTTP error, the verb method's catch hands it to `handleError`, and the API
 * wrapper sees it again — and each layer would otherwise report it afresh.
 * Holding the errors weakly keeps the set from pinning them in memory.
 */
const reportedErrors = new WeakSet<GoPaySDKError | GoPayHTTPError>();

/**
 * Foreign errors get a fresh wrapper each time they are reported, so the
 * dedupe above cannot see them. Held weakly for the same reason.
 */
const wrappedForeignErrors = new WeakSet<object>();

/**
 * A short, safe description of something that is not one of our errors.
 *
 * Reads the shape Google Pay rejects with before falling back to the generic
 * ones. Kept to a code and a message — the telemetry layer sanitizes what it
 * sends, but there is no reason to hand it more than this in the first place.
 */
/** A code, not prose: uppercase, underscores, bounded. */
const FOREIGN_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;

/**
 * Describe something that is not one of our errors, without quoting it.
 *
 * Codes yes, prose no. `statusCode` is the shape Google Pay rejects with and
 * is a code like any other, so it is kept when it actually looks like one.
 * `statusMessage` and `message` are free text written by somebody else's
 * code, and the guarantee this SDK makes about what leaves the page is that
 * the only free text in it is text the SDK wrote itself — a guarantee that
 * has to hold at the call sites, not only in the scrubber downstream. The
 * original object stays on `cause` for anyone debugging locally.
 */
function describeForeign(error: unknown): string {
    if (typeof error !== 'object' || error === null) {
        return typeof error;
    }
    const { statusCode } = error as { statusCode?: unknown };
    if (typeof statusCode === 'string' && FOREIGN_CODE.test(statusCode)) {
        return statusCode;
    }
    return safeErrorLabel(error);
}

function reportOnce(
    config: CoreConfig,
    error: GoPaySDKError | GoPayHTTPError,
    telemetry: Telemetry,
    /**
     * False when the caller has already emitted an event that describes this
     * better than `SDK.<code>` can. The integrator still hears about it through
     * onError — only the operational event is suppressed, so the two do not
     * count the same occurrence twice.
     */
    emitTelemetry = true,
): void {
    if (reportedErrors.has(error)) {
        return;
    }
    reportedErrors.add(error);
    // Behind the same dedupe as onError, so one failure is one record however
    // many layers it crossed. HTTP errors are skipped on purpose — they already
    // left through apiCall carrying their real status.
    if (emitTelemetry && error instanceof GoPaySDKError) {
        telemetry.error(error);
    }
    // A throwing onError is the integrator's bug, and must not replace the
    // error the SDK was already reporting.
    //
    // `onError` is declared `=> void`, and TypeScript accepts an async function
    // wherever a void return is expected — so `async onError` type-checks, and a
    // handler that forwards to the integrator's own ingest (a network call, i.e.
    // the likely shape) rejects long after this block has exited. Unhandled,
    // that takes a Node process down with it. Promise.resolve covers the sync
    // and async shapes in one path; a synchronous throw still happens while the
    // argument is evaluated, so the try below keeps catching it.
    try {
        void Promise.resolve(config.onError?.(error)).catch(() => {});
    } catch {}
}

export function createHttpClient(
    config: CoreConfig,
    reAuthAction?: string,
    telemetry: Telemetry = NO_TELEMETRY,
) {
    /**
     * Records the call whichever way it ends. `finally` rather than two call
     * sites because a request that throws is the one most worth having timed,
     * and `status` stays null when the request never produced a response —
     * which is what tells a timeout apart from a 500.
     */
    function record(
        method: string,
        path: string,
        started: number,
        statusCode: number | null,
    ): void {
        const rec: ApiCallRecord = {
            method,
            endpoint: normalizeEndpoint(path),
            statusCode,
            durationMs: Math.round(nowMs() - started),
        };
        telemetry.apiCall(rec);
    }

    // resolveBaseUrl validates config.baseUrl and throws on a bad one. It runs
    // before emitError exists, so it reports through reportOnce directly —
    // otherwise the one error guaranteed to happen at construction time is the
    // one error onError never sees.
    let baseUrl: string;
    try {
        baseUrl = resolveBaseUrl(config);
    } catch (err) {
        if (err instanceof GoPaySDKError || err instanceof GoPayHTTPError) {
            reportOnce(config, err, telemetry);
        }
        throw err;
    }
    const tokenStore = createTokenStore();
    let shareableKey: string | undefined = config.shareableKey;
    const auth = createAuthHandler({
        store: tokenStore,
        baseUrl,
        emitError: (e) => emitError(e),
        getTimeoutMs: () => timeoutMs(),
        debugLogResponse: (r) => debugLogResponse(r),
        recordApiCall: record,
        getShareableKey: () => shareableKey,
        getClientId: () => tokenStore.getClientId(),
        reAuthAction,
    });

    function timeoutMs(): number {
        return config.requestTimeoutMs ?? 10_000;
    }

    function debugLogRequest(method: string, url: string): void {
        if (config.debugLoggingEnabled) {
            console.debug('[GoPaySDK] →', method, url);
        }
    }

    function debugLogResponse(response: Response): void {
        if (config.debugLoggingEnabled) {
            console.debug('[GoPaySDK] ←', response.status, response.url);
        }
    }

    /**
     * Report without throwing — for failures delivered by rejecting a promise
     * rather than by throwing, where there is no throw for emitError to do.
     * Ignores anything that is not an SDK error, so callers can hand it a bare
     * rejection reason.
     */
    function reportError(
        error: unknown,
        options?: { telemetry?: boolean },
    ): void {
        const emitTelemetry = options?.telemetry !== false;
        if (error instanceof GoPaySDKError || error instanceof GoPayHTTPError) {
            reportOnce(config, error, telemetry, emitTelemetry);
            return;
        }

        // Everything else used to be dropped here, in silence. That is not a
        // rare shape: a wallet SDK throws a bare TypeError, and Google Pay
        // rejects with a plain `{statusCode, statusMessage}` object that is
        // not an Error at all — so its most common real failures
        // (DEVELOPER_ERROR, MERCHANT_ACCOUNT_ERROR) reached neither onError
        // nor any event. A backstop rather than the main fix: callers that
        // know what they are reporting should name a real error code, and the
        // wallets now do. This is what catches the ones that do not.
        if (typeof error === 'object' && error !== null) {
            if (wrappedForeignErrors.has(error)) {
                return;
            }
            wrappedForeignErrors.add(error);
        }
        // No errorCode: the core cannot know which subsystem this came from,
        // and inventing one would be worse than admitting it. Telemetry maps a
        // missing code to `SDK.UNKNOWN`, which is exactly what this is.
        reportOnce(
            config,
            new GoPaySDKError(
                `[GoPaySDK] Unhandled failure: ${describeForeign(error)}`,
                { cause: error },
            ),
            telemetry,
        );
    }

    function emitError<E extends GoPaySDKError | GoPayHTTPError>(
        error: E,
    ): never {
        reportOnce(config, error, telemetry);
        throw error;
    }

    function handleError(err: unknown): never {
        // Report before rethrowing. These arrive already typed — either from
        // throwIfNotOk, which has reported them, or from a validator such as
        // buildUrl, which has not. reportOnce tells the two apart, so the
        // second case stops being invisible without the first firing twice.
        if (err instanceof GoPaySDKError) {
            emitError(err);
        }
        if (err instanceof GoPayHTTPError) {
            emitError(err);
        }

        if (err instanceof Error && err.name === 'TimeoutError') {
            return emitError(
                new GoPaySDKError('[GoPaySDK] Request timed out.', {
                    errorCode: GoPayErrorCodes.NETWORK_TIMEOUT,
                }),
            );
        }

        if (err instanceof Error) {
            return emitError(
                // The label, never the message: a network error raised by
                // the host carries text nobody here wrote, and it would go
                // straight out through telemetry.error. `cause` keeps the
                // original for a developer with a console open.
                new GoPaySDKError(
                    `[GoPaySDK] Network error (${safeErrorLabel(err)}).`,
                    {
                        cause: err,
                        errorCode: GoPayErrorCodes.NETWORK_ERROR,
                    },
                ),
            );
        }

        throw err;
    }

    async function throwIfNotOk(
        response: Response,
        method: string,
        path: string,
    ): Promise<void> {
        if (response.ok) {
            return;
        }
        const body = await parseBody(response);
        emitError(
            new GoPayHTTPError(response.status, body, {
                method,
                endpoint: normalizeEndpoint(path),
            }),
        );
    }

    return {
        baseUrl,
        tokenStore,

        setToken(pair: Omit<StoredTokenPair, 'issued_at'>): void {
            tokenStore.set(pair);
        },

        setClientId(clientId: string): void {
            tokenStore.setClientId(clientId);
        },

        setClientCredentials(
            clientId: string,
            clientSecret: string,
            scope?: string,
        ): void {
            tokenStore.setClientSecret(clientId, clientSecret, scope);
        },

        getClientId(): string | null {
            return tokenStore.getClientId();
        },

        getShareableKey(): string | undefined {
            return shareableKey;
        },

        setShareableKey(key: string): void {
            shareableKey = key;
        },

        getClientCredentials(): {
            clientId: string;
            clientSecret: string;
        } | null {
            const clientId = tokenStore.getClientId();
            const clientSecret = tokenStore.getClientSecret();
            if (!clientId || !clientSecret) {
                return null;
            }
            return { clientId, clientSecret };
        },

        isAuthenticated(): boolean {
            return tokenStore.hasAccessToken();
        },

        getTokens(): StoredTokenPair | null {
            return tokenStore.get();
        },

        getEnvironment(): NonNullable<CoreConfig['environment']> {
            return config.environment ?? 'sandbox';
        },

        clearTokens(): void {
            tokenStore.clear();
        },

        emitError,
        reportError,

        /**
         * For the requests that deliberately bypass this client and would
         * otherwise be the SDK's only untimed traffic — today
         * `fetchBrowserData`, which cannot use the verb methods because their
         * 401 handling would clear the token store mid-charge.
         */
        recordApiCall: record,

        async get<T>(path: string, options?: RequestOptions): Promise<T> {
            const started = nowMs();
            let status: number | null = null;
            // Only a call that actually went out gets a record. Without
            // this the `finally` also fires for a failure that happened
            // before the request — a missing token, a bad path — and
            // reports it as `status_code: null`, which downstream means
            // "issued, no response": a phantom network error on an
            // endpoint nothing ever called, next to the SDK.<CODE> event
            // that already described the same failure correctly.
            let issued = false;
            try {
                const url = buildUrl(baseUrl, path);
                const headers = new Headers({ Accept: SDK_ACCEPT_HEADER });
                await auth.injectAuth(headers, url, options);
                debugLogRequest('GET', url);
                issued = true;
                const response = await auth.fetchAndHandle401(
                    url,
                    { method: 'GET', headers },
                    options?.signal,
                );
                status = response.status;
                await throwIfNotOk(response, 'GET', path);
                return (await response.json()) as T;
            } catch (err) {
                return handleError(err);
            } finally {
                if (issued) {
                    record('GET', path, started, status);
                }
            }
        },

        async post<T>(
            path: string,
            body?: unknown,
            options?: RequestOptions,
        ): Promise<T> {
            const started = nowMs();
            let status: number | null = null;
            // Only a call that actually went out gets a record. Without
            // this the `finally` also fires for a failure that happened
            // before the request — a missing token, a bad path — and
            // reports it as `status_code: null`, which downstream means
            // "issued, no response": a phantom network error on an
            // endpoint nothing ever called, next to the SDK.<CODE> event
            // that already described the same failure correctly.
            let issued = false;
            try {
                const url = buildUrl(baseUrl, path);
                const headers = new Headers({
                    Accept: SDK_ACCEPT_HEADER,
                    'Content-Type': 'application/json',
                });
                await auth.injectAuth(headers, url, options);
                debugLogRequest('POST', url);
                issued = true;
                const response = await auth.fetchAndHandle401(
                    url,
                    { method: 'POST', headers, body: JSON.stringify(body) },
                    options?.signal,
                );
                status = response.status;
                await throwIfNotOk(response, 'POST', path);
                return (await response.json()) as T;
            } catch (err) {
                return handleError(err);
            } finally {
                if (issued) {
                    record('POST', path, started, status);
                }
            }
        },

        async delete(path: string, options?: RequestOptions): Promise<void> {
            const started = nowMs();
            let status: number | null = null;
            // Only a call that actually went out gets a record. Without
            // this the `finally` also fires for a failure that happened
            // before the request — a missing token, a bad path — and
            // reports it as `status_code: null`, which downstream means
            // "issued, no response": a phantom network error on an
            // endpoint nothing ever called, next to the SDK.<CODE> event
            // that already described the same failure correctly.
            let issued = false;
            try {
                const url = buildUrl(baseUrl, path);
                const headers = new Headers();
                await auth.injectAuth(headers, url, options);
                debugLogRequest('DELETE', url);
                issued = true;
                const response = await auth.fetchAndHandle401(
                    url,
                    { method: 'DELETE', headers },
                    options?.signal,
                );
                status = response.status;
                await throwIfNotOk(response, 'DELETE', path);
            } catch (err) {
                return handleError(err);
            } finally {
                if (issued) {
                    record('DELETE', path, started, status);
                }
            }
        },

        async postForm<T>(
            path: string,
            form: Record<string, string>,
            options?: RequestOptions,
        ): Promise<T> {
            const started = nowMs();
            let status: number | null = null;
            // Only a call that actually went out gets a record. Without
            // this the `finally` also fires for a failure that happened
            // before the request — a missing token, a bad path — and
            // reports it as `status_code: null`, which downstream means
            // "issued, no response": a phantom network error on an
            // endpoint nothing ever called, next to the SDK.<CODE> event
            // that already described the same failure correctly.
            let issued = false;
            try {
                const url = buildUrl(baseUrl, path);
                const headers = new Headers({
                    'Content-Type': 'application/x-www-form-urlencoded',
                    Accept: SDK_ACCEPT_HEADER,
                });
                if (options?.headers) {
                    for (const [k, v] of Object.entries(options.headers)) {
                        headers.set(k, v);
                    }
                }
                await auth.injectAuth(headers, url, options);
                debugLogRequest('POST', url);
                issued = true;
                const bodyStr = new URLSearchParams(form).toString();
                const response = await fetch(
                    new Request(url, {
                        method: 'POST',
                        headers,
                        body: bodyStr,
                        signal: options?.signal
                            ? AbortSignal.any([
                                  options.signal,
                                  AbortSignal.timeout(timeoutMs()),
                              ])
                            : AbortSignal.timeout(timeoutMs()),
                    }),
                );
                debugLogResponse(response);
                status = response.status;
                await throwIfNotOk(response, 'POST', path);
                return (await response.json()) as T;
            } catch (err) {
                return handleError(err);
            } finally {
                if (issued) {
                    record('POST', path, started, status);
                }
            }
        },
    };
}

export type HttpClient = ReturnType<typeof createHttpClient>;
