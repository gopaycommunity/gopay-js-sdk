import ky, { type KyInstance, type Options as KyOptions } from 'ky';
import { BASE_URLS, type GoPayConfig } from '../config.js';
import { GoPayErrorCodes, GoPayHTTPError, GoPaySDKError } from '../errors.js';
import { type StoredTokenPair, TokenStore } from './token-store.js';
import type { RequestOptions } from './types.js';

const AUTH_PATH = '/oauth2/token';

export class HttpClient {
    readonly baseUrl: string;
    private readonly config: GoPayConfig;
    private readonly tokenStore: TokenStore;
    private readonly kyInstance: KyInstance;
    private refreshPromise: Promise<void> | null = null;

    constructor(config: GoPayConfig) {
        this.config = config;
        this.baseUrl =
            config.baseUrl ?? BASE_URLS[config.environment ?? 'sandbox'];
        this.tokenStore = new TokenStore();
        this.kyInstance = this.buildKyInstance();
    }

    // -------------------------------------------------------------------------
    // Token / credential accessors (used by AuthModule)
    // -------------------------------------------------------------------------

    setToken(pair: Omit<StoredTokenPair, 'issued_at'>): void {
        this.tokenStore.set(pair);
    }

    setClientId(clientId: string): void {
        this.tokenStore.setClientId(clientId);
    }

    setClientCredentials(clientId: string, clientSecret: string): void {
        this.tokenStore.setClientSecret(clientId, clientSecret);
    }

    getClientCredentials(): { clientId: string; clientSecret: string } | null {
        const clientId = this.tokenStore.getClientId();
        const clientSecret = this.tokenStore.getClientSecret();
        if (!clientId || !clientSecret) return null;
        return { clientId, clientSecret };
    }

    isAuthenticated(): boolean {
        return this.tokenStore.hasAccessToken();
    }

    clearTokens(): void {
        this.tokenStore.clear();
    }

    // -------------------------------------------------------------------------
    // Error emission — calls onError callback then throws
    // -------------------------------------------------------------------------

    emitError<E extends GoPaySDKError | GoPayHTTPError>(error: E): never {
        this.config.onError?.(error);
        throw error;
    }

    // -------------------------------------------------------------------------
    // HTTP methods
    // -------------------------------------------------------------------------

    async get<T>(path: string, options?: RequestOptions): Promise<T> {
        try {
            return await this.kyInstance
                .get(this.buildUrl(path), this.kyOptions(options))
                .json<T>();
        } catch (err) {
            return this.handleError(err);
        }
    }

    async post<T>(
        path: string,
        body?: unknown,
        options?: RequestOptions,
    ): Promise<T> {
        try {
            return await this.kyInstance
                .post(this.buildUrl(path), {
                    ...this.kyOptions(options),
                    json: body,
                })
                .json<T>();
        } catch (err) {
            return this.handleError(err);
        }
    }

