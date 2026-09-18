import type { CoreConfig } from '../config.js';
import { GoPayErrorCodes, GoPayHTTPError, GoPaySDKError } from '../errors.js';
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

function reportOnce(
    config: CoreConfig,
    error: GoPaySDKError | GoPayHTTPError,
    telemetry: Telemetry,
): void {
    if (reportedErrors.has(error)) {
        return;
    }
    reportedErrors.add(error);
    // Behind the same dedupe as onError, so one failure is one record however
    // many layers it crossed. HTTP errors are skipped on purpose — they already
    // left through apiCall carrying their real status.
    if (error instanceof GoPaySDKError) {
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
    function reportError(error: unknown): void {
        if (error instanceof GoPaySDKError || error instanceof GoPayHTTPError) {
            reportOnce(config, error, telemetry);
        }
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
                new GoPaySDKError(`[GoPaySDK] Network error: ${err.message}`, {
                    cause: err,
                    errorCode: GoPayErrorCodes.NETWORK_ERROR,
                }),
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

        async get<T>(path: string, options?: RequestOptions): Promise<T> {
            const started = nowMs();
            let status: number | null = null;
            try {
                const url = buildUrl(baseUrl, path);
                const headers = new Headers({ Accept: SDK_ACCEPT_HEADER });
                await auth.injectAuth(headers, url, options);
                debugLogRequest('GET', url);
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
                record('GET', path, started, status);
            }
        },

        async post<T>(
            path: string,
            body?: unknown,
            options?: RequestOptions,
        ): Promise<T> {
            const started = nowMs();
            let status: number | null = null;
            try {
                const url = buildUrl(baseUrl, path);
                const headers = new Headers({
                    Accept: SDK_ACCEPT_HEADER,
                    'Content-Type': 'application/json',
                });
                await auth.injectAuth(headers, url, options);
                debugLogRequest('POST', url);
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
                record('POST', path, started, status);
            }
        },

        async delete(path: string, options?: RequestOptions): Promise<void> {
            const started = nowMs();
            let status: number | null = null;
            try {
                const url = buildUrl(baseUrl, path);
                const headers = new Headers();
                await auth.injectAuth(headers, url, options);
                debugLogRequest('DELETE', url);
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
                record('DELETE', path, started, status);
            }
        },

        async postForm<T>(
            path: string,
            form: Record<string, string>,
            options?: RequestOptions,
        ): Promise<T> {
            const started = nowMs();
            let status: number | null = null;
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
                record('POST', path, started, status);
            }
        },
    };
}

export type HttpClient = ReturnType<typeof createHttpClient>;
