import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoPayHTTPError, GoPaySDKError } from '../src/errors.js';
import { HttpClient } from '../src/http/client.js';
import type { TokenStore } from '../src/http/token-store.js';

const tokenStore = (client: HttpClient) =>
    (client as unknown as { tokenStore: TokenStore }).tokenStore;

// Must return a real Response so ky accepts it as an afterResponse hook replacement
const makeResponse = (data: unknown, status = 200, statusText = 'OK') =>
    new Response(JSON.stringify(data), {
        status,
        statusText,
        headers: { 'content-type': 'application/json' },
    });

const storedTokens = {
    access_token: 'at-abc',
    refresh_token: 'rt-xyz',
    expires_in: 900,
    refresh_expires_in: 86400,
    token_type: 'bearer' as const,
};

const freshTokens = {
    access_token: 'at-new',
    refresh_token: 'rt-new',
    expires_in: 900,
    refresh_expires_in: 86400,
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
    });

    // -------------------------------------------------------------------------
    // get()
    // -------------------------------------------------------------------------

    describe('get()', () => {
        it('sends GET to correct URL', async () => {
            const client = new HttpClient({ baseUrl: 'https://example.com' });
            tokenStore(client).set(storedTokens);
            await client.get('/data');
            const [req] = fetchMock.mock.calls[0] as [Request];
            expect(req.method).toBe('GET');
            expect(req.url).toBe('https://example.com/data');
        });

        it('injects Bearer header when token is stored', async () => {
            const client = new HttpClient({ baseUrl: 'https://example.com' });
            tokenStore(client).set(storedTokens);
            await client.get('/data');
            const [req] = fetchMock.mock.calls[0] as [Request];
            expect(req.headers.get('Authorization')).toBe('Bearer at-abc');
        });

        it('throws when token store is empty', async () => {
            const client = new HttpClient({ baseUrl: 'https://example.com' });
            await expect(client.get('/data')).rejects.toThrow(
                'No access token available. Call authenticate() first.',
            );
        });

        it('uses accessToken option over stored token', async () => {
            const client = new HttpClient({ baseUrl: 'https://example.com' });
            tokenStore(client).set(storedTokens);
            await client.get('/data', { accessToken: 'override-token' });
            const [req] = fetchMock.mock.calls[0] as [Request];
            expect(req.headers.get('Authorization')).toBe(
                'Bearer override-token',
            );
        });

        it('merges extra headers from options', async () => {
            const client = new HttpClient({ baseUrl: 'https://example.com' });
            tokenStore(client).set(storedTokens);
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

            const client = new HttpClient({ baseUrl: 'https://example.com' });
            tokenStore(client).set(storedTokens);
            await client.post('/items', { name: 'foo' });

            const [req] = fetchMock.mock.calls[0] as [Request];
            expect(req.method).toBe('POST');
            expect(req.headers.get('content-type')).toMatch('application/json');
            expect(JSON.parse(capturedBodyText)).toEqual({ name: 'foo' });
        });

        it('injects Bearer header when token is stored', async () => {
            const client = new HttpClient({ baseUrl: 'https://example.com' });
            tokenStore(client).set(storedTokens);
            await client.post('/items', {});
            const [req] = fetchMock.mock.calls[0] as [Request];
            expect(req.headers.get('Authorization')).toBe('Bearer at-abc');
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

            const client = new HttpClient({ baseUrl: 'https://example.com' });
            await client.postForm('/oauth2/token', {
                grant_type: 'client_credentials',
                scope: 'payment:create',
            });

            const [req] = fetchMock.mock.calls[0] as [Request];
            expect(req.method).toBe('POST');
            expect(req.headers.get('Content-Type')).toBe(
                'application/x-www-form-urlencoded',
            );
            const params = new URLSearchParams(capturedBodyText);
            expect(params.get('grant_type')).toBe('client_credentials');
            expect(params.get('scope')).toBe('payment:create');
        });

        it('does NOT inject Bearer on /oauth2/token', async () => {
            fetchMock.mockImplementation(async (req: Request) => {
                // consume body so fetch doesn't error
                await req.text();
                return makeResponse({});
            });

            const client = new HttpClient({ baseUrl: 'https://example.com' });
            tokenStore(client).set(storedTokens);
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

            const client = new HttpClient({ baseUrl: 'https://example.com' });
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

            const client = new HttpClient({ baseUrl: 'https://example.com' });
            const err = await client
                .postForm('/oauth2/token', { grant_type: 'client_credentials' })
                .catch((e: unknown) => e);

            expect(err).toBeInstanceOf(GoPayHTTPError);
            expect((err as GoPayHTTPError).status).toBe(401);
            expect((err as GoPayHTTPError).body).toEqual({
                error: 'UNAUTHORIZED',
            });
            expect((err as GoPayHTTPError).message).toBe(
                'HTTP 401: {"error":"UNAUTHORIZED"}',
            );
        });

        it('re-throws non-HTTPError as-is', async () => {
            fetchMock.mockRejectedValue(new TypeError('network failure'));

            const client = new HttpClient({ baseUrl: 'https://example.com' });
            await expect(
                client.postForm('/oauth2/token', {
                    grant_type: 'client_credentials',
                }),
            ).rejects.toThrow('network failure');
        });
    });

    // -------------------------------------------------------------------------
    // afterResponse hook — 401 handling
    // -------------------------------------------------------------------------

    describe('afterResponse hook', () => {
        it('passes through non-401 responses unchanged', async () => {
            fetchMock.mockResolvedValue(makeResponse({ data: 1 }, 200));

            const client = new HttpClient({ baseUrl: 'https://example.com' });
            tokenStore(client).set(storedTokens);
            const result = await client.get<{ data: number }>('/resource');
            expect(result).toEqual({ data: 1 });
        });

        it('passes through 401 on /oauth2/token without retrying', async () => {
            fetchMock.mockImplementation(async (req: Request) => {
                await req.text();
                return makeResponse({}, 401, 'Unauthorized');
            });

            const client = new HttpClient({ baseUrl: 'https://example.com' });
            const err = await client
                .postForm('/oauth2/token', {
                    grant_type: 'refresh_token',
                    refresh_token: 'rt',
                })
                .catch((e: unknown) => e);

            expect(err).toBeInstanceOf(GoPayHTTPError);
            expect((err as GoPayHTTPError).status).toBe(401);
            // fetch called exactly once — no retry
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        it('throws when 401 received and no refresh token available', async () => {
            fetchMock.mockResolvedValue(makeResponse({}, 401, 'Unauthorized'));

            const client = new HttpClient({ baseUrl: 'https://example.com' });
            tokenStore(client).set({ ...storedTokens, refresh_token: '' });
            const err = await client.get('/resource').catch((e: unknown) => e);
            expect(err).toBeInstanceOf(GoPaySDKError);
            expect((err as GoPaySDKError).message).toContain(
                'Session expired and no refresh token available',
            );
            expect(tokenStore(client).hasAccessToken()).toBe(false);
        });

        it('throws when 401 received and refresh call fails', async () => {
            let callCount = 0;
            fetchMock.mockImplementation(async (req: Request) => {
                callCount++;
                if (callCount === 1) {
                    // first call: original resource → 401
                    return makeResponse({}, 401, 'Unauthorized');
                }
                // second call: refresh token attempt → also 401
                await req.text();
                return makeResponse({}, 401, 'Unauthorized');
            });

            const client = new HttpClient({ baseUrl: 'https://example.com' });
            tokenStore(client).set(storedTokens);

            const err = await client.get('/resource').catch((e: unknown) => e);
            expect(err).toBeInstanceOf(GoPaySDKError);
            expect((err as GoPaySDKError).message).toContain(
                'Token refresh failed',
            );
            expect(tokenStore(client).hasAccessToken()).toBe(false);
        });

        it('retries with fresh token after successful refresh', async () => {
            let callCount = 0;
            fetchMock.mockImplementation(async (req: Request) => {
                callCount++;
                if (callCount === 1) {
                    // original request → 401
                    return makeResponse({}, 401, 'Unauthorized');
                }
                if (callCount === 2) {
                    // token refresh call
                    await req.text();
                    return makeResponse(freshTokens);
                }
                // retry of original request → 200
                return makeResponse({ result: 'ok' });
            });

            const client = new HttpClient({ baseUrl: 'https://example.com' });
            tokenStore(client).set(storedTokens);

            const result = await client.get<{ result: string }>('/resource');
            expect(result).toEqual({ result: 'ok' });
            expect(tokenStore(client).get()?.access_token).toBe('at-new');
            expect(fetchMock).toHaveBeenCalledTimes(3);

            // retry request should carry the new token
            const retryReq = fetchMock.mock.calls[2][0] as Request;
            expect(retryReq.headers.get('Authorization')).toBe('Bearer at-new');
        });

        it('throws when retry after refresh is also 401', async () => {
            let callCount = 0;
            fetchMock.mockImplementation(async (req: Request) => {
                callCount++;
                if (callCount === 1)
                    return makeResponse({}, 401, 'Unauthorized');
                if (callCount === 2) {
                    await req.text();
                    return makeResponse(freshTokens);
                }
                // retry → still 401
                return makeResponse({}, 401, 'Unauthorized');
            });

            const client = new HttpClient({ baseUrl: 'https://example.com' });
            tokenStore(client).set(storedTokens);

            const err = await client.get('/resource').catch((e: unknown) => e);
            expect(err).toBeInstanceOf(GoPaySDKError);
            expect((err as GoPaySDKError).message).toContain(
                'Request unauthorized after token refresh',
            );
            expect(tokenStore(client).hasAccessToken()).toBe(false);
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

        it('refreshes token proactively when expiring soon', async () => {
            let callCount = 0;
            fetchMock.mockImplementation(async (req: Request) => {
                callCount++;
                if (callCount === 1) {
                    // proactive refresh call
                    await req.text();
                    return makeResponse(freshTokens);
                }
                // original request
                return makeResponse({ result: 'ok' });
            });

            const client = new HttpClient({ baseUrl: 'https://example.com' });
            tokenStore(client).set(storedTokens); // issued_at = 0 (fake time)
            vi.advanceTimersByTime(871_000); // 29s left — within 30s buffer

            const result = await client.get<{ result: string }>('/resource');

            expect(result).toEqual({ result: 'ok' });
            expect(fetchMock).toHaveBeenCalledTimes(2);
            const refreshReq = fetchMock.mock.calls[0][0] as Request;
            expect(refreshReq.url).toContain('/oauth2/token');
            expect(tokenStore(client).get()?.access_token).toBe('at-new');
        });

        it('does not refresh proactively when token has plenty of time', async () => {
            const client = new HttpClient({ baseUrl: 'https://example.com' });
            tokenStore(client).set(storedTokens);
            vi.advanceTimersByTime(1_000); // 1s elapsed — well within expiry

            await client.get('/resource');

            expect(fetchMock).toHaveBeenCalledTimes(1);
            const [req] = fetchMock.mock.calls[0] as [Request];
            expect(req.url).not.toContain('/oauth2/token');
        });

        it('coalesces concurrent expiry-triggered refreshes into one network call', async () => {
            let refreshCallCount = 0;
            fetchMock.mockImplementation(async (req: Request) => {
                if (req.url.includes('/oauth2/token')) {
                    refreshCallCount++;
                    await req.text();
                    return makeResponse(freshTokens);
                }
                return makeResponse({ result: 'ok' });
            });

            const client = new HttpClient({ baseUrl: 'https://example.com' });
            tokenStore(client).set(storedTokens);
            vi.advanceTimersByTime(871_000);

            const [r1, r2] = await Promise.all([
                client.get('/resource'),
                client.get('/resource'),
            ]);

            expect(r1).toEqual({ result: 'ok' });
            expect(r2).toEqual({ result: 'ok' });
            expect(refreshCallCount).toBe(1);
            expect(tokenStore(client).get()?.access_token).toBe('at-new');
        });

        it('throws and clears store when proactive refresh has no refresh token', async () => {
            const client = new HttpClient({ baseUrl: 'https://example.com' });
            tokenStore(client).set({
                ...storedTokens,
                refresh_token: '',
            });
            vi.advanceTimersByTime(871_000);

            const err = await client.get('/resource').catch((e: unknown) => e);
            expect(err).toBeInstanceOf(GoPaySDKError);
            expect((err as GoPaySDKError).message).toContain(
                'Session expired and no refresh token available',
            );
            expect(tokenStore(client).hasAccessToken()).toBe(false);
        });
    });
});
