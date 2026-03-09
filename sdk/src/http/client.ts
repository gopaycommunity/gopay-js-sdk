import ky, { type KyInstance, type Options as KyOptions } from 'ky';
import { BASE_URLS, type GoPayConfig } from '../config.js';
import { type StoredTokenPair, TokenStore } from './token-store.js';
import type { RequestOptions } from './types.js';

const AUTH_PATH = '/oauth2/token';

export class HttpClient {
    readonly baseUrl: string;
    readonly tokenStore: TokenStore;
    private readonly kyInstance: KyInstance;
    private refreshPromise: Promise<void> | null = null;

    constructor(config: GoPayConfig) {
        this.baseUrl =
            config.baseUrl ?? BASE_URLS[config.environment ?? 'sandbox'];
        this.tokenStore = new TokenStore();
        this.kyInstance = this.buildKyInstance();
    }

    async get<T>(path: string, options?: RequestOptions): Promise<T> {
        return this.kyInstance
            .get(this.buildUrl(path), this.kyOptions(options))
            .json<T>();
    }

    async post<T>(
        path: string,
        body?: unknown,
        options?: RequestOptions,
    ): Promise<T> {
        return this.kyInstance
            .post(this.buildUrl(path), {
                ...this.kyOptions(options),
                json: body,
            })
            .json<T>();
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
            if (err instanceof Error && 'response' in err) {
                const res = (err as { response: Response }).response;
                throw new Error(`HTTP ${res.status}: ${res.statusText}`);
            }
            throw err;
        }
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
            const tokens = this.tokenStore.get();
            if (!tokens?.refresh_token) {
                this.tokenStore.clear();
                throw new Error(
                    '[GoPaySDK] Session expired and no refresh token available. Call authenticate() again.',
                );
            }

            try {
                const fresh = await this.postForm<
                    Omit<StoredTokenPair, 'issued_at'>
                >(AUTH_PATH, {
                    grant_type: 'refresh_token',
                    refresh_token: tokens.refresh_token,
                });
                this.tokenStore.set(fresh);
            } catch {
                this.tokenStore.clear();
                throw new Error(
                    '[GoPaySDK] Token refresh failed. Call authenticate() again.',
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
                            throw new Error(
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
                            throw new Error(
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
