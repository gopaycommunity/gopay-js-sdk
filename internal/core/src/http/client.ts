import type { CoreConfig } from '../config.js';
import {
    attachCorrelation,
    GoPayHTTPError,
    GoPaySDKError,
    isForeignCode,
    safeErrorLabel,
    toTransportError,
} from '../errors.js';
import {
    type ApiCallDetails,
    type ApiCallRecord,
    NO_TELEMETRY,
    nowMs,
    type Telemetry,
} from '../logging/telemetry.js';
import { createAuthHandler } from './auth-handler.js';
import { buildUrl, resolveBaseUrl } from './build-url.js';
import { SDK_ACCEPT_HEADER } from './constants.js';
import {
    type Correlation,
    type CorrelationIds,
    correlate,
} from './correlation.js';
import { normalizeEndpoint } from './endpoint.js';
import { parseBody } from './response.js';
import { timeoutSignal } from './timeout-signal.js';
import {
    createTokenStore,
    type PaymentCredentials,
    type StoredTokenPair,
} from './token-store.js';
import type { PostOptions, RequestOptions } from './types.js';

/**
 * Errors already handed to `onError`.
 *
 * One failure crosses several layers on its way out — `throwIfNotOk` reports an
 * HTTP error, the verb method's catch hands it to `handleError`, and the API
 * wrapper sees it again — and each layer would otherwise report it afresh.
 * Holding the errors weakly keeps the set from pinning them in memory.
 */
const reportedErrors = new WeakSet<GoPaySDKError | GoPayHTTPError>();

/**
 * Foreign errors get a fresh wrapper each time they are reported, so the
 * dedupe above cannot see them. Held weakly for the same reason.
 */
const wrappedForeignErrors = new WeakSet<object>();

/**
 * A short, safe description of something that is not one of our errors.
 *
 * Reads the shape Google Pay rejects with before falling back to the generic
 * ones. Kept to a code and a message — the telemetry layer sanitizes what it
 * sends, but there is no reason to hand it more than this in the first place.
 */
/**
 * Describe something that is not one of our errors, without quoting it.
 *
 * Codes yes, prose no. `statusCode` is the shape Google Pay rejects with and
 * is a code like any other, so it is kept when it actually looks like one.
 * `statusMessage` and `message` are free text written by somebody else's
 * code, and the guarantee this SDK makes about what leaves the page is that
 * the only free text in it is text the SDK wrote itself — a guarantee that
 * has to hold at the call sites, not only in the scrubber downstream. The
 * original object stays on `cause` for anyone debugging locally.
 */
function describeForeign(error: unknown): string {
    if (typeof error !== 'object' || error === null) {
        return typeof error;
    }
    const { statusCode } = error as { statusCode?: unknown };
    if (isForeignCode(statusCode)) {
        return statusCode;
    }
    return safeErrorLabel(error);
}

