import type { CoreConfig } from '../config.js';
import { GoPayErrorCodes, GoPayHTTPError, GoPaySDKError } from '../errors.js';
import { createAuthHandler } from './auth-handler.js';
import { buildUrl, resolveBaseUrl } from './build-url.js';
import { parseBody } from './response.js';
import { createTokenStore, type StoredTokenPair } from './token-store.js';
import type { RequestOptions } from './types.js';

export function createHttpClient(config: CoreConfig, reAuthAction?: string) {
    const baseUrl = resolveBaseUrl(config);
    const tokenStore = createTokenStore();
    let publishableKey: string | undefined = config.publishableKey;
    const auth = createAuthHandler({
        store: tokenStore,
        baseUrl,
        emitError: (e) => emitError(e),
        getTimeoutMs: () => timeoutMs(),
        debugLogResponse: (r) => debugLogResponse(r),
        getPublishableKey: () => publishableKey,
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
        config.onError?.(error);
        throw error;
    }

    function handleError(err: unknown): never {
        if (err instanceof GoPaySDKError) {
            throw err;
        }
        if (err instanceof GoPayHTTPError) {
            throw err;
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

    async function throwIfNotOk(response: Response): Promise<void> {
        if (response.ok) {
            return;
        }
        const body = await parseBody(response);
        emitError(new GoPayHTTPError(response.status, body));
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

        getPublishableKey(): string | undefined {
            return publishableKey;
        },

        setPublishableKey(key: string): void {
            publishableKey = key;
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
                const headers = new Headers({ Accept: 'application/json' });
                await auth.injectAuth(headers, url, options);
                debugLogRequest('GET', url);
                const response = await auth.fetchAndHandle401(url, {
                    method: 'GET',
                    headers,
                });
                await throwIfNotOk(response);
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
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                });
                await auth.injectAuth(headers, url, options);
                debugLogRequest('POST', url);
                const response = await auth.fetchAndHandle401(url, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(body),
                });
                await throwIfNotOk(response);
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
                const response = await auth.fetchAndHandle401(url, {
                    method: 'DELETE',
                    headers,
                });
                await throwIfNotOk(response);
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
                    Accept: 'application/json',
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
                        signal: AbortSignal.timeout(timeoutMs()),
                    }),
                );
                debugLogResponse(response);
                await throwIfNotOk(response);
                return (await response.json()) as T;
            } catch (err) {
                return handleError(err);
            }
        },
    };
}

export type HttpClient = ReturnType<typeof createHttpClient>;
