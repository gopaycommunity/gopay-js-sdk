import { createHttpClient } from '@gopay-internal/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoPayErrorCodes, GoPaySDKError } from '../../src/errors.js';
import { createAuthApi } from '../../src/modules/auth/auth.module.js';

const validTokenPair = {
    token_type: 'bearer' as const,
    access_token: 'at-abc',
    refresh_token: 'rt-xyz',
    scope: 'payment:create',
    expires_in: 900,
    refresh_expires_in: 86400,
};

const makeResponse = (data: unknown, status = 200, statusText = 'OK') =>
    new Response(JSON.stringify(data), {
        status,
        statusText,
        headers: { 'content-type': 'application/json' },
    });

describe('AuthModule', () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    let client: ReturnType<typeof createHttpClient>;
    let auth: ReturnType<typeof createAuthApi>;

    beforeEach(() => {
        fetchMock = vi.fn().mockResolvedValue(makeResponse(validTokenPair));
        vi.stubGlobal('fetch', fetchMock);
        client = createHttpClient({ baseUrl: 'https://example.com' });
        auth = createAuthApi(client);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // -------------------------------------------------------------------------
    // authenticate() — client_credentials only
    // -------------------------------------------------------------------------

    it('stores the token pair in the token store after success', async () => {
        await auth.authenticate({
            grant_type: 'client_credentials',
            client_id: 'id',
            client_secret: 'secret',
            scope: 'payment:create',
        });

        const stored = client.tokenStore.get();
        expect(stored?.access_token).toBe('at-abc');
        expect(stored?.refresh_token).toBe('rt-xyz');
        expect(stored?.expires_in).toBe(900);
        expect(stored?.refresh_expires_in).toBe(86400);
        expect(stored?.token_type).toBe('bearer');
        expect(stored?.issued_at).toBeTypeOf('number');
    });

    it('stores client credentials for future token refresh', async () => {
        await auth.authenticate({
            grant_type: 'client_credentials',
            client_id: 'my-client',
            client_secret: 'my-secret',
            scope: 'payment:create',
        });

        expect(client.tokenStore.getClientId()).toBe('my-client');
        expect(client.tokenStore.getClientSecret()).toBe('my-secret');
    });

    it.each([
        [
            'missing access_token',
            { ...validTokenPair, access_token: undefined },
        ],
        [
            'missing refresh_token',
            { ...validTokenPair, refresh_token: undefined },
        ],
        ['missing expires_in', { ...validTokenPair, expires_in: undefined }],
        [
            'missing refresh_expires_in',
            { ...validTokenPair, refresh_expires_in: undefined },
        ],
    ])('throws GoPaySDKError on invalid token response: %s', async (_, partial) => {
        fetchMock.mockImplementation(async (req: Request) => {
            await req.text();
            return makeResponse(partial);
        });

        const err = await auth
            .authenticate({
                grant_type: 'client_credentials',
                client_id: 'id',
                client_secret: 'secret',
                scope: 'payment:create',
            })
            .catch((e: unknown) => e);

        expect(err).toBeInstanceOf(GoPaySDKError);
        expect((err as GoPaySDKError).message).toContain(
            'Invalid token response: missing required fields.',
        );
        expect((err as GoPaySDKError).errorCode).toBe(
            GoPayErrorCodes.AUTH_INVALID_RESPONSE,
        );
    });

    it('does not populate token store when token response is invalid', async () => {
        fetchMock.mockImplementation(async (req: Request) => {
            await req.text();
            return makeResponse({ ...validTokenPair, access_token: undefined });
        });

        await expect(
            auth.authenticate({
                grant_type: 'client_credentials',
                client_id: 'id',
                client_secret: 'secret',
                scope: 'payment:create',
            }),
        ).rejects.toThrow();

        expect(client.tokenStore.hasAccessToken()).toBe(false);
    });

    // -------------------------------------------------------------------------
    // isAuthenticated()
    // -------------------------------------------------------------------------

    describe('isAuthenticated()', () => {
        it('returns false before authenticate', () => {
            expect(auth.isAuthenticated()).toBe(false);
        });

        it('returns true after authenticate', async () => {
            await auth.authenticate({
                grant_type: 'client_credentials',
                client_id: 'id',
                client_secret: 'secret',
                scope: 'payment:create',
            });
            expect(auth.isAuthenticated()).toBe(true);
        });

        it('returns false after logout', async () => {
            await auth.authenticate({
                grant_type: 'client_credentials',
                client_id: 'id',
                client_secret: 'secret',
                scope: 'payment:create',
            });
            auth.logout();
            expect(auth.isAuthenticated()).toBe(false);
        });
    });

    // -------------------------------------------------------------------------
    // logout()
    // -------------------------------------------------------------------------

    describe('logout()', () => {
        it('clears token so next API call throws AUTH_TOKEN_MISSING', async () => {
            await auth.authenticate({
                grant_type: 'client_credentials',
                client_id: 'id',
                client_secret: 'secret',
                scope: 'payment:create',
            });
            auth.logout();

            const err = await client.get('/resource').catch((e: unknown) => e);
            expect(err).toBeInstanceOf(GoPaySDKError);
            expect((err as GoPaySDKError).errorCode).toBe(
                GoPayErrorCodes.AUTH_TOKEN_MISSING,
            );
        });
    });

    // -------------------------------------------------------------------------
    // onError callback
    // -------------------------------------------------------------------------

    describe('onError callback', () => {
        it('is called when authenticate returns invalid token response', async () => {
            const onError = vi.fn();
            const clientWithCallback = createHttpClient({
                baseUrl: 'https://example.com',
                onError,
            });
            const authWithCallback = createAuthApi(clientWithCallback);

            fetchMock.mockImplementation(async (req: Request) => {
                await req.text();
                return makeResponse({
                    ...validTokenPair,
                    access_token: undefined,
                });
            });

            await authWithCallback
                .authenticate({
                    grant_type: 'client_credentials',
                    client_id: 'id',
                    client_secret: 'secret',
                    scope: 'payment:create',
                })
                .catch(() => {});

            expect(onError).toHaveBeenCalledOnce();
            const err = onError.mock.calls[0][0] as GoPaySDKError;
            expect(err).toBeInstanceOf(GoPaySDKError);
            expect(err.errorCode).toBe(GoPayErrorCodes.AUTH_INVALID_RESPONSE);
        });
    });
});
