import { createHttpClient } from '@gopay-internal/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    GoPayErrorCodes,
    GoPayHTTPError,
    GoPaySDKError,
} from '../../src/errors.js';
import { makeResponse } from './helpers.js';

const storedTokens = {
    access_token: 'at-abc',
    expires_in: 900,
    token_type: 'bearer' as const,
};

const freshTokens = {
    access_token: 'at-new',
    expires_in: 900,
    token_type: 'bearer' as const,
};

describe('HttpClient', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchMock = vi.fn().mockResolvedValue(makeResponse({ ok: true }));
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    // -------------------------------------------------------------------------
    // get()
    // -------------------------------------------------------------------------

    describe('get()', () => {
        it('sends GET to correct URL', async () => {
            const client = createHttpClient({ baseUrl: 'https://example.com' });
            client.tokenStore.set(storedTokens);
            await client.get('/data');
            const [req] = fetchMock.mock.calls[0] as [Request];
            expect(req.method).toBe('GET');
            expect(req.url).toBe('https://example.com/data');
        });

        it('injects Bearer header when token is stored', async () => {
            const client = createHttpClient({ baseUrl: 'https://example.com' });
            client.tokenStore.set(storedTokens);
            await client.get('/data');
            const [req] = fetchMock.mock.calls[0] as [Request];
            expect(req.headers.get('Authorization')).toBe('Bearer at-abc');
        });

        it('throws AUTH_TOKEN_MISSING when token store is empty', async () => {
            const client = createHttpClient({ baseUrl: 'https://example.com' });
            const err = await client.get('/data').catch((e: unknown) => e);
            expect(err).toBeInstanceOf(GoPaySDKError);
            expect((err as GoPaySDKError).errorCode).toBe(
                GoPayErrorCodes.AUTH_TOKEN_MISSING,
            );
        });

        it('uses accessToken option over stored token', async () => {
            const client = createHttpClient({ baseUrl: 'https://example.com' });
            client.tokenStore.set(storedTokens);
            await client.get('/data', { accessToken: 'override-token' });
            const [req] = fetchMock.mock.calls[0] as [Request];
            expect(req.headers.get('Authorization')).toBe(
                'Bearer override-token',
            );
        });

        it('merges extra headers from options', async () => {
            const client = createHttpClient({ baseUrl: 'https://example.com' });
            client.tokenStore.set(storedTokens);
            await client.get('/data', { headers: { 'X-Custom': 'value' } });
            const [req] = fetchMock.mock.calls[0] as [Request];
            expect(req.headers.get('X-Custom')).toBe('value');
        });
    });

    // -------------------------------------------------------------------------
    // post()
    // -------------------------------------------------------------------------

    describe('post()', () => {
        it('sends POST with JSON body', async () => {
            let capturedBodyText = '';
            fetchMock.mockImplementation(async (req: Request) => {
                capturedBodyText = await req.text();
                return makeResponse({ created: true });
            });

            const client = createHttpClient({ baseUrl: 'https://example.com' });
            client.tokenStore.set(storedTokens);
            await client.post('/items', { name: 'foo' });

            const [req] = fetchMock.mock.calls[0] as [Request];
            expect(req.method).toBe('POST');
            expect(req.headers.get('content-type')).toMatch('application/json');
            expect(JSON.parse(capturedBodyText)).toEqual({ name: 'foo' });
        });

        it('injects Bearer header when token is stored', async () => {
            const client = createHttpClient({ baseUrl: 'https://example.com' });
            client.tokenStore.set(storedTokens);
            await client.post('/items', {});
            const [req] = fetchMock.mock.calls[0] as [Request];
            expect(req.headers.get('Authorization')).toBe('Bearer at-abc');
        });

        it('throws GoPayHTTPError on HTTP error response', async () => {
            fetchMock.mockImplementation(async (req: Request) => {
                await req.text();
                return makeResponse({ error: 'FORBIDDEN' }, 403, 'Forbidden');
            });

            const client = createHttpClient({ baseUrl: 'https://example.com' });
            client.tokenStore.set(storedTokens);

            const err = await client
                .post('/items', { name: 'foo' })
                .catch((e: unknown) => e);
            expect(err).toBeInstanceOf(GoPayHTTPError);
            expect((err as GoPayHTTPError).status).toBe(403);
        });
    });

    // -------------------------------------------------------------------------
    // postForm()
    // -------------------------------------------------------------------------

    describe('postForm()', () => {
        it('sends POST with url-encoded body and correct headers', async () => {
            let capturedBodyText = '';
            fetchMock.mockImplementation(async (req: Request) => {
                capturedBodyText = await req.text();
                return makeResponse({ token_type: 'bearer' });
            });

            const client = createHttpClient({ baseUrl: 'https://example.com' });
            await client.postForm('/oauth2/token', {
                grant_type: 'client_credentials',
                scope: 'payment:write',
            });

            const [req] = fetchMock.mock.calls[0] as [Request];
            expect(req.method).toBe('POST');
            expect(req.headers.get('Content-Type')).toBe(
                'application/x-www-form-urlencoded',
            );
            const params = new URLSearchParams(capturedBodyText);
            expect(params.get('grant_type')).toBe('client_credentials');
            expect(params.get('scope')).toBe('payment:write');
        });

        it('does NOT inject Bearer on /oauth2/token', async () => {
            fetchMock.mockImplementation(async (req: Request) => {
                await req.text();
                return makeResponse({});
            });

            const client = createHttpClient({ baseUrl: 'https://example.com' });
            client.tokenStore.set(storedTokens);
            await client.postForm('/oauth2/token', {
                grant_type: 'client_credentials',
            });

            const [req] = fetchMock.mock.calls[0] as [Request];
            expect(req.headers.get('Authorization')).toBeNull();
        });

        it('merges extra headers from options', async () => {
            fetchMock.mockImplementation(async (req: Request) => {
                await req.text();
                return makeResponse({});
            });

            const client = createHttpClient({ baseUrl: 'https://example.com' });
            await client.postForm(
                '/oauth2/token',
                { grant_type: 'client_credentials' },
                { headers: { Authorization: 'Basic dXNlcjpwYXNz' } },
            );

            const [req] = fetchMock.mock.calls[0] as [Request];
            expect(req.headers.get('Authorization')).toBe('Basic dXNlcjpwYXNz');
        });

        it('throws GoPayHTTPError with status and parsed body on HTTP error', async () => {
            fetchMock.mockImplementation(async (req: Request) => {
                await req.text();
                return makeResponse(
                    { error: 'UNAUTHORIZED' },
                    401,
                    'Unauthorized',
                );
            });

            const client = createHttpClient({ baseUrl: 'https://example.com' });
            const err = await client
                .postForm('/oauth2/token', { grant_type: 'client_credentials' })
                .catch((e: unknown) => e);

            expect(err).toBeInstanceOf(GoPayHTTPError);
            expect((err as GoPayHTTPError).status).toBe(401);
            expect((err as GoPayHTTPError).body).toEqual({
                error: 'UNAUTHORIZED',
            });
            expect((err as GoPayHTTPError).message).toBe(
                'GoPay API error: HTTP 401',
            );
        });

        it('re-throws non-HTTPError as-is', async () => {
            fetchMock.mockRejectedValue(new TypeError('network failure'));

            const client = createHttpClient({ baseUrl: 'https://example.com' });
            await expect(
                client.postForm('/oauth2/token', {
                    grant_type: 'client_credentials',
                }),
            ).rejects.toThrow('network failure');
        });
    });

    // -------------------------------------------------------------------------
    // throwHTTPError — non-JSON body fallback
    // -------------------------------------------------------------------------

    describe('throwHTTPError() — non-JSON body', () => {
        it('sets body to plain text string when response body is not JSON', async () => {
            fetchMock.mockResolvedValue(
                new Response('upstream error details', {
                    status: 400,
                    statusText: 'Bad Request',
                    headers: { 'content-type': 'text/plain' },
                }),
            );

            const client = createHttpClient({ baseUrl: 'https://example.com' });
            client.tokenStore.set(storedTokens);

            const err = await client.get('/resource').catch((e: unknown) => e);
            expect(err).toBeInstanceOf(GoPayHTTPError);
            expect((err as GoPayHTTPError).status).toBe(400);
            expect((err as GoPayHTTPError).body).toBe('upstream error details');
        });

        it.each([
            ['true', 'true'],
            ['0', '0'],
        ])('keeps text/plain body %s as a raw string (not parsed as JSON)', async (bodyText, expected) => {
            fetchMock.mockResolvedValue(
                new Response(bodyText, {
                    status: 502,
                    statusText: 'Bad Gateway',
                    headers: { 'content-type': 'text/plain' },
                }),
            );

            const client = createHttpClient({
                baseUrl: 'https://example.com',
            });
            client.tokenStore.set(storedTokens);

            const err = await client.get('/resource').catch((e: unknown) => e);
            expect(err).toBeInstanceOf(GoPayHTTPError);
            expect(typeof (err as GoPayHTTPError).body).toBe('string');
            expect((err as GoPayHTTPError).body).toBe(expected);
        });
    });

    // -------------------------------------------------------------------------
    // afterResponse hook — 401 handling
    // -------------------------------------------------------------------------

    // -------------------------------------------------------------------------
    // re-authentication — credential forwarding
    // -------------------------------------------------------------------------

    describe('re-authentication — credential forwarding', () => {
        it('sends Basic Authorization with client_credentials grant on re-auth', async () => {
            let callCount = 0;
            let capturedAuthHeader = '';
            let capturedReAuthBody = '';
            fetchMock.mockImplementation(async (req: Request) => {
                callCount++;
                if (callCount === 1) {
                    return makeResponse({}, 401, 'Unauthorized');
                }
                if (callCount === 2) {
                    capturedAuthHeader = req.headers.get('Authorization') ?? '';
                    capturedReAuthBody = await req.text();
                    return makeResponse(freshTokens);
                }
                return makeResponse({ ok: true });
            });

            const client = createHttpClient({ baseUrl: 'https://example.com' });
            client.setClientCredentials(
                'my-client',
                'my-secret',
                'payment:write',
            );
            client.tokenStore.set(storedTokens);

            await client.get('/resource');

            expect(capturedAuthHeader).toBe(
                `Basic ${btoa('my-client:my-secret')}`,
            );
            const body = new URLSearchParams(capturedReAuthBody);
            expect(body.get('grant_type')).toBe('client_credentials');
            expect(body.get('scope')).toBe('payment:write');
        });

        it('throws AUTH_CREDENTIALS_MISSING when credentials have no scope', async () => {
            fetchMock.mockResolvedValue(makeResponse({}, 401, 'Unauthorized'));

            const client = createHttpClient({ baseUrl: 'https://example.com' });
            client.setClientCredentials('my-client', 'my-secret'); // no scope
            client.tokenStore.set(storedTokens);

            const err = await client.get('/resource').catch((e: unknown) => e);
            expect(err).toBeInstanceOf(GoPaySDKError);
            expect((err as GoPaySDKError).message).toContain(
                'Access token expired and no client credentials available',
            );
            expect((err as GoPaySDKError).errorCode).toBe(
                GoPayErrorCodes.AUTH_CREDENTIALS_MISSING,
            );
            expect(client.tokenStore.hasAccessToken()).toBe(false);
        });
    });

    // -------------------------------------------------------------------------
    // afterResponse hook — 401 handling
    // -------------------------------------------------------------------------

    describe('afterResponse hook', () => {
        it('passes through non-401 responses unchanged', async () => {
            fetchMock.mockResolvedValue(makeResponse({ data: 1 }, 200));

            const client = createHttpClient({ baseUrl: 'https://example.com' });
            client.tokenStore.set(storedTokens);
            const result = await client.get<{ data: number }>('/resource');
            expect(result).toEqual({ data: 1 });
        });

        it('passes through 401 on /oauth2/token without retrying', async () => {
            fetchMock.mockImplementation(async (req: Request) => {
                await req.text();
                return makeResponse({}, 401, 'Unauthorized');
            });

            const client = createHttpClient({ baseUrl: 'https://example.com' });
            const err = await client
                .postForm('/oauth2/token', { grant_type: 'client_credentials' })
                .catch((e: unknown) => e);

            expect(err).toBeInstanceOf(GoPayHTTPError);
            expect((err as GoPayHTTPError).status).toBe(401);
            // fetch called exactly once — no retry
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        it('throws AUTH_CREDENTIALS_MISSING when no client credentials available', async () => {
            fetchMock.mockResolvedValue(makeResponse({}, 401, 'Unauthorized'));

            const client = createHttpClient({ baseUrl: 'https://example.com' });
            client.tokenStore.set(storedTokens);
            const err = await client.get('/resource').catch((e: unknown) => e);
            expect(err).toBeInstanceOf(GoPaySDKError);
            expect((err as GoPaySDKError).message).toContain(
                'Access token expired and no client credentials available',
            );
            expect((err as GoPaySDKError).errorCode).toBe(
                GoPayErrorCodes.AUTH_CREDENTIALS_MISSING,
            );
            expect(client.tokenStore.hasAccessToken()).toBe(false);
        });

        it('throws AUTH_REFRESH_FAILED when re-authentication call fails', async () => {
            let callCount = 0;
            fetchMock.mockImplementation(async (req: Request) => {
                callCount++;
                if (callCount === 1) {
                    return makeResponse({}, 401, 'Unauthorized');
                }
                await req.text();
                return makeResponse({}, 401, 'Unauthorized');
            });

            const client = createHttpClient({ baseUrl: 'https://example.com' });
            client.setClientCredentials('id', 'secret', 'payment:write');
            client.tokenStore.set(storedTokens);

            const err = await client.get('/resource').catch((e: unknown) => e);
            expect(err).toBeInstanceOf(GoPaySDKError);
            expect((err as GoPaySDKError).message).toContain(
                'Token refresh failed',
            );
            expect((err as GoPaySDKError).errorCode).toBe(
                GoPayErrorCodes.AUTH_REFRESH_FAILED,
            );
            expect(client.tokenStore.hasAccessToken()).toBe(false);
        });

        it('retries with fresh token after successful re-authentication', async () => {
            let callCount = 0;
            fetchMock.mockImplementation(async (req: Request) => {
                callCount++;
                if (callCount === 1) {
                    return makeResponse({}, 401, 'Unauthorized');
                }
                if (callCount === 2) {
                    await req.text();
                    return makeResponse(freshTokens);
                }
                return makeResponse({ result: 'ok' });
            });

            const client = createHttpClient({ baseUrl: 'https://example.com' });
            client.setClientCredentials('id', 'secret', 'payment:write');
            client.tokenStore.set(storedTokens);

            const result = await client.get<{ result: string }>('/resource');
            expect(result).toEqual({ result: 'ok' });
            expect(client.tokenStore.get()?.access_token).toBe('at-new');
            expect(fetchMock).toHaveBeenCalledTimes(3);

            const retryReq = fetchMock.mock.calls[2][0] as Request;
            expect(retryReq.headers.get('Authorization')).toBe('Bearer at-new');
        });

        it('throws AUTH_UNAUTHORIZED when retry after re-authentication is also 401', async () => {
            let callCount = 0;
            fetchMock.mockImplementation(async (req: Request) => {
                callCount++;
                if (callCount === 1) {
                    return makeResponse({}, 401, 'Unauthorized');
                }
                if (callCount === 2) {
                    await req.text();
                    return makeResponse(freshTokens);
                }
                return makeResponse({}, 401, 'Unauthorized');
            });

            const client = createHttpClient({ baseUrl: 'https://example.com' });
            client.setClientCredentials('id', 'secret', 'payment:write');
            client.tokenStore.set(storedTokens);

            const err = await client.get('/resource').catch((e: unknown) => e);
            expect(err).toBeInstanceOf(GoPaySDKError);
            expect((err as GoPaySDKError).message).toContain(
                'Request unauthorized after token refresh',
            );
            expect((err as GoPaySDKError).errorCode).toBe(
                GoPayErrorCodes.AUTH_UNAUTHORIZED,
            );
            expect(client.tokenStore.hasAccessToken()).toBe(false);
        });
    });

    // -------------------------------------------------------------------------
    // beforeRequest hook — proactive refresh
    // -------------------------------------------------------------------------

    describe('proactive refresh (beforeRequest hook)', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('re-authenticates proactively when token is expiring soon', async () => {
            let callCount = 0;
            let capturedReAuthBody = '';
            fetchMock.mockImplementation(async (req: Request) => {
                callCount++;
                if (callCount === 1) {
                    capturedReAuthBody = await req.text();
                    return makeResponse(freshTokens);
                }
                return makeResponse({ result: 'ok' });
            });

            const client = createHttpClient({ baseUrl: 'https://example.com' });
            client.setClientCredentials('id', 'secret', 'payment:write');
            client.tokenStore.set(storedTokens); // issued_at = 0 (fake time)
            vi.advanceTimersByTime(871_000); // 29s left — within 30s buffer

            const result = await client.get<{ result: string }>('/resource');

            expect(result).toEqual({ result: 'ok' });
            expect(fetchMock).toHaveBeenCalledTimes(2);
            const reAuthReq = fetchMock.mock.calls[0][0] as Request;
            expect(reAuthReq.url).toContain('/oauth2/token');
            const body = new URLSearchParams(capturedReAuthBody);
            expect(body.get('grant_type')).toBe('client_credentials');
            expect(client.tokenStore.get()?.access_token).toBe('at-new');
        });

        it('does not re-authenticate proactively when token has plenty of time', async () => {
            const client = createHttpClient({ baseUrl: 'https://example.com' });
            client.setClientCredentials('id', 'secret');
            client.tokenStore.set(storedTokens);
            vi.advanceTimersByTime(1_000); // 1s elapsed — well within expiry

            await client.get('/resource');

            expect(fetchMock).toHaveBeenCalledTimes(1);
            const [req] = fetchMock.mock.calls[0] as [Request];
            expect(req.url).not.toContain('/oauth2/token');
        });

        it('coalesces concurrent expiry-triggered re-auths into one network call', async () => {
            let reAuthCallCount = 0;
            fetchMock.mockImplementation(async (req: Request) => {
                if (req.url.includes('/oauth2/token')) {
                    reAuthCallCount++;
                    await req.text();
                    return makeResponse(freshTokens);
                }
                return makeResponse({ result: 'ok' });
            });

            const client = createHttpClient({ baseUrl: 'https://example.com' });
            client.setClientCredentials('id', 'secret', 'payment:write');
            client.tokenStore.set(storedTokens);
            vi.advanceTimersByTime(871_000);

            const [r1, r2] = await Promise.all([
                client.get('/resource'),
                client.get('/resource'),
            ]);

            expect(r1).toEqual({ result: 'ok' });
            expect(r2).toEqual({ result: 'ok' });
            expect(reAuthCallCount).toBe(1);
            expect(client.tokenStore.get()?.access_token).toBe('at-new');
        });

        it('throws AUTH_CREDENTIALS_MISSING and clears store when no credentials for proactive re-auth', async () => {
            const client = createHttpClient({ baseUrl: 'https://example.com' });
            client.tokenStore.set(storedTokens);
            vi.advanceTimersByTime(871_000);

            const err = await client.get('/resource').catch((e: unknown) => e);
            expect(err).toBeInstanceOf(GoPaySDKError);
            expect((err as GoPaySDKError).message).toContain(
                'Access token expired and no client credentials available',
            );
            expect((err as GoPaySDKError).errorCode).toBe(
                GoPayErrorCodes.AUTH_CREDENTIALS_MISSING,
            );
            expect(client.tokenStore.hasAccessToken()).toBe(false);
        });
    });

    // -------------------------------------------------------------------------
    // onError callback
    // -------------------------------------------------------------------------

    describe('onError callback', () => {
        it('is called with GoPayHTTPError on non-2xx response', async () => {
            const onError = vi.fn();
            fetchMock.mockImplementation(async (req: Request) => {
                await req.text();
                return makeResponse({ error: 'FORBIDDEN' }, 403, 'Forbidden');
            });

            const client = createHttpClient({
                baseUrl: 'https://example.com',
                onError,
            });
            client.tokenStore.set(storedTokens);

            await client.post('/items', {}).catch(() => {});

            expect(onError).toHaveBeenCalledOnce();
            expect(onError.mock.calls[0][0]).toBeInstanceOf(GoPayHTTPError);
            expect((onError.mock.calls[0][0] as GoPayHTTPError).status).toBe(
                403,
            );
        });

        it('is called with GoPaySDKError when no token is stored', async () => {
            const onError = vi.fn();
            const client = createHttpClient({
                baseUrl: 'https://example.com',
                onError,
            });

            await client.get('/data').catch(() => {});

            expect(onError).toHaveBeenCalledOnce();
            const err = onError.mock.calls[0][0] as GoPaySDKError;
            expect(err).toBeInstanceOf(GoPaySDKError);
            expect(err.errorCode).toBe(GoPayErrorCodes.AUTH_TOKEN_MISSING);
        });

        it('is not called on successful requests', async () => {
            const onError = vi.fn();
            const client = createHttpClient({
                baseUrl: 'https://example.com',
                onError,
            });
            client.tokenStore.set(storedTokens);

            await client.get('/data');

            expect(onError).not.toHaveBeenCalled();
        });
    });

    // -------------------------------------------------------------------------
    // Network errors
    // -------------------------------------------------------------------------

    describe('network errors', () => {
        it('wraps TimeoutError as GoPaySDKError with NETWORK_TIMEOUT code', async () => {
            const timeout = new Error('Request timed out');
            timeout.name = 'TimeoutError';
            fetchMock.mockRejectedValue(timeout);

            const client = createHttpClient({ baseUrl: 'https://example.com' });
            client.tokenStore.set(storedTokens);

            const err = await client.get('/data').catch((e: unknown) => e);
            expect(err).toBeInstanceOf(GoPaySDKError);
            expect((err as GoPaySDKError).errorCode).toBe(
                GoPayErrorCodes.NETWORK_TIMEOUT,
            );
        });

        it('wraps fetch failure as GoPaySDKError with NETWORK_ERROR code', async () => {
            fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

            const client = createHttpClient({ baseUrl: 'https://example.com' });
            client.tokenStore.set(storedTokens);

            const err = await client.get('/data').catch((e: unknown) => e);
            expect(err).toBeInstanceOf(GoPaySDKError);
            expect((err as GoPaySDKError).errorCode).toBe(
                GoPayErrorCodes.NETWORK_ERROR,
            );
        });

        it('re-throws non-Error thrown values as-is', async () => {
            fetchMock.mockRejectedValue('raw-string-error');

            const client = createHttpClient({ baseUrl: 'https://example.com' });
            client.tokenStore.set(storedTokens);

            await expect(client.get('/data')).rejects.toBe('raw-string-error');
        });
    });

    // -------------------------------------------------------------------------
    // HTTP error — malformed JSON body
    // -------------------------------------------------------------------------

    describe('HTTP error with malformed JSON body', () => {
        it('falls back to raw text when content-type is JSON but body is not valid JSON', async () => {
            fetchMock.mockResolvedValue(
                new Response('not-valid-json{{{', {
                    status: 400,
                    statusText: 'Bad Request',
                    headers: { 'content-type': 'application/json' },
                }),
            );

            const client = createHttpClient({ baseUrl: 'https://example.com' });
            client.tokenStore.set(storedTokens);

            const err = await client.get('/resource').catch((e: unknown) => e);
            expect(err).toBeInstanceOf(GoPayHTTPError);
            expect((err as GoPayHTTPError).status).toBe(400);
            expect((err as GoPayHTTPError).body).toBe('not-valid-json{{{');
        });
    });

    // -------------------------------------------------------------------------
    // debugLoggingEnabled
    // -------------------------------------------------------------------------

    describe('debugLoggingEnabled', () => {
        it('logs outgoing request and incoming response when enabled', async () => {
            const debugSpy = vi
                .spyOn(console, 'debug')
                .mockImplementation(() => {});

            const client = createHttpClient({
                baseUrl: 'https://example.com',
                debugLoggingEnabled: true,
            });
            client.tokenStore.set(storedTokens);

            await client.get('/data');

            expect(debugSpy).toHaveBeenCalledTimes(2);
            expect(debugSpy.mock.calls[0][0]).toBe('[GoPaySDK] →');
            expect(debugSpy.mock.calls[1][0]).toBe('[GoPaySDK] ←');
        });
    });

    // -------------------------------------------------------------------------
    // requestTimeoutMs config
    // -------------------------------------------------------------------------

    describe('requestTimeoutMs config', () => {
        it('accepts a custom timeout value without throwing', async () => {
            expect(() =>
                createHttpClient({
                    baseUrl: 'https://example.com',
                    requestTimeoutMs: 5_000,
                }),
            ).not.toThrow();
        });
    });

    // -------------------------------------------------------------------------
    // Security: baseUrl scheme validation
    // -------------------------------------------------------------------------

    describe('constructor: baseUrl scheme validation', () => {
        it('accepts https:// baseUrl', () => {
            expect(() =>
                createHttpClient({ baseUrl: 'https://example.com' }),
            ).not.toThrow();
        });

        it('throws for http:// non-localhost baseUrl', () => {
            expect(() =>
                createHttpClient({ baseUrl: 'http://example.com' }),
            ).toThrow(/must use HTTPS/);
        });

        it('throws for javascript: scheme', () => {
            expect(() =>
                createHttpClient({ baseUrl: 'javascript:alert(1)' }),
            ).toThrow(/must use HTTPS/);
        });

        it('throws for a completely invalid URL string', () => {
            expect(() => createHttpClient({ baseUrl: 'not a url' })).toThrow(
                /not a valid URL/,
            );
        });

        it('accepts http://localhost in sandbox environment', () => {
            expect(() =>
                createHttpClient({
                    environment: 'sandbox',
                    baseUrl: 'http://localhost:3000',
                }),
            ).not.toThrow();
        });

        it('accepts http://127.0.0.1 in sandbox environment', () => {
            expect(() =>
                createHttpClient({
                    environment: 'sandbox',
                    baseUrl: 'http://127.0.0.1:8080',
                }),
            ).not.toThrow();
        });

        it('throws for http://localhost in production environment', () => {
            expect(() =>
                createHttpClient({
                    environment: 'production',
                    baseUrl: 'http://localhost:3000',
                }),
            ).toThrow(/must use HTTPS/);
        });

        it('throws for http:// remote host in sandbox environment', () => {
            expect(() =>
                createHttpClient({
                    environment: 'sandbox',
                    baseUrl: 'http://staging.example.com',
                }),
            ).toThrow(/must use HTTPS/);
        });
    });

    // -------------------------------------------------------------------------
    // Security: GoPayHTTPError.message does not expose response body
    // -------------------------------------------------------------------------

    describe('GoPayHTTPError message format', () => {
        it('message is terse and does not contain the response body', async () => {
            fetchMock.mockImplementation(async (req: Request) => {
                await req.text();
                return makeResponse(
                    { pan: '4111111111111111', error: 'CARD_DECLINED' },
                    402,
                    'Payment Required',
                );
            });

            const client = createHttpClient({ baseUrl: 'https://example.com' });
            client.tokenStore.set(storedTokens);

            const err = await client
                .post('/payments', {})
                .catch((e: unknown) => e);

            expect(err).toBeInstanceOf(GoPayHTTPError);
            expect((err as GoPayHTTPError).message).toBe(
                'GoPay API error: HTTP 402',
            );
            expect((err as GoPayHTTPError).body).toEqual({
                pan: '4111111111111111',
                error: 'CARD_DECLINED',
            });
            expect((err as GoPayHTTPError).message).not.toContain(
                '4111111111111111',
            );
            expect((err as GoPayHTTPError).message).not.toContain(
                'CARD_DECLINED',
            );
        });

        it('message does not contain response body for plain-text error', async () => {
            fetchMock.mockResolvedValue(
                new Response('Internal server error details', {
                    status: 500,
                    statusText: 'Internal Server Error',
                    headers: { 'content-type': 'text/plain' },
                }),
            );

            const client = createHttpClient({ baseUrl: 'https://example.com' });
            client.tokenStore.set(storedTokens);

            const err = await client.get('/resource').catch((e: unknown) => e);
            expect(err).toBeInstanceOf(GoPayHTTPError);
            expect((err as GoPayHTTPError).message).toBe(
                'GoPay API error: HTTP 500',
            );
            expect((err as GoPayHTTPError).message).not.toContain(
                'Internal server error details',
            );
        });

        it('debugLoggingEnabled: false produces no console output by default', async () => {
            const debugSpy = vi
                .spyOn(console, 'debug')
                .mockImplementation(() => {});

            const client = createHttpClient({ baseUrl: 'https://example.com' });
            client.tokenStore.set(storedTokens);
            await client.get('/data');

            expect(debugSpy).not.toHaveBeenCalled();
        });
    });
});
