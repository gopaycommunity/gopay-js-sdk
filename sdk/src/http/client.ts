import ky, { type KyInstance, type Options as KyOptions } from 'ky';
import { BASE_URLS, type GoPayConfig } from '../config.js';
import { GoPayHTTPError, GoPaySDKError } from '../errors.js';
import { type StoredTokenPair, TokenStore } from './token-store.js';
import type { RequestOptions } from './types.js';

const AUTH_PATH = '/oauth2/token';

export class HttpClient {
    readonly baseUrl: string;
    private readonly tokenStore: TokenStore;
    private readonly kyInstance: KyInstance;
    private refreshPromise: Promise<void> | null = null;

    constructor(config: GoPayConfig) {
        this.baseUrl =
            config.baseUrl ?? BASE_URLS[config.environment ?? 'sandbox'];
        this.tokenStore = new TokenStore();
        this.kyInstance = this.buildKyInstance();
    }

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

    async get<T>(path: string, options?: RequestOptions): Promise<T> {
        try {
            return await this.kyInstance
                .get(this.buildUrl(path), this.kyOptions(options))
                .json<T>();
        } catch (err) {
            return this.throwHTTPError(err);
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
            return this.throwHTTPError(err);
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
            return this.throwHTTPError(err);
        }
    }

    private async throwHTTPError(err: unknown): Promise<never> {
        if (err instanceof Error && 'response' in err) {
            const res = (err as { response: Response }).response;
            const text = await res.text();
            let body: unknown;
            try {
                body = JSON.parse(text);
            } catch {
                body = text;
            }
            throw new GoPayHTTPError(res.status, body);
        }
        throw err;
    }

    protected buildUrl(path: string): string {
        const base = this.baseUrl.endsWith('/')
            ? this.baseUrl
            : `${this.baseUrl}/`;
        const relative = path.startsWith('/') ? path.slice(1) : path;
        return new URL(relative, base).toString();
    }

    private async refreshTokens(): Promise<void> {
        if (this.refreshPromise) return this.refreshPromise;

        this.refreshPromise = (async () => {
            const refreshToken = this.tokenStore.getRefreshToken();
            if (!refreshToken) {
                this.tokenStore.clear();
                throw new GoPaySDKError(
                    '[GoPaySDK] Session expired and no refresh token available. Call authenticate() or setClientToken() again.',
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
                throw new GoPaySDKError(
                    '[GoPaySDK] Token refresh failed. Call authenticate() again.',
                    { cause },
                );
            }
        })().finally(() => {
            this.refreshPromise = null;
        });

        return this.refreshPromise;
    }

    private buildKyInstance(): KyInstance {
        return ky.create({
            retry: 0,
            hooks: {
                beforeRequest: [
                    async (request) => {
                        if (request.url.includes(AUTH_PATH)) return;
                        if (request.headers.has('Authorization')) return;

                        if (this.tokenStore.isExpiringSoon()) {
                            await this.refreshTokens();
                        }

                        const tokens = this.tokenStore.get();
                        if (!tokens) {
                            throw new GoPaySDKError(
                                '[GoPaySDK] No access token available. Call authenticate() first.',
                            );
                        }
                        request.headers.set(
                            'Authorization',
                            `Bearer ${tokens.access_token}`,
                        );
                    },
                ],
                afterResponse: [
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
                            throw new GoPaySDKError(
                                '[GoPaySDK] Request unauthorized after token refresh. Check OAuth2 scopes.',
                            );
                        }

                        return retryResponse;
                    },
                ],
            },
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
