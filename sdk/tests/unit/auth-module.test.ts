import { createHttpClient } from '@gopay-internal/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoPayErrorCodes, GoPaySDKError } from '../../src/errors.js';
import { createAuthApi } from '../../src/modules/auth/auth.module.js';

/** Build a minimal JWT with the given payload for testing setClientToken(). */
const makeJwt = (payload: Record<string, unknown>) => {
    const encodeB64 = (s: string) => btoa(s).replace(/=/g, '');
    return `${encodeB64('{"alg":"HS256"}')}.${encodeB64(JSON.stringify(payload))}.fakesig`;
};

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

    // -------------------------------------------------------------------------
    // setPublishableKey()
    // -------------------------------------------------------------------------

    describe('setPublishableKey()', () => {
        it('stores the key on the client', () => {
            auth.setPublishableKey('pk-test-123');
            expect(client.getPublishableKey()).toBe('pk-test-123');
        });

        it('overwrites a previously set key', () => {
            auth.setPublishableKey('pk-old');
            auth.setPublishableKey('pk-new');
            expect(client.getPublishableKey()).toBe('pk-new');
        });
    });

    // -------------------------------------------------------------------------
    // issueClientToken()
    // -------------------------------------------------------------------------

    describe('issueClientToken()', () => {
        beforeEach(() => {
            client.setClientCredentials('my-client', 'my-secret');
        });

        it('throws AUTH_CREDENTIALS_MISSING when credentials are not set', async () => {
            const freshClient = createHttpClient({
                baseUrl: 'https://example.com',
            });
            const freshAuth = createAuthApi(freshClient);

            const err = await freshAuth
                .issueClientToken()
                .catch((e: unknown) => e);

            expect(err).toBeInstanceOf(GoPaySDKError);
            expect((err as GoPaySDKError).errorCode).toBe(
                GoPayErrorCodes.AUTH_CREDENTIALS_MISSING,
            );
        });

        it('sends POST to /oauth2/token with Basic auth header', async () => {
            let capturedReq!: Request;
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                await req.text();
                return makeResponse(validTokenPair);
            });

            await auth.issueClientToken();

            expect(capturedReq.method).toBe('POST');
            expect(capturedReq.url).toBe('https://example.com/oauth2/token');
            expect(capturedReq.headers.get('Authorization')).toBe(
                `Basic ${btoa('my-client:my-secret')}`,
            );
        });

        it('uses default scope when none is provided', async () => {
            let capturedBody = '';
            fetchMock.mockImplementation(async (req: Request) => {
                capturedBody = await req.text();
                return makeResponse(validTokenPair);
            });

            await auth.issueClientToken();

            const params = new URLSearchParams(capturedBody);
            expect(params.get('scope')).toBe(
                'payment:read payment:charge shared:read',
            );
        });

        it('uses the provided scope', async () => {
            let capturedBody = '';
            fetchMock.mockImplementation(async (req: Request) => {
                capturedBody = await req.text();
                return makeResponse(validTokenPair);
            });

            await auth.issueClientToken('payment:create');

            const params = new URLSearchParams(capturedBody);
            expect(params.get('scope')).toBe('payment:create');
        });

        it('returns the token pair from the server', async () => {
            fetchMock.mockResolvedValue(makeResponse(validTokenPair));

            const result = await auth.issueClientToken();

            expect(result.access_token).toBe('at-abc');
            expect(result.refresh_token).toBe('rt-xyz');
            expect(result.expires_in).toBe(900);
        });

        it('throws AUTH_INVALID_RESPONSE when access_token is missing', async () => {
            fetchMock.mockResolvedValue(
                makeResponse({ ...validTokenPair, access_token: undefined }),
            );

            const err = await auth.issueClientToken().catch((e: unknown) => e);

            expect(err).toBeInstanceOf(GoPaySDKError);
            expect((err as GoPaySDKError).errorCode).toBe(
                GoPayErrorCodes.AUTH_INVALID_RESPONSE,
            );
        });

        it('throws AUTH_INVALID_RESPONSE when expires_in is missing', async () => {
            fetchMock.mockResolvedValue(
                makeResponse({ ...validTokenPair, expires_in: undefined }),
            );

            const err = await auth.issueClientToken().catch((e: unknown) => e);

            expect(err).toBeInstanceOf(GoPaySDKError);
            expect((err as GoPaySDKError).errorCode).toBe(
                GoPayErrorCodes.AUTH_INVALID_RESPONSE,
            );
        });
    });

    // -------------------------------------------------------------------------
    // setClientToken()
    // -------------------------------------------------------------------------

    describe('setClientToken()', () => {
        it('returns { authenticated: true } on success', () => {
            const token = makeJwt({
                sub: 'client-123',
                exp: Math.floor(Date.now() / 1000) + 3600,
            });

            const result = auth.setClientToken(token);

            expect(result).toEqual({ authenticated: true });
        });

        it('extracts client_id from the JWT sub claim', () => {
            const token = makeJwt({
                sub: 'my-client-id',
                exp: Math.floor(Date.now() / 1000) + 3600,
            });

            auth.setClientToken(token);

            expect(client.getClientId()).toBe('my-client-id');
        });

        it('stores the access token in the token store', () => {
            const token = makeJwt({
                sub: 'client-123',
                exp: Math.floor(Date.now() / 1000) + 3600,
            });

            auth.setClientToken(token);

            expect(client.tokenStore.get()?.access_token).toBe(token);
        });

        it('computes expires_in from the exp claim', () => {
            const futureExp = Math.floor(Date.now() / 1000) + 1800;
            const token = makeJwt({ sub: 'client-123', exp: futureExp });

            auth.setClientToken(token);

            const stored = client.tokenStore.get();
            expect(stored?.expires_in).toBeGreaterThan(0);
            expect(stored?.expires_in).toBeLessThanOrEqual(1800);
        });

        it('defaults expires_in to 3600 when exp is absent', () => {
            const token = makeJwt({ sub: 'client-123' });

            auth.setClientToken(token);

            expect(client.tokenStore.get()?.expires_in).toBe(3600);
        });

        it('throws AUTH_INVALID_TOKEN for a plain string that is not a JWT', () => {
            expect(() => auth.setClientToken('not-a-jwt')).toThrow(
                GoPaySDKError,
            );
            expect(() => auth.setClientToken('not-a-jwt')).toThrow(
                expect.objectContaining({
                    errorCode: GoPayErrorCodes.AUTH_INVALID_TOKEN,
                }),
            );
        });

        it('throws AUTH_INVALID_TOKEN when JWT has no sub claim', () => {
            const token = makeJwt({ role: 'user' });

            expect(() => auth.setClientToken(token)).toThrow(
                expect.objectContaining({
                    errorCode: GoPayErrorCodes.AUTH_INVALID_TOKEN,
                }),
            );
        });
    });

    // -------------------------------------------------------------------------
    // getBrowserKeys()
    // -------------------------------------------------------------------------

    describe('getBrowserKeys()', () => {
        it('throws AUTH_CREDENTIALS_MISSING when publishable key is not set', async () => {
            await auth.authenticate({
                grant_type: 'client_credentials',
                client_id: 'my-client',
                client_secret: 'my-secret',
                scope: 'payment:create',
            });

            expect(() => auth.getBrowserKeys()).toThrow(
                expect.objectContaining({
                    errorCode: GoPayErrorCodes.AUTH_CREDENTIALS_MISSING,
                }),
            );
        });

        it('throws AUTH_CREDENTIALS_MISSING when client_id is not set', () => {
            auth.setPublishableKey('pk-test');

            expect(() => auth.getBrowserKeys()).toThrow(
                expect.objectContaining({
                    errorCode: GoPayErrorCodes.AUTH_CREDENTIALS_MISSING,
                }),
            );
        });

        it('returns publishable_key and client_id when both are set', async () => {
            auth.setPublishableKey('pk-test-456');
            await auth.authenticate({
                grant_type: 'client_credentials',
                client_id: 'my-client',
                client_secret: 'my-secret',
                scope: 'payment:create',
            });

            const keys = auth.getBrowserKeys();

            expect(keys.publishable_key).toBe('pk-test-456');
            expect(keys.client_id).toBe('my-client');
        });
    });
});