    async postForm<T>(
        path: string,
        form: Record<string, string>,
        options?: RequestOptions,
    ): Promise<T> {
        const url = this.buildUrl(path);
        const body = new URLSearchParams(form).toString();
        try {
            return await this.kyInstance
                .post(url, {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        Accept: 'application/json',
                        ...options?.headers,
                    },
                    body,
                    retry: 0,
                })
                .json<T>();
        } catch (err) {
            return this.handleError(err);
        }
    }

    // -------------------------------------------------------------------------
    // Error handling
    // -------------------------------------------------------------------------

    private async handleError(err: unknown): Promise<never> {
        // Already a GoPaySDKError (thrown by our own hooks) — re-throw as-is
        if (err instanceof GoPaySDKError) throw err;

        // Timeout
        if (err instanceof Error && err.name === 'TimeoutError') {
            return this.emitError(
                new GoPaySDKError('[GoPaySDK] Request timed out.', {
                    errorCode: GoPayErrorCodes.NETWORK_TIMEOUT,
                }),
            );
        }

        // HTTP error response
        if (err instanceof Error && 'response' in err) {
            const res = (err as { response: Response }).response;
            const text = await res.text();
            const contentType = res.headers.get('content-type') ?? '';
            let body: unknown;
            if (
                contentType.startsWith('application/json') ||
                contentType.includes('+json')
            ) {
                try {
                    body = JSON.parse(text);
                } catch {
                    body = text;
                }
            } else {
                body = text;
            }
            return this.emitError(new GoPayHTTPError(res.status, body));
        }

        // Network-level failure (fetch threw, no response)
        if (err instanceof Error) {
            return this.emitError(
                new GoPaySDKError(`[GoPaySDK] Network error: ${err.message}`, {
                    cause: err,
                    errorCode: GoPayErrorCodes.NETWORK_ERROR,
                }),
            );
        }

        throw err;
    }

    // -------------------------------------------------------------------------
    // URL construction
    // -------------------------------------------------------------------------

    protected buildUrl(path: string): string {
        const base = this.baseUrl.endsWith('/')
            ? this.baseUrl
            : `${this.baseUrl}/`;
        const relative = path.startsWith('/') ? path.slice(1) : path;
        return new URL(relative, base).toString();
    }

    // -------------------------------------------------------------------------
    // Token refresh
    // -------------------------------------------------------------------------

    private async refreshTokens(): Promise<void> {
        if (this.refreshPromise) return this.refreshPromise;

        this.refreshPromise = (async () => {
            const refreshToken = this.tokenStore.getRefreshToken();
            if (!refreshToken) {
                this.tokenStore.clear();
                this.emitError(
                    new GoPaySDKError(
                        '[GoPaySDK] Session expired and no refresh token available. Call authenticate() or setClientToken() again.',
                        {
                            errorCode:
                                GoPayErrorCodes.AUTH_REFRESH_TOKEN_MISSING,
                        },
                    ),
                );
            }

            try {
                const form: Record<string, string> = {
                    grant_type: 'refresh_token',
                    refresh_token: refreshToken,
                };
                const headers: Record<string, string> = {};
                const clientId = this.tokenStore.getClientId();
                const clientSecret = this.tokenStore.getClientSecret();
                if (clientId && clientSecret) {
                    const credentials = globalThis.btoa(
                        `${clientId}:${clientSecret}`,
                    );
                    headers.Authorization = `Basic ${credentials}`;
                } else if (clientId) {
                    form.client_id = clientId;
                }
                const fresh = await this.postForm<
                    Omit<StoredTokenPair, 'issued_at'>
                >(AUTH_PATH, form, { headers });
                this.tokenStore.set(fresh);
            } catch (cause) {
                this.tokenStore.clear();
                this.emitError(
                    new GoPaySDKError(
                        '[GoPaySDK] Token refresh failed. Call authenticate() again.',
                        {
                            cause,
                            errorCode: GoPayErrorCodes.AUTH_REFRESH_FAILED,
                        },
                    ),
                );
            }
        })().finally(() => {
            this.refreshPromise = null;
        });

        return this.refreshPromise;
    }

    // -------------------------------------------------------------------------
    // ky instance
    // -------------------------------------------------------------------------

    private buildKyInstance(): KyInstance {
        const beforeRequest: NonNullable<KyOptions['hooks']>['beforeRequest'] =
            [
                async (request) => {
                    if (request.url.includes(AUTH_PATH)) return;
                    if (request.headers.has('Authorization')) return;

                    if (this.tokenStore.isExpiringSoon()) {
                        await this.refreshTokens();
                    }

                    const tokens = this.tokenStore.get();
                    if (!tokens) {
                        this.emitError(
                            new GoPaySDKError(
                                '[GoPaySDK] No access token available. Call authenticate() first.',
                                {
                                    errorCode:
                                        GoPayErrorCodes.AUTH_TOKEN_MISSING,
                                },
                            ),
                        );
                    }
                    request.headers.set(
                        'Authorization',
                        `Bearer ${tokens.access_token}`,
                    );
                },
            ];

        const afterResponse: NonNullable<KyOptions['hooks']>['afterResponse'] =
            [
                async (request, _options, response) => {
                    if (
                        response.status !== 401 ||
                        request.url.includes(AUTH_PATH)
                    ) {
                        return response;
                    }

                    await this.refreshTokens();

                    // Retry with bare fetch — bypasses ky hooks, no infinite loop
                    const fresh = this.tokenStore.get() as StoredTokenPair;
                    const retryRequest = request.clone();
                    retryRequest.headers.set(
                        'Authorization',
                        `Bearer ${fresh.access_token}`,
                    );
                    const retryResponse = await fetch(retryRequest);

                    if (retryResponse.status === 401) {
                        this.tokenStore.clear();
                        this.emitError(
                            new GoPaySDKError(
                                '[GoPaySDK] Request unauthorized after token refresh. Check OAuth2 scopes.',
                                {
                                    errorCode:
                                        GoPayErrorCodes.AUTH_UNAUTHORIZED,
                                },
                            ),
                        );
                    }

                    return retryResponse;
                },
            ];

        if (this.config.debugLoggingEnabled) {
            beforeRequest.push((request) => {
                console.debug('[GoPaySDK] →', request.method, request.url);
            });
            afterResponse.push((_req, _opts, response) => {
                console.debug('[GoPaySDK] ←', response.status, response.url);
                return response;
            });
        }

        return ky.create({
            retry: 0,
            timeout: this.config.requestTimeoutMs ?? 10_000,
            hooks: { beforeRequest, afterResponse },
        });
    }

    private kyOptions(options?: RequestOptions): KyOptions {
        const headers: Record<string, string> = { ...options?.headers };
        if (options?.accessToken) {
            headers.Authorization = `Bearer ${options.accessToken}`;
        }
        return { headers };
    }
}
