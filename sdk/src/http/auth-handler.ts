import { GoPayErrorCodes, GoPayHTTPError, GoPaySDKError } from '../errors.js';
import { buildUrl } from './build-url.js';
import { fetchWithRetry } from './fetch-with-retry.js';
import { parseBody } from './response.js';
import type { StoredTokenPair, TokenStore } from './token-store.js';
import type { RequestOptions } from './types.js';

const AUTH_PATH = '/oauth2/token';

interface AuthHandlerDeps {
    store: TokenStore;
    baseUrl: string;
    emitError: <E extends GoPaySDKError | GoPayHTTPError>(error: E) => never;
    getTimeoutMs: () => number;
    debugLogResponse: (response: Response) => void;
}

export class AuthHandler {
    private refreshPromise: Promise<void> | null = null;

    constructor(private readonly deps: AuthHandlerDeps) {}

    // -------------------------------------------------------------------------
    // Auth injection
    // -------------------------------------------------------------------------

    /** Merges extra headers and injects Authorization — skipped for AUTH_PATH or when already set. */
    async injectAuth(
        headers: Headers,
        url: string,
        options?: RequestOptions,
    ): Promise<void> {
        // Always merge caller-supplied extra headers first
        if (options?.headers) {
            for (const [k, v] of Object.entries(options.headers)) {
                headers.set(k, v);
            }
        }

        if (url.includes(AUTH_PATH)) return;
        if (headers.has('Authorization')) return;

        if (options?.accessToken) {
            headers.set('Authorization', `Bearer ${options.accessToken}`);
            return;
        }

        if (this.deps.store.isExpiringSoon()) {
            await this.refresh();
        }

        const tokens = this.deps.store.get();
        if (!tokens) {
            this.deps.emitError(
                new GoPaySDKError(
                    '[GoPaySDK] No access token available. Call authenticate() first.',
                    { errorCode: GoPayErrorCodes.AUTH_TOKEN_MISSING },
                ),
            );
        }
        headers.set('Authorization', `Bearer ${tokens.access_token}`);
    }

    // -------------------------------------------------------------------------
    // Request execution with 401 retry
    // -------------------------------------------------------------------------

    /**
     * Executes the request via fetchWithRetry. On 401 (non-auth path), refreshes
     * the token and retries once with bare fetch to avoid an infinite loop.
     */
    async fetchAndHandle401(
        url: string,
        init: Omit<RequestInit, 'signal'> & { headers: Headers },
    ): Promise<Response> {
        const { getTimeoutMs, debugLogResponse, store, emitError } = this.deps;
        const timeoutMs = getTimeoutMs();

        let response = await fetchWithRetry(url, init, timeoutMs);
        debugLogResponse(response);

        if (response.status !== 401 || url.includes(AUTH_PATH)) {
            return response;
        }

        await this.refresh();

        const fresh = store.get() as StoredTokenPair;
        const retryHeaders = new Headers(init.headers);
        retryHeaders.set('Authorization', `Bearer ${fresh.access_token}`);

        response = await fetch(
            new Request(url, {
                ...init,
                headers: retryHeaders,
                signal: AbortSignal.timeout(timeoutMs),
            }),
        );
        debugLogResponse(response);

        if (response.status === 401) {
            store.clear();
            emitError(
                new GoPaySDKError(
                    '[GoPaySDK] Request unauthorized after token refresh. Check OAuth2 scopes.',
                    { errorCode: GoPayErrorCodes.AUTH_UNAUTHORIZED },
                ),
            );
        }

        return response;
    }

    // -------------------------------------------------------------------------
    // Token refresh (deduplicated)
    // -------------------------------------------------------------------------

    /** Triggers a token refresh, coalescing concurrent calls into one request. */
    async refresh(): Promise<void> {
        if (this.refreshPromise) return this.refreshPromise;
        this.refreshPromise = this.doRefresh().finally(() => {
            this.refreshPromise = null;
        });
        return this.refreshPromise;
    }

    private async doRefresh(): Promise<void> {
        const { store, baseUrl, emitError, getTimeoutMs } = this.deps;

        const refreshToken = store.getRefreshToken();
        if (!refreshToken) {
            store.clear();
            return emitError(
                new GoPaySDKError(
                    '[GoPaySDK] Session expired and no refresh token available. Call authenticate() or setClientToken() again.',
                    { errorCode: GoPayErrorCodes.AUTH_REFRESH_TOKEN_MISSING },
                ),
            );
        }

        try {
            const url = buildUrl(baseUrl, AUTH_PATH);
            const form: Record<string, string> = {
                grant_type: 'refresh_token',
                refresh_token: refreshToken,
            };
            const headers = new Headers({
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'application/json',
            });
            const clientId = store.getClientId();
            const clientSecret = store.getClientSecret();
            if (clientId && clientSecret) {
                const credentials = globalThis.btoa(
                    `${clientId}:${clientSecret}`,
                );
                headers.set('Authorization', `Basic ${credentials}`);
            } else if (clientId) {
                form.client_id = clientId;
            }

            const response = await fetch(
                new Request(url, {
                    method: 'POST',
                    headers,
                    body: new URLSearchParams(form).toString(),
                    signal: AbortSignal.timeout(getTimeoutMs()),
                }),
            );
            if (!response.ok) {
                throw new GoPayHTTPError(
                    response.status,
                    await parseBody(response),
                );
            }
            const fresh = (await response.json()) as Omit<
                StoredTokenPair,
                'issued_at'
            >;
            store.set(fresh);
        } catch (cause) {
            store.clear();
            emitError(
                new GoPaySDKError(
                    '[GoPaySDK] Token refresh failed. Call authenticate() again.',
                    { cause, errorCode: GoPayErrorCodes.AUTH_REFRESH_FAILED },
                ),
            );
        }
    }
}
