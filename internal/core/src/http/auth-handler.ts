import { GoPayErrorCodes, GoPayHTTPError, GoPaySDKError } from '../errors.js';
import { buildUrl } from './build-url.js';
import { fetchWithRetry } from './fetch-with-retry.js';
import { parseBody } from './response.js';
import type { TokenStore } from './token-store.js';
import type { RequestOptions } from './types.js';

const AUTH_PATH = '/oauth2/token';

interface AuthHandlerDeps {
    store: TokenStore;
    baseUrl: string;
    emitError: <E extends GoPaySDKError | GoPayHTTPError>(error: E) => never;
    getTimeoutMs: () => number;
    debugLogResponse: (response: Response) => void;
    getPublishableKey?: () => string | undefined;
    getClientId?: () => string | null;
    /** Appended to auth error messages to tell the caller how to recover. */
    reAuthAction?: string;
}

export function createAuthHandler(deps: AuthHandlerDeps) {
    const reAuth = deps.reAuthAction ?? 'Call authenticate() again.';
    let refreshPromise: Promise<void> | null = null;

    async function injectAuth(
        headers: Headers,
        url: string,
        options?: RequestOptions,
    ): Promise<void> {
        if (options?.headers) {
            for (const [k, v] of Object.entries(options.headers)) {
                headers.set(k, v);
            }
        }

        if (url.includes(AUTH_PATH)) {
            return;
        }
        if (headers.has('Authorization')) {
            return;
        }

        if (options?.accessToken) {
            headers.set('Authorization', `Bearer ${options.accessToken}`);
            return;
        }

        if (deps.store.isExpiringSoon()) {
            await refresh();
        }

        const tokens = deps.store.get();
        if (!tokens) {
            const publishableKey = deps.getPublishableKey?.();
            if (publishableKey) {
                const clientId = deps.getClientId?.();
                const credentials = clientId
                    ? globalThis.btoa(`${clientId}:${publishableKey}`)
                    : globalThis.btoa(`:${publishableKey}`);
                headers.set('Authorization', `Basic ${credentials}`);
                return;
            }
            deps.emitError(
                new GoPaySDKError(
                    `[GoPaySDK] No access token available. ${reAuth}`,
                    { errorCode: GoPayErrorCodes.AUTH_TOKEN_MISSING },
                ),
            );
        }
        headers.set('Authorization', `Bearer ${tokens.access_token}`);
    }

    async function fetchAndHandle401(
        url: string,
        init: Omit<RequestInit, 'signal'> & { headers: Headers },
    ): Promise<Response> {
        const { getTimeoutMs, debugLogResponse, store, emitError } = deps;
        const timeoutMs = getTimeoutMs();

        let response = await fetchWithRetry(url, init, timeoutMs);
        debugLogResponse(response);

        if (response.status !== 401 || url.includes(AUTH_PATH)) {
            return response;
        }

        await refresh();

        const fresh = store.get();
        if (!fresh) {
            return response;
        }
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

    async function refresh(): Promise<void> {
        if (refreshPromise) {
            return refreshPromise;
        }
        refreshPromise = doRefresh().finally(() => {
            refreshPromise = null;
        });
        return refreshPromise;
    }

    async function doRefresh(): Promise<void> {
        const { store, baseUrl, emitError, getTimeoutMs } = deps;

        const refreshToken = store.getRefreshToken();
        if (!refreshToken) {
            store.clear();
            return emitError(
                new GoPaySDKError(
                    `[GoPaySDK] Session expired and no refresh token available. ${reAuth}`,
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
            const body = (await response.json()) as Record<string, unknown>;
            const { access_token, expires_in } = body;
            if (
                typeof access_token !== 'string' ||
                !access_token ||
                typeof expires_in !== 'number'
            ) {
                throw new GoPaySDKError(
                    '[GoPaySDK] Invalid token response: missing required fields.',
                    { errorCode: GoPayErrorCodes.AUTH_INVALID_RESPONSE },
                );
            }
            store.set({
                access_token,
                expires_in,
                refresh_token:
                    typeof body.refresh_token === 'string'
                        ? body.refresh_token
                        : '',
                refresh_expires_in:
                    typeof body.refresh_expires_in === 'number'
                        ? body.refresh_expires_in
                        : 0,
                token_type: 'bearer',
            });
        } catch (cause) {
            store.clear();
            emitError(
                new GoPaySDKError(
                    `[GoPaySDK] Token refresh failed. ${reAuth}`,
                    { cause, errorCode: GoPayErrorCodes.AUTH_REFRESH_FAILED },
                ),
            );
        }
    }

    return { injectAuth, fetchAndHandle401, refresh };
}
