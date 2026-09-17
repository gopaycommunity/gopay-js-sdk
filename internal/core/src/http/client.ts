import type { CoreConfig } from '../config.js';
import { GoPayErrorCodes, GoPayHTTPError, GoPaySDKError } from '../errors.js';
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
): void {
    if (reportedErrors.has(error)) {
        return;
    }
    reportedErrors.add(error);
    // A throwing onError is the integrator's bug, and must not replace the
    // error the SDK was already reporting.
    try {
        config.onError?.(error);
    } catch {}
}

export function createHttpClient(config: CoreConfig, reAuthAction?: string) {
    // resolveBaseUrl validates config.baseUrl and throws on a bad one. It runs
    // before emitError exists, so it reports through reportOnce directly —
    // otherwise the one error guaranteed to happen at construction time is the
    // one error onError never sees.
    let baseUrl: string;
    try {
        baseUrl = resolveBaseUrl(config);
    } catch (err) {
        if (err instanceof GoPaySDKError || err instanceof GoPayHTTPError) {
            reportOnce(config, err);
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

    function emitError<E extends GoPaySDKError | GoPayHTTPError>(
        error: E,
    ): never {
        reportOnce(config, error);
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

        async get<T>(path: string, options?: RequestOptions): Promise<T> {
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
                await throwIfNotOk(response, 'GET', path);
                return (await response.json()) as T;
            } catch (err) {
                return handleError(err);
            }
        },

        async post<T>(
            path: string,
            body?: unknown,
            options?: RequestOptions,
        ): Promise<T> {
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
                await throwIfNotOk(response, 'POST', path);
                return (await response.json()) as T;
            } catch (err) {
                return handleError(err);
            }
        },

        async delete(path: string, options?: RequestOptions): Promise<void> {
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
                await throwIfNotOk(response, 'DELETE', path);
            } catch (err) {
                return handleError(err);
            }
        },

        async postForm<T>(
            path: string,
            form: Record<string, string>,
            options?: RequestOptions,
        ): Promise<T> {
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
                await throwIfNotOk(response, 'POST', path);
                return (await response.json()) as T;
            } catch (err) {
                return handleError(err);
            }
        },
    };
}

export type HttpClient = ReturnType<typeof createHttpClient>;
