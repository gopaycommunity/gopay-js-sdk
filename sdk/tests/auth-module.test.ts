import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoPayErrorCodes, GoPaySDKError } from '../src/errors.js';
import { HttpClient } from '../src/http/client.js';
import type { TokenStore } from '../src/http/token-store.js';
import { AuthModule } from '../src/modules/auth/auth.module.js';
import type { ClientToken } from '../src/types/index.js';

const tokenStore = (client: HttpClient) =>
    (client as unknown as { tokenStore: TokenStore }).tokenStore;

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

/** Build a minimal fake JWT with the given sub claim. */
const makeJwt = (sub: string) => {
    const header = globalThis.btoa(
        JSON.stringify({ alg: 'RS256', typ: 'JWT' }),
    );
    const payload = globalThis.btoa(
        JSON.stringify({ sub, exp: 9_999_999_999 }),
    );
    return `${header}.${payload}.fake-sig`;
};

describe('AuthModule', () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    let client: HttpClient;
    let auth: AuthModule;

    beforeEach(() => {
        fetchMock = vi.fn().mockResolvedValue(makeResponse(validTokenPair));
        vi.stubGlobal('fetch', fetchMock);
        client = new HttpClient({ baseUrl: 'https://example.com' });
        auth = new AuthModule(client);
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

        const stored = tokenStore(client).get();
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

        expect(tokenStore(client).getClientId()).toBe('my-client');
        expect(tokenStore(client).getClientSecret()).toBe('my-secret');
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

        expect(tokenStore(client).hasAccessToken()).toBe(false);
    });

    // -------------------------------------------------------------------------
    // issueClientToken()
    // -------------------------------------------------------------------------

    describe('issueClientToken()', () => {
        beforeEach(async () => {
            // Authenticate server first to store credentials
            await auth.authenticate({
                grant_type: 'client_credentials',
                client_id: 'server-client',
                client_secret: 'server-secret',
                scope: 'payment:create payment:read',
            });
        });

        it('returns a ClientToken without storing it in the token store', async () => {
            const serverTokens = tokenStore(client).get();

            const clientTokenPair = {
                ...validTokenPair,
                access_token: 'client-at',
                refresh_token: 'client-rt',
            };
            fetchMock.mockResolvedValueOnce(makeResponse(clientTokenPair));

            const result = await auth.issueClientToken('payment:create');

            expect(result.access_token).toBe('client-at');
            expect(result.refresh_token).toBe('client-rt');
            expect(result.expires_in).toBe(900);
            expect(result.refresh_expires_in).toBe(86400);
            // Server's own token store is unchanged
            expect(tokenStore(client).get()).toEqual(serverTokens);
        });

        it('sends correct scope when provided', async () => {
            let capturedBody = '';
            fetchMock.mockImplementation(async (req: Request) => {
                capturedBody = await req.text();
                return makeResponse(validTokenPair);
            });

            await auth.issueClientToken('payment:create');

            const params = new URLSearchParams(capturedBody);
            expect(params.get('grant_type')).toBe('client_credentials');
            expect(params.get('scope')).toBe('payment:create');
        });

        it('omits scope when not provided', async () => {
            let capturedBody = '';
            fetchMock.mockImplementation(async (req: Request) => {
                capturedBody = await req.text();
                return makeResponse(validTokenPair);
            });

            await auth.issueClientToken();

            const params = new URLSearchParams(capturedBody);
            expect(params.has('scope')).toBe(false);
        });

        it('sends Basic Authorization header using stored credentials', async () => {
            let capturedReq!: Request;
            fetchMock.mockImplementation(async (req: Request) => {
                await req.text();
                capturedReq = req;
                return makeResponse(validTokenPair);
            });

            await auth.issueClientToken('payment:create');

            expect(capturedReq.headers.get('Authorization')).toBe(
                `Basic ${globalThis.btoa('server-client:server-secret')}`,
            );
        });

        it('throws GoPaySDKError when no credentials are stored', async () => {
            const freshClient = new HttpClient({
                baseUrl: 'https://example.com',
            });
            const freshAuth = new AuthModule(freshClient);

            const err = await freshAuth
                .issueClientToken()
                .catch((e: unknown) => e);
            expect(err).toBeInstanceOf(GoPaySDKError);
            expect((err as GoPaySDKError).errorCode).toBe(
                GoPayErrorCodes.AUTH_CREDENTIALS_MISSING,
            );
        });

        it('throws GoPaySDKError on invalid token response', async () => {
            fetchMock.mockResolvedValueOnce(
                makeResponse({ ...validTokenPair, access_token: undefined }),
            );

            await expect(auth.issueClientToken()).rejects.toThrow(
                GoPaySDKError,
            );
        });
    });

    // -------------------------------------------------------------------------
    // setClientToken() — browser client flow
    // -------------------------------------------------------------------------

    describe('setClientToken()', () => {
        const clientToken: ClientToken = {
            access_token: makeJwt('client-123'),
            refresh_token: 'rt-from-server',
            expires_in: 900,
            refresh_expires_in: 86400,
        };

        it('stores both tokens in the token store immediately', () => {
            auth.setClientToken(clientToken);

            expect(tokenStore(client).hasAccessToken()).toBe(true);
            expect(tokenStore(client).get()?.access_token).toBe(
                clientToken.access_token,
            );
            expect(tokenStore(client).getRefreshToken()).toBe('rt-from-server');
        });

        it('extracts client_id from the JWT sub claim', () => {
            auth.setClientToken(clientToken);

            expect(tokenStore(client).getClientId()).toBe('client-123');
        });

        it('stores expires_in and refresh_expires_in', () => {
            auth.setClientToken(clientToken);

            const stored = tokenStore(client).get();
            expect(stored?.expires_in).toBe(900);
            expect(stored?.refresh_expires_in).toBe(86400);
        });

        it('throws GoPaySDKError when JWT is malformed', () => {
            let err: unknown;
            try {
                auth.setClientToken({
                    ...clientToken,
                    access_token: 'not-a-jwt',
                });
            } catch (e) {
                err = e;
            }
            expect(err).toBeInstanceOf(GoPaySDKError);
            expect((err as GoPaySDKError).errorCode).toBe(
                GoPayErrorCodes.AUTH_INVALID_TOKEN,
            );
        });

        it('throws GoPaySDKError when JWT is missing sub claim', () => {
            const noSub = globalThis.btoa(JSON.stringify({ alg: 'RS256' }));
            const noSubPayload = globalThis.btoa(
                JSON.stringify({ exp: 9_999_999_999 }),
            );
            const jwtNoSub = `${noSub}.${noSubPayload}.fake-sig`;

            expect(() =>
                auth.setClientToken({ ...clientToken, access_token: jwtNoSub }),
            ).toThrow(GoPaySDKError);
        });
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

        it('returns true after setClientToken', () => {
            auth.setClientToken({
                access_token: makeJwt('client-123'),
                refresh_token: 'rt',
                expires_in: 900,
                refresh_expires_in: 86400,
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
            const clientWithCallback = new HttpClient({
                baseUrl: 'https://example.com',
                onError,
            });
            const authWithCallback = new AuthModule(clientWithCallback);

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

        it('is called when no credentials are stored for issueClientToken', async () => {
            const onError = vi.fn();
            const clientWithCallback = new HttpClient({
                baseUrl: 'https://example.com',
                onError,
            });
            const authWithCallback = new AuthModule(clientWithCallback);

            await authWithCallback.issueClientToken().catch(() => {});

            expect(onError).toHaveBeenCalledOnce();
            const err = onError.mock.calls[0][0] as GoPaySDKError;
            expect(err.errorCode).toBe(
                GoPayErrorCodes.AUTH_CREDENTIALS_MISSING,
            );
        });
    });
});
