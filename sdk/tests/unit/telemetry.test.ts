import { type ApiCallRecord, createHttpClient } from '@gopay-internal/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    GoPayErrorCodes,
    type GoPayHTTPError,
    GoPaySDKError,
} from '../../src/errors.js';
import { makeResponse } from './helpers.js';

/**
 * The timing seam (GPOMA-2631). What the browser SDK ships to gw-logger is
 * decided in browser-sdk/src/logging; what core owes it is one record per HTTP
 * call, with a status that distinguishes "the API answered" from "nothing came
 * back", and one record per SDK-raised failure.
 */
describe('telemetry from the HTTP client', () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    const makeTelemetrySpy = () => ({
        apiCall: vi.fn<(record: ApiCallRecord) => void>(),
        error: vi.fn<(error: GoPaySDKError | GoPayHTTPError) => void>(),
    });
    let telemetry: ReturnType<typeof makeTelemetrySpy>;

    const storedTokens = {
        access_token: 'at-abc',
        expires_in: 900,
        token_type: 'bearer' as const,
    };

    const makeClient = () => {
        const client = createHttpClient(
            { baseUrl: 'https://example.com' },
            undefined,
            telemetry,
        );
        client.tokenStore.set(storedTokens);
        return client;
    };

    beforeEach(() => {
        // A fresh Response per call: a body can only be read once, and
        // these tests issue several requests against the same mock.
        fetchMock = vi.fn(() => Promise.resolve(makeResponse({ ok: true })));
        vi.stubGlobal('fetch', fetchMock);
        telemetry = makeTelemetrySpy();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('records a successful call with its status and endpoint template', async () => {
        await makeClient().get('/payments/300000001');

        expect(telemetry.apiCall).toHaveBeenCalledOnce();
        expect(telemetry.apiCall.mock.calls[0]?.[0]).toMatchObject({
            method: 'GET',
            endpoint: '/payments/{id}',
            statusCode: 200,
        });
    });

    it('measures a duration rather than reporting a placeholder', async () => {
        await makeClient().get('/payments/300000001');

        const durationMs = telemetry.apiCall.mock.calls[0]?.[0]
            .durationMs as number;
        expect(Number.isFinite(durationMs)).toBe(true);
        expect(durationMs).toBeGreaterThanOrEqual(0);
    });

    it('records the HTTP status when the API refuses the call', async () => {
        fetchMock.mockImplementation(() =>
            Promise.resolve(makeResponse({ err: 'nope' }, 404)),
        );

        await expect(makeClient().get('/payments/300000001')).rejects.toThrow();

        expect(telemetry.apiCall.mock.calls[0]?.[0]).toMatchObject({
            statusCode: 404,
            endpoint: '/payments/{id}',
        });
    });

    it('records a null status when nothing came back at all', async () => {
        fetchMock.mockRejectedValue(new Error('network down'));

        await expect(makeClient().get('/payments/300000001')).rejects.toThrow();

        expect(telemetry.apiCall.mock.calls[0]?.[0]).toMatchObject({
            statusCode: null,
        });
    });

    it('records POST, DELETE and form posts too, not only GET', async () => {
        const client = makeClient();
        await client.post('/payments', { amount: 1 });
        await client.delete('/cards/abc');
        await client.postForm('/oauth2/token', { grant_type: 'x' });

        expect(telemetry.apiCall.mock.calls.map(([r]) => r.method)).toEqual([
            'POST',
            'DELETE',
            'POST',
        ]);
    });

    it('reports the config failure that happens before the client even exists', () => {
        // resolveBaseUrl runs before emitError exists, so this is the one error
        // guaranteed to happen at construction time — and the one that would
        // otherwise never be recorded anywhere.
        expect(() =>
            createHttpClient({ baseUrl: 'not-a-url' }, undefined, telemetry),
        ).toThrow(GoPaySDKError);

        expect(telemetry.error).toHaveBeenCalledOnce();
        const reported = telemetry.error.mock.calls[0]?.[0] as GoPaySDKError;
        expect(reported.errorCode).toBe(GoPayErrorCodes.INVALID_CONFIG);
    });

    it('reports one SDK failure once, however many layers it crossed', async () => {
        fetchMock.mockRejectedValue(new Error('network down'));

        await expect(makeClient().get('/payments/1')).rejects.toThrow();

        // handleError wraps it and emitError reports it; the WeakSet in
        // reportOnce is what keeps that a single record.
        expect(telemetry.error).toHaveBeenCalledOnce();
    });

    it('never routes an HTTP error to error() — apiCall already carried it', async () => {
        fetchMock.mockImplementation(() =>
            Promise.resolve(makeResponse({ err: 'nope' }, 500)),
        );

        await expect(makeClient().get('/payments/1')).rejects.toThrow();

        expect(telemetry.apiCall).toHaveBeenCalledOnce();
        expect(telemetry.error).not.toHaveBeenCalled();
    });

    it('records nothing for a failure that happened before any request went out', async () => {
        // No stored tokens and no client credentials: injectAuth raises
        // AUTH_TOKEN_MISSING and fetch is never called. record() lives in a
        // `finally`, so this used to emit an api_call with `status_code: null`
        // — which downstream means "issued, no response". One failure became a
        // phantom network error on an endpoint nothing ever called, alongside
        // the SDK.<CODE> event that already described it correctly.
        const client = createHttpClient(
            { baseUrl: 'https://example.com' },
            undefined,
            telemetry,
        );

        await expect(client.get('/payments/300000001')).rejects.toThrow();

        expect(fetchMock).not.toHaveBeenCalled();
        expect(telemetry.apiCall).not.toHaveBeenCalled();
        expect(telemetry.error).toHaveBeenCalledOnce();
        expect(
            (telemetry.error.mock.calls[0]?.[0] as GoPaySDKError).errorCode,
        ).toBe(GoPayErrorCodes.AUTH_TOKEN_MISSING);
    });

    it('works with no telemetry installed, which is what the server SDK does', async () => {
        const plain = createHttpClient({ baseUrl: 'https://example.com' });
        plain.tokenStore.set(storedTokens);

        await expect(plain.get('/payments/1')).resolves.toBeDefined();
    });
});

/**
 * The auth handler issues two requests of its own — the client-credentials
 * token fetch and the retry a 401 triggers — through raw `fetch` rather than
 * through the verb methods. Until GPOMA-2631 they were the only traffic the SDK
 * makes that no record described, so a re-auth storm looked like silence.
 */
describe('telemetry from the auth handler', () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    const makeTelemetrySpy = () => ({
        apiCall: vi.fn<(record: ApiCallRecord) => void>(),
        error: vi.fn<(error: GoPaySDKError | GoPayHTTPError) => void>(),
    });
    let telemetry: ReturnType<typeof makeTelemetrySpy>;

    const tokenResponse = () =>
        makeResponse({ access_token: 'fresh-at', expires_in: 900 });

    const makeClient = () => {
        const client = createHttpClient(
            { baseUrl: 'https://example.com' },
            undefined,
            telemetry,
        );
        client.tokenStore.setClientSecret('cid', 'secret', 'payment:read');
        return client;
    };

    const records = () =>
        telemetry.apiCall.mock.calls.map(([r]) => ({
            method: r.method,
            endpoint: r.endpoint,
            statusCode: r.statusCode,
        }));

    beforeEach(() => {
        telemetry = makeTelemetrySpy();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('records the token call it makes to refresh an expiring token', async () => {
        fetchMock = vi.fn((req: Request) =>
            Promise.resolve(
                req.url.includes('/oauth2/token')
                    ? tokenResponse()
                    : makeResponse({ ok: true }),
            ),
        );
        vi.stubGlobal('fetch', fetchMock);

        const client = makeClient();
        // expires_in 0 puts it inside isExpiringSoon's buffer, which is what
        // sends injectAuth through refresh() before the request goes out.
        client.tokenStore.set({
            access_token: 'stale-at',
            expires_in: 0,
            token_type: 'bearer',
        });

        await client.get('/payments/300000001');

        expect(records()).toEqual([
            { method: 'POST', endpoint: '/oauth2/token', statusCode: 200 },
            { method: 'GET', endpoint: '/payments/{id}', statusCode: 200 },
        ]);
    });

    it('records the refresh a 401 triggers, and leaves the retry to the verb method', async () => {
        let rejectedOnce = false;
        fetchMock = vi.fn((req: Request) => {
            if (req.url.includes('/oauth2/token')) {
                return Promise.resolve(tokenResponse());
            }
            if (!rejectedOnce) {
                rejectedOnce = true;
                return Promise.resolve(makeResponse({ err: 'stale' }, 401));
            }
            return Promise.resolve(makeResponse({ ok: true }));
        });
        vi.stubGlobal('fetch', fetchMock);

        const client = makeClient();
        client.tokenStore.set({
            access_token: 'at-abc',
            expires_in: 900,
            token_type: 'bearer',
        });

        await client.get('/payments/300000001');

        // Two records, not three. The retry is the same logical call as the
        // one the verb method already records in its `finally`, and the
        // handler could only name its endpoint by parsing the URL — which
        // carries the API base path, so the two rows would not even group
        // together. One call, one row, plus the refresh that caused it.
        expect(records()).toEqual([
            { method: 'POST', endpoint: '/oauth2/token', statusCode: 200 },
            { method: 'GET', endpoint: '/payments/{id}', statusCode: 200 },
        ]);
    });

    it('records the token call that fails, which is the one worth seeing', async () => {
        fetchMock = vi.fn((req: Request) =>
            Promise.resolve(
                req.url.includes('/oauth2/token')
                    ? makeResponse({ err: 'bad client' }, 401)
                    : makeResponse({ ok: true }),
            ),
        );
        vi.stubGlobal('fetch', fetchMock);

        const client = makeClient();
        client.tokenStore.set({
            access_token: 'stale-at',
            expires_in: 0,
            token_type: 'bearer',
        });

        await expect(client.get('/payments/300000001')).rejects.toThrow();

        expect(records()[0]).toEqual({
            method: 'POST',
            endpoint: '/oauth2/token',
            statusCode: 401,
        });
    });
});
