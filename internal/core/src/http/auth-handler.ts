import { GoPayErrorCodes, GoPayHTTPError, GoPaySDKError } from '../errors.js';
import { nowMs } from '../logging/telemetry.js';
import { buildUrl } from './build-url.js';
import { SDK_ACCEPT_HEADER } from './constants.js';
import { fetchWithRetry } from './fetch-with-retry.js';
import { parseBody } from './response.js';
import type { PaymentCredentials, TokenStore } from './token-store.js';
import type { RequestOptions } from './types.js';

const AUTH_PATH = '/oauth2/token';

interface AuthHandlerDeps {
    store: TokenStore;
    baseUrl: string;
    emitError: <E extends GoPaySDKError | GoPayHTTPError>(error: E) => never;
    getTimeoutMs: () => number;
    debugLogResponse: (response: Response) => void;
    /**
     * Times the token fetch the same way the client does. The handler issues
     * it through raw `fetch`, outside any verb method, so without this it is
     * traffic the SDK makes that no event describes — which is how a re-auth
     * storm stays invisible.
     */
    recordApiCall: (
        method: string,
        path: string,
        started: number,
        statusCode: number | null,
    ) => void;
    getShareableKey?: () => string | undefined;
    getClientId?: () => string | null;
    /** Appended to auth error messages to tell the caller how to recover. */
    reAuthAction?: string;
}

export function createAuthHandler(deps: AuthHandlerDeps) {
    const reAuth = deps.reAuthAction ?? 'Call authenticate() again.';
    /**
     * One pending refresh per set of credentials, not one overall. A request
     * for a newly attached payment must not join the refresh still running
     * for the previous one: that refresh is discarded when it lands, so the
     * request would resolve without a token and retry with the rejected one.
     */
    const refreshes = new Map<PaymentCredentials | null, Promise<void>>();

    /**
     * What an authentication failure costs. A server forgets its credentials
     * and has to authenticate() again. A browser holds no client secret: its
     * client id is configuration the shareable-key calls (browser data, card
     * form URL) still need, and its payment credentials can obtain the next
     * token — so it loses the token alone.
     */
    function dropAfterAuthFailure(): void {
        if (deps.store.getClientSecret()) {
            deps.store.clear();
        } else {
            deps.store.clearToken();
        }
    }

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

        // No token at all but payment credentials held means an earlier
        // re-exchange failed: try again rather than fall through to the
        // shareable-key header, which no payment-scoped endpoint accepts.
        if (
            deps.store.isExpiringSoon() ||
            (!deps.store.get() && deps.store.getPaymentCredentials())
        ) {
            await refresh();
        }

        const tokens = deps.store.get();
        if (!tokens) {
            const shareableKey = deps.getShareableKey?.();
            if (shareableKey) {
                const clientId = deps.getClientId?.();
                const credentials = clientId
                    ? globalThis.btoa(`${clientId}:${shareableKey}`)
                    : globalThis.btoa(`:${shareableKey}`);
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
        signal?: AbortSignal,
    ): Promise<Response> {
        const { getTimeoutMs, debugLogResponse, store, emitError } = deps;
        const timeoutMs = getTimeoutMs();
        const timeoutSignal = AbortSignal.timeout(timeoutMs);
        const combinedSignal = signal
            ? AbortSignal.any([signal, timeoutSignal])
            : timeoutSignal;

        let response = await fetchWithRetry(url, init, combinedSignal);
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

        // Deliberately not recorded. The verb method that called us records
        // how the call ended in its own `finally`, so a record here would put
        // a second row under the same endpoint for one logical call — and it
        // would have to derive the endpoint from the URL, which carries the
        // API base path (`/gp-gw/api/4.0/...`) that normalizeEndpoint does not
        // strip, so the two rows would not even group together. That a retry
        // happened is legible from the token call recorded below, which is the
        // only thing that precedes one.
        response = await fetch(
            new Request(url, {
                ...init,
                headers: retryHeaders,
                signal: combinedSignal,
            }),
        );
        debugLogResponse(response);

        if (response.status === 401) {
            dropAfterAuthFailure();
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
        const payment = deps.store.getPaymentCredentials();
        const pending = refreshes.get(payment);
        if (pending) {
            return pending;
        }
        const started = doRefresh(payment).finally(() => {
            refreshes.delete(payment);
        });
        refreshes.set(payment, started);
        return started;
    }

    /**
     * The grant to re-run. A browser that attached a payment holds that
     * payment's credentials and re-exchanges them — the grant issues no refresh
     * token, so this is how a checkout outlives its fifteen-minute token. A
     * server holds client credentials and re-runs `client_credentials`.
     */
    function grantFor(payment: PaymentCredentials | null): {
        form: Record<string, string>;
        basic: string;
    } | null {
        const { store } = deps;
        if (payment) {
            return {
                form: {
                    grant_type: 'payment_credentials',
                    scope: payment.scope,
                },
                basic: `${payment.paymentId}:${payment.paymentSecret}`,
            };
        }
        const clientId = store.getClientId();
        const clientSecret = store.getClientSecret();
        const storedScope = store.getScope();
        if (!clientId || !clientSecret || !storedScope) {
            return null;
        }
        return {
            form: { grant_type: 'client_credentials', scope: storedScope },
            basic: `${clientId}:${clientSecret}`,
        };
    }

    async function doRefresh(
        payment: PaymentCredentials | null,
    ): Promise<void> {
        const { store, baseUrl, emitError, getTimeoutMs } = deps;

        const grant = grantFor(payment);

        if (!grant) {
            dropAfterAuthFailure();
            return emitError(
                new GoPaySDKError(
                    `[GoPaySDK] Access token expired and no client credentials available. ${reAuth}`,
                    { errorCode: GoPayErrorCodes.AUTH_CREDENTIALS_MISSING },
                ),
            );
        }

        try {
            const url = buildUrl(baseUrl, AUTH_PATH);
            const credentials = globalThis.btoa(grant.basic);
            const headers = new Headers({
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: SDK_ACCEPT_HEADER,
                Authorization: `Basic ${credentials}`,
            });

            const started = nowMs();
            let status: number | null = null;
            let response: Response;
            try {
                response = await fetch(
                    new Request(url, {
                        method: 'POST',
                        headers,
                        body: new URLSearchParams(grant.form).toString(),
                        signal: AbortSignal.timeout(getTimeoutMs()),
                    }),
                );
                status = response.status;
            } finally {
                deps.recordApiCall('POST', AUTH_PATH, started, status);
            }
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
            // A payment attached while this exchange was in flight has already
            // stored its own token. Storing this one would put the previous
            // payment's token in its place.
            if (store.getPaymentCredentials() !== payment) {
                return;
            }
            store.set({
                access_token,
                expires_in,
                token_type: 'bearer',
            });
        } catch (cause) {
            // A failed payment re-exchange costs the token only. Clearing the
            // whole store would take the client id with it, which the
            // shareable-key calls (browser data, card-form URL) still need, and
            // the payment credentials, which the next call can retry with.
            if (!payment) {
                store.clear();
            } else if (store.getPaymentCredentials() === payment) {
                store.clearToken();
            }
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
