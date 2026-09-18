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

    it('works with no telemetry installed, which is what the server SDK does', async () => {
        const plain = createHttpClient({ baseUrl: 'https://example.com' });
        plain.tokenStore.set(storedTokens);

        await expect(plain.get('/payments/1')).resolves.toBeDefined();
    });
});