function reportOnce(
    config: CoreConfig,
    error: GoPaySDKError | GoPayHTTPError,
    telemetry: Telemetry,
    /**
     * False when the caller has already emitted an event that describes this
     * better than `SDK.<code>` can. The integrator still hears about it through
     * onError — only the operational event is suppressed, so the two do not
     * count the same occurrence twice.
     */
    emitTelemetry = true,
    /**
     * False for a request the SDK makes on its own behalf and does not need
     * (PostOptions.quiet): the operational event still goes out, but the
     * integrator is not told about a failure they can do nothing about.
     */
    notifyIntegrator = true,
): void {
    if (reportedErrors.has(error)) {
        return;
    }
    reportedErrors.add(error);
    // Behind the same dedupe as onError, so one failure is one record however
    // many layers it crossed. HTTP errors are skipped on purpose — they already
    // left through apiCall carrying their real status.
    if (emitTelemetry && error instanceof GoPaySDKError) {
        telemetry.error(error);
    }
    if (!notifyIntegrator) {
        return;
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
    // Request ids for the gateway's log; without it requests carry none.
    correlation?: Correlation,
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
        details?: ApiCallDetails,
    ): void {
        const rec: ApiCallRecord = {
            method,
            endpoint: normalizeEndpoint(path),
            statusCode,
            durationMs: Math.round(nowMs() - started),
            requestBody: details?.request,
            responseBody: details?.response,
            traceId: details?.traceId,
        };
        telemetry.apiCall(rec);
    }

    /**
     * The body a failed request came back with. throwIfNotOk has already
     * parsed it into the error, so it is read from there rather than from a
     * response whose stream is spent.
     */
    function errorBody(err: unknown): unknown {
        return err instanceof GoPayHTTPError ? err.body : undefined;
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
        recordApiCall: record,
        getShareableKey: () => shareableKey,
        getClientId: () => tokenStore.getClientId(),
        reAuthAction,
        correlate: (headers, path) => correlate(correlation, headers, path),
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
    function reportError(
        error: unknown,
        options?: { telemetry?: boolean },
    ): void {
        const emitTelemetry = options?.telemetry !== false;
        if (error instanceof GoPaySDKError || error instanceof GoPayHTTPError) {
            reportOnce(config, error, telemetry, emitTelemetry);
            return;
        }

        // Everything else used to be dropped here, in silence. That is not a
        // rare shape: a wallet SDK throws a bare TypeError, and Google Pay
        // rejects with a plain `{statusCode, statusMessage}` object that is
        // not an Error at all — so its most common real failures
        // (DEVELOPER_ERROR, MERCHANT_ACCOUNT_ERROR) reached neither onError
        // nor any event. A backstop rather than the main fix: callers that
        // know what they are reporting should name a real error code, and the
        // wallets now do. This is what catches the ones that do not.
        if (typeof error === 'object' && error !== null) {
            if (wrappedForeignErrors.has(error)) {
                return;
            }
            wrappedForeignErrors.add(error);
        }
        // No errorCode: the core cannot know which subsystem this came from,
        // and inventing one would be worse than admitting it. Telemetry maps a
        // missing code to `SDK.UNKNOWN`, which is exactly what this is.
        reportOnce(
            config,
            new GoPaySDKError(
                `[GoPaySDK] Unhandled failure: ${describeForeign(error)}`,
                { cause: error },
            ),
            telemetry,
        );
    }

    function emitError<E extends GoPaySDKError | GoPayHTTPError>(
        error: E,
        notifyIntegrator = true,
    ): never {
        reportOnce(config, error, telemetry, true, notifyIntegrator);
        throw error;
    }

    function handleError(
        err: unknown,
        ids?: CorrelationIds,
        notifyIntegrator = true,
    ): never {
        // Report before rethrowing. These arrive already typed — either from
        // throwIfNotOk, which has reported them, or from a validator such as
        // buildUrl, which has not — or as the platform's own failure, which
        // toTransportError types. reportOnce tells the reported ones apart, so
        // the rest stop being invisible without the first firing twice.
        const mapped = toTransportError(err, ids);
        if (
            mapped instanceof GoPaySDKError ||
            mapped instanceof GoPayHTTPError
        ) {
            return emitError(mapped, notifyIntegrator);
        }
        throw mapped;
    }

    async function throwIfNotOk(
        response: Response,
        method: string,
        path: string,
        ids?: CorrelationIds,
        notifyIntegrator = true,
    ): Promise<void> {
        if (response.ok) {
            return;
        }
        const body = await parseBody(response);
        const error = new GoPayHTTPError(response.status, body, {
            method,
            endpoint: normalizeEndpoint(path),
        });
        // Before emitting, so onError already sees them.
        attachCorrelation(error, ids);
        emitError(error, notifyIntegrator);
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

        /** What an expired payment token is re-exchanged with; `null` forgets it. */
        setPaymentCredentials(credentials: PaymentCredentials | null): void {
            tokenStore.setPaymentCredentials(credentials);
        },

        /** Whether a payment's credentials are held to re-exchange. */
        hasPaymentCredentials(): boolean {
            return tokenStore.getPaymentCredentials() !== null;
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

        /** Drop the access token alone, keeping whatever can obtain another. */
        clearToken(): void {
            tokenStore.clearToken();
        },

        clearTokens(): void {
            tokenStore.clear();
        },

        emitError,
        reportError,

        /**
         * For the requests that deliberately bypass this client and would
         * otherwise be the SDK's only untimed traffic — today
         * `fetchBrowserData`, which cannot use the verb methods because their
         * 401 handling would clear the token store mid-charge.
         */
        recordApiCall: record,

        /**
         * Sets the request ids on a request such a bypass sends, as the verb
         * methods do on theirs; undefined when the client sets none.
         */
        correlate: (headers: Headers, path: string) =>
            correlate(correlation, headers, path),

        async get<T>(path: string, options?: RequestOptions): Promise<T> {
            const started = nowMs();
            let status: number | null = null;
            // Only a call that actually went out gets a record. Without
            // this the `finally` also fires for a failure that happened
            // before the request — a missing token, a bad path — and
            // reports it as `status_code: null`, which downstream means
            // "issued, no response": a phantom network error on an
            // endpoint nothing ever called, next to the SDK.<CODE> event
            // that already described the same failure correctly.
            let issued = false;
            let responseBody: unknown;
            let ids: CorrelationIds | undefined;
            try {
                const url = buildUrl(baseUrl, path);
                const headers = new Headers({ Accept: SDK_ACCEPT_HEADER });
                await auth.injectAuth(headers, url, options);
                // After injectAuth: a call refused before any request goes out has no ids to quote,
                // and no header a caller passed replaces the SDK's.
                ids = correlate(correlation, headers, path);
                debugLogRequest('GET', url);
                issued = true;
                const response = await auth.fetchAndHandle401(
                    url,
                    { method: 'GET', headers },
                    options?.signal,
                );
                status = response.status;
                await throwIfNotOk(response, 'GET', path, ids);
                responseBody = await response.json();
                return responseBody as T;
            } catch (err) {
                responseBody = errorBody(err);
                return handleError(err, ids);
            } finally {
                if (issued) {
                    record('GET', path, started, status, {
                        traceId: ids?.traceId,
                        response: responseBody,
                    });
                }
            }
        },

        async post<T>(
            path: string,
            body?: unknown,
            options?: PostOptions,
        ): Promise<T> {
            const started = nowMs();
            let status: number | null = null;
            // Only a call that actually went out gets a record. Without
            // this the `finally` also fires for a failure that happened
            // before the request — a missing token, a bad path — and
            // reports it as `status_code: null`, which downstream means
            // "issued, no response": a phantom network error on an
            // endpoint nothing ever called, next to the SDK.<CODE> event
            // that already described the same failure correctly.
            let issued = false;
            let responseBody: unknown;
            let ids: CorrelationIds | undefined;
            const notifyIntegrator = options?.quiet !== true;
            try {
                const url = buildUrl(baseUrl, path);
                const headers = new Headers({
                    Accept: SDK_ACCEPT_HEADER,
                    'Content-Type': 'application/json',
                });
                await auth.injectAuth(headers, url, options);
                // After injectAuth: a call refused before any request goes out has no ids to quote,
                // and no header a caller passed replaces the SDK's.
                ids = correlate(correlation, headers, path);
                debugLogRequest('POST', url);
                issued = true;
                const response = await auth.fetchAndHandle401(
                    url,
                    { method: 'POST', headers, body: JSON.stringify(body) },
                    options?.signal,
                    notifyIntegrator,
                );
                status = response.status;
                await throwIfNotOk(
                    response,
                    'POST',
                    path,
                    ids,
                    notifyIntegrator,
                );
                // 204 has no body to parse, and reading one anyway fails as
                // invalid JSON — which the catch below would then report as a
                // network error on a request that succeeded.
                responseBody =
                    response.status === 204 ? undefined : await response.json();
                return responseBody as T;
            } catch (err) {
                responseBody = errorBody(err);
                return handleError(err, ids, notifyIntegrator);
            } finally {
                if (issued) {
                    record('POST', path, started, status, {
                        traceId: ids?.traceId,
                        request: body,
                        response: responseBody,
                    });
                }
            }
        },

        async delete(path: string, options?: RequestOptions): Promise<void> {
            const started = nowMs();
            let status: number | null = null;
            // Only a call that actually went out gets a record. Without
            // this the `finally` also fires for a failure that happened
            // before the request — a missing token, a bad path — and
            // reports it as `status_code: null`, which downstream means
            // "issued, no response": a phantom network error on an
            // endpoint nothing ever called, next to the SDK.<CODE> event
            // that already described the same failure correctly.
            let issued = false;
            let responseBody: unknown;
            let ids: CorrelationIds | undefined;
            try {
                const url = buildUrl(baseUrl, path);
                const headers = new Headers();
                await auth.injectAuth(headers, url, options);
                // After injectAuth: a call refused before any request goes out has no ids to quote,
                // and no header a caller passed replaces the SDK's.
                ids = correlate(correlation, headers, path);
                debugLogRequest('DELETE', url);
                issued = true;
                const response = await auth.fetchAndHandle401(
                    url,
                    { method: 'DELETE', headers },
                    options?.signal,
                );
                status = response.status;
                await throwIfNotOk(response, 'DELETE', path, ids);
            } catch (err) {
                responseBody = errorBody(err);
                return handleError(err, ids);
            } finally {
                if (issued) {
                    record('DELETE', path, started, status, {
                        traceId: ids?.traceId,
                        response: responseBody,
                    });
                }
            }
        },

        async postForm<T>(
            path: string,
            form: Record<string, string>,
            options?: RequestOptions,
        ): Promise<T> {
            const started = nowMs();
            let status: number | null = null;
            // Only a call that actually went out gets a record. Without
            // this the `finally` also fires for a failure that happened
            // before the request — a missing token, a bad path — and
            // reports it as `status_code: null`, which downstream means
            // "issued, no response": a phantom network error on an
            // endpoint nothing ever called, next to the SDK.<CODE> event
            // that already described the same failure correctly.
            let issued = false;
            let responseBody: unknown;
            let ids: CorrelationIds | undefined;
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
                // After injectAuth: a call refused before any request goes out has no ids to quote,
                // and no header a caller passed replaces the SDK's.
                ids = correlate(correlation, headers, path);
                debugLogRequest('POST', url);
                issued = true;
                const bodyStr = new URLSearchParams(form).toString();
                const response = await fetch(
                    new Request(url, {
                        method: 'POST',
                        headers,
                        body: bodyStr,
                        signal: timeoutSignal(timeoutMs(), options?.signal)
                            .signal,
                    }),
                );
                debugLogResponse(response);
                status = response.status;
                await throwIfNotOk(response, 'POST', path, ids);
                responseBody = await response.json();
                return responseBody as T;
            } catch (err) {
                responseBody = errorBody(err);
                return handleError(err, ids);
            } finally {
                if (issued) {
                    record('POST', path, started, status, {
                        traceId: ids?.traceId,
                        request: form,
                        response: responseBody,
                    });
                }
            }
        },
    };
}

export type HttpClient = ReturnType<typeof createHttpClient>;
