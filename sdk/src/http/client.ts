import type { GoPayConfig } from '../config.js';
import { GoPayErrorCodes, GoPayHTTPError, GoPaySDKError } from '../errors.js';
import { AuthHandler } from './auth-handler.js';
import { buildUrl, resolveBaseUrl } from './build-url.js';
import { parseBody } from './response.js';
import { type StoredTokenPair, TokenStore } from './token-store.js';
import type { RequestOptions } from './types.js';

export class HttpClient {
    readonly baseUrl: string;
    private readonly config: GoPayConfig;
    private readonly tokenStore: TokenStore;
    private readonly auth: AuthHandler;

    constructor(config: GoPayConfig) {
        this.config = config;
        this.baseUrl = resolveBaseUrl(config);
        this.tokenStore = new TokenStore();
        this.auth = new AuthHandler({
            store: this.tokenStore,
            baseUrl: this.baseUrl,
            emitError: (e) => this.emitError(e),
            getTimeoutMs: () => this.timeoutMs,
            debugLogResponse: (r) => this.debugLogResponse(r),
        });
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

    getClientId(): string | null {
        return this.tokenStore.getClientId();
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

    getTokens(): StoredTokenPair | null {
        return this.tokenStore.get();
    }

    getEnvironment(): NonNullable<GoPayConfig['environment']> {
        return this.config.environment ?? 'sandbox';
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
            const url = buildUrl(this.baseUrl, path);
            const headers = new Headers({ Accept: 'application/json' });
            await this.auth.injectAuth(headers, url, options);
            this.debugLogRequest('GET', url);
            const response = await this.auth.fetchAndHandle401(url, {
                method: 'GET',
                headers,
            });
            await this.throwIfNotOk(response);
            return response.json() as Promise<T>;
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
            const url = buildUrl(this.baseUrl, path);
            const headers = new Headers({
                Accept: 'application/json',
                'Content-Type': 'application/json',
            });
            await this.auth.injectAuth(headers, url, options);
            this.debugLogRequest('POST', url);
            const response = await this.auth.fetchAndHandle401(url, {
                method: 'POST',
                headers,
                body: JSON.stringify(body),
            });
            await this.throwIfNotOk(response);
            return response.json() as Promise<T>;
        } catch (err) {
            return this.handleError(err);
        }
    }

    async delete(path: string, options?: RequestOptions): Promise<void> {
        try {
            const url = buildUrl(this.baseUrl, path);
            const headers = new Headers();
            await this.auth.injectAuth(headers, url, options);
            this.debugLogRequest('DELETE', url);
            const response = await this.auth.fetchAndHandle401(url, {
                method: 'DELETE',
                headers,
            });
            await this.throwIfNotOk(response);
        } catch (err) {
            return this.handleError(err);
        }
    }

    async postForm<T>(
        path: string,
        form: Record<string, string>,
        options?: RequestOptions,
    ): Promise<T> {
        try {
            const url = buildUrl(this.baseUrl, path);
            const headers = new Headers({
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'application/json',
            });
            if (options?.headers) {
                for (const [k, v] of Object.entries(options.headers)) {
                    headers.set(k, v);
                }
            }
            // Inject Bearer for non-auth paths without an explicit Authorization header
            await this.auth.injectAuth(headers, url, options);
            this.debugLogRequest('POST', url);
            const body = new URLSearchParams(form).toString();
            // Token endpoints use bare fetch — no 5xx retry (not idempotent-safe)
            const response = await fetch(
                new Request(url, {
                    method: 'POST',
                    headers,
                    body,
                    signal: AbortSignal.timeout(this.timeoutMs),
                }),
            );
            this.debugLogResponse(response);
            await this.throwIfNotOk(response);
            return response.json() as Promise<T>;
        } catch (err) {
            return this.handleError(err);
        }
    }

    // -------------------------------------------------------------------------
    // URL construction
    // -------------------------------------------------------------------------

    protected buildUrl(path: string): string {
        return buildUrl(this.baseUrl, path);
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    private get timeoutMs(): number {
        return this.config.requestTimeoutMs ?? 10_000;
    }

    private handleError(err: unknown): never {
        // Already an SDK error — re-throw as-is
        // (onError was already called via emitError before the throw)
        if (err instanceof GoPaySDKError) throw err;
        if (err instanceof GoPayHTTPError) throw err;

        if (err instanceof Error && err.name === 'TimeoutError') {
            return this.emitError(
                new GoPaySDKError('[GoPaySDK] Request timed out.', {
                    errorCode: GoPayErrorCodes.NETWORK_TIMEOUT,
                }),
            );
        }

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

    private async throwIfNotOk(response: Response): Promise<void> {
        if (response.ok) return;
        const body = await parseBody(response);
        this.emitError(new GoPayHTTPError(response.status, body));
    }

    private debugLogRequest(method: string, url: string): void {
        if (this.config.debugLoggingEnabled) {
            console.debug('[GoPaySDK] →', method, url);
        }
    }

    private debugLogResponse(response: Response): void {
        if (this.config.debugLoggingEnabled) {
            console.debug('[GoPaySDK] ←', response.status, response.url);
        }
    }
}
