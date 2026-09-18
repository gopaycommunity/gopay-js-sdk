import { createHttpClient } from '@gopay-internal/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    GoPayErrorCodes,
    GoPayHTTPError,
    GoPaySDKError,
} from '../../src/errors.js';
import { createGoPaySDK } from '../../src/index.js';
import { makeResponse } from './helpers.js';

const storedTokens = {
    access_token: 'at-abc',
    expires_in: 900,
    token_type: 'bearer' as const,
};

/**
 * onError is the only hook an integrator has for wiring the SDK into their own
 * monitoring, so "the SDK threw" and "onError fired" have to mean the same
 * thing. They did not: only failures raised inside a request reached it, while
 * argument validation and the config guards — which run before any request goes
 * out — threw straight past it (GPOMA-2647).
 */
describe('error reporting to onError', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchMock = vi.fn().mockResolvedValue(makeResponse({ ok: true }));
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    describe('failures raised before a request is issued', () => {
        it('reports an invalid path segment', async () => {
            const onError = vi.fn();
            const sdk = createGoPaySDK({
                baseUrl: 'https://example.com',
                onError,
            });

            await expect(sdk.getPaymentStatus('')).rejects.toThrow(
                GoPaySDKError,
            );

            expect(onError).toHaveBeenCalledOnce();
            const err = onError.mock.calls[0]?.[0] as GoPaySDKError;
            expect(err.errorCode).toBe(GoPayErrorCodes.INVALID_ARGUMENT);
        });

        it('reports a traversal segment rejected by requirePathSegment', async () => {
            const onError = vi.fn();
            const sdk = createGoPaySDK({
                baseUrl: 'https://example.com',
                onError,
            });

            await expect(sdk.getPaymentStatus('..')).rejects.toThrow(
                GoPaySDKError,
            );

            expect(onError).toHaveBeenCalledOnce();
        });

        it('reports an invalid baseUrl at construction time', () => {
            const onError = vi.fn();

            expect(() =>
                createGoPaySDK({ baseUrl: 'not-a-url', onError }),
            ).toThrow(GoPaySDKError);

            expect(onError).toHaveBeenCalledOnce();
            const err = onError.mock.calls[0]?.[0] as GoPaySDKError;
            expect(err.errorCode).toBe(GoPayErrorCodes.INVALID_CONFIG);
        });

        it('reports a plain-HTTP baseUrl outside localhost', () => {
            const onError = vi.fn();

            expect(() =>
                createGoPaySDK({ baseUrl: 'http://example.com', onError }),
            ).toThrow(GoPaySDKError);

            expect(onError).toHaveBeenCalledOnce();
        });
    });

    describe('reports each failure exactly once', () => {
        it('does not re-report an HTTP error as it unwinds through the layers', async () => {
            const onError = vi.fn();
            fetchMock.mockImplementation(async (req: Request) => {
                if (req.url.includes('/oauth2/token')) {
                    return makeResponse(storedTokens);
                }
                return makeResponse({ error: 'NOT_FOUND' }, 404, 'Not Found');
            });

            const sdk = createGoPaySDK({
                baseUrl: 'https://example.com',
                onError,
            });
            // Authenticate for real: the assembled SDK deliberately exposes no
            // token setter, and without a token the call would fail on
            // AUTH_TOKEN_MISSING and never reach the HTTP error under test.
            await sdk.authenticate({
                grant_type: 'client_credentials',
                client_id: 'id',
                client_secret: 'secret',
                scope: 'payment:write',
            });
            expect(onError).not.toHaveBeenCalled();

            await sdk.getPaymentStatus('123').catch(() => {});

            // throwIfNotOk reports it, handleError sees it again, and the API
            // wrapper sees it a third time.
            expect(onError).toHaveBeenCalledOnce();
            const err = onError.mock.calls[0]?.[0] as GoPayHTTPError;
            expect(err).toBeInstanceOf(GoPayHTTPError);
            expect(err.status).toBe(404);
            expect(err.endpoint).toBe('/payments/{id}');
        });
    });

    describe('GoPayHTTPError request context', () => {
        it('carries the method and an id-free endpoint template', async () => {
            const onError = vi.fn();
            fetchMock.mockResolvedValue(
                makeResponse({ error: 'NOT_FOUND' }, 404, 'Not Found'),
            );

            const client = createHttpClient({
                baseUrl: 'https://example.com',
                onError,
            });
            client.tokenStore.set(storedTokens);

            await client.get('/payments/3050123456/charge').catch(() => {});

            const err = onError.mock.calls[0]?.[0] as GoPayHTTPError;
            expect(err).toBeInstanceOf(GoPayHTTPError);
            expect(err.method).toBe('GET');
            expect(err.endpoint).toBe('/payments/{id}/charge');
        });

        it('collapses a UUID segment and drops the query string', async () => {
            const onError = vi.fn();
            fetchMock.mockResolvedValue(makeResponse({}, 500, 'Server Error'));

            const client = createHttpClient({
                baseUrl: 'https://example.com',
                onError,
            });
            client.tokenStore.set(storedTokens);

            await client
                .get('/links/3a7f1e2c-9b4d-4f21-8c6e-1d2b3a4c5d6e?format=png')
                .catch(() => {});

            const err = onError.mock.calls[0]?.[0] as GoPayHTTPError;
            expect(err.endpoint).toBe('/links/{id}');
        });

        it('leaves a path with no id untouched', async () => {
            const onError = vi.fn();
            fetchMock.mockResolvedValue(makeResponse({}, 500, 'Server Error'));

            const client = createHttpClient({
                baseUrl: 'https://example.com',
                onError,
            });
            client.tokenStore.set(storedTokens);

            await client.get('/cards/browser-data').catch(() => {});

            const err = onError.mock.calls[0]?.[0] as GoPayHTTPError;
            expect(err.endpoint).toBe('/cards/browser-data');
        });
    });

    describe('a failing onError never replaces the SDK error', () => {
        it('still rejects with the original error when onError throws', async () => {
            const onError = vi.fn(() => {
                throw new Error('monitoring is down');
            });
            const sdk = createGoPaySDK({
                baseUrl: 'https://example.com',
                onError,
            });

            await expect(sdk.getPaymentStatus('')).rejects.toThrow(
                GoPaySDKError,
            );
            expect(onError).toHaveBeenCalledOnce();
        });

        /**
         * `onError` is declared `=> void`, and TypeScript accepts a function
         * returning anything at all wherever a void return is expected — so
         * `async onError` type-checks, and forwarding to an integrator's own
         * ingest (a network call) is exactly the shape that rejects after the
         * synchronous try block has exited. Left unadopted that is an unhandled
         * rejection, which on Node kills the process: the SDK's monitoring hook
         * would take down the app it was meant to observe.
         *
         * Asserted through promise adoption rather than a `process`
         * 'unhandledRejection' listener, because Vitest installs its own
         * handler for that event — a listener registered here never fires, so
         * that version of this test passed with the fix reverted. Measured
         * directly on plain Node instead: one unhandled rejection without the
         * fix, none with it.
         */
        it('adopts the promise an async onError returns, so its rejection cannot escape', async () => {
            let adopted = false;
            // Stands in for an async handler. Promise.resolve() adopts a
            // thenable by calling .then — which a bare `config.onError?.(error)`
            // never does, leaving the rejection to escape.
            const rejectingThenable = {
                // biome-ignore lint/suspicious/noThenProperty: a thenable is the subject under test — it is what an async onError returns.
                then(_ok: (v: unknown) => void, fail: (e: unknown) => void) {
                    adopted = true;
                    fail(new Error('ingest is down'));
                },
            };
            // No cast: assigning this to `(error) => void` is precisely the
            // TypeScript rule that lets the bug through in the first place.
            const onError = vi.fn(() => rejectingThenable);
            const sdk = createGoPaySDK({
                baseUrl: 'https://example.com',
                onError,
            });

            await expect(sdk.getPaymentStatus('')).rejects.toThrow(
                GoPaySDKError,
            );
            expect(onError).toHaveBeenCalledOnce();

            // Adoption happens on a microtask.
            await Promise.resolve();
            await Promise.resolve();
            expect(adopted).toBe(true);
        });

        it('still reports through an async onError that resolves', async () => {
            const seen: unknown[] = [];
            const onError = vi.fn(async (error: unknown) => {
                await Promise.resolve();
                seen.push(error);
            });
            const sdk = createGoPaySDK({
                baseUrl: 'https://example.com',
                onError,
            });

            await expect(sdk.getPaymentStatus('')).rejects.toThrow(
                GoPaySDKError,
            );

            await new Promise((resolve) => setTimeout(resolve, 10));
            expect(seen).toHaveLength(1);
            expect(seen[0]).toBeInstanceOf(GoPaySDKError);
        });
    });

    describe('successful calls', () => {
        it('does not report anything', async () => {
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
});
