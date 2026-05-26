import { createHttpClient } from '@gopay-internal/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoPayErrorCodes, GoPaySDKError } from '../../src/errors.js';
import {
    createAuthApi,
    exchangePaymentCredentials,
} from '../../src/modules/auth/auth.module.js';

const makeResponse = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
    });

const validTokenPair = {
    access_token: 'at-browser-test',
    refresh_token: 'rt-browser-test',
    expires_in: 1800,
    refresh_expires_in: 86400,
    token_type: 'bearer',
};

describe('exchangePaymentCredentials()', () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    let client: ReturnType<typeof createHttpClient>;

    beforeEach(() => {
        fetchMock = vi.fn().mockResolvedValue(makeResponse(validTokenPair));
        vi.stubGlobal('fetch', fetchMock);
        client = createHttpClient({ baseUrl: 'https://example.com' });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('POSTs to /oauth2/token with payment_credentials grant type and Basic auth header', async () => {
        let capturedReq!: Request;
        let body = '';
        fetchMock.mockImplementation(async (req: Request) => {
            capturedReq = req;
            body = await req.text();
            return makeResponse(validTokenPair);
        });

        await exchangePaymentCredentials(client, 'pay-001', 'secret-abc');

        const params = new URLSearchParams(body);
        expect(params.get('grant_type')).toBe('payment_credentials');
        expect(params.get('authorization_code')).toBeNull();
        expect(params.get('client_id')).toBeNull();
        expect(capturedReq.headers.get('Authorization')).toBe(
            `Basic ${btoa('pay-001:secret-abc')}`,
        );
    });

    it('uses the default payment scope (includes payment:charge and payment:read)', async () => {
        let body = '';
        fetchMock.mockImplementation(async (req: Request) => {
            body = await req.text();
            return makeResponse(validTokenPair);
        });

        await exchangePaymentCredentials(client, 'pay-001', 'secret');

        const scope = new URLSearchParams(body).get('scope') ?? '';
        expect(scope).toContain('payment:charge');
        expect(scope).toContain('payment:read');
    });

    it('accepts a custom scope override', async () => {
        let body = '';
        fetchMock.mockImplementation(async (req: Request) => {
            body = await req.text();
            return makeResponse(validTokenPair);
        });

        await exchangePaymentCredentials(
            client,
            'pay-001',
            'secret',
            'payment:read',
        );

        expect(new URLSearchParams(body).get('scope')).toBe('payment:read');
    });

    it('stores the access token after a successful exchange', async () => {
        await exchangePaymentCredentials(client, 'pay-001', 'secret');
        expect(client.tokenStore.get()?.access_token).toBe('at-browser-test');
    });

    it('stores expires_in from the response', async () => {
        await exchangePaymentCredentials(client, 'pay-001', 'secret');
        expect(client.tokenStore.get()?.expires_in).toBe(1800);
    });

    it('defaults refresh_token to empty string when absent in the response', async () => {
        fetchMock.mockImplementation(async (req: Request) => {
            await req.text();
            return makeResponse({
                ...validTokenPair,
                refresh_token: undefined,
            });
        });

        await exchangePaymentCredentials(client, 'pay-001', 'secret');
        expect(client.tokenStore.get()?.refresh_token).toBe('');
    });

    it('throws GoPaySDKError(AUTH_INVALID_RESPONSE) when access_token is missing', async () => {
        fetchMock.mockImplementation(async (req: Request) => {
            await req.text();
            return makeResponse({ ...validTokenPair, access_token: undefined });
        });

        const err = await exchangePaymentCredentials(
            client,
            'pay-001',
            'secret',
        ).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(GoPaySDKError);
        expect((err as GoPaySDKError).errorCode).toBe(
            GoPayErrorCodes.AUTH_INVALID_RESPONSE,
        );
    });

    it('throws GoPaySDKError(AUTH_INVALID_RESPONSE) when expires_in is missing', async () => {
        fetchMock.mockImplementation(async (req: Request) => {
            await req.text();
            return makeResponse({ ...validTokenPair, expires_in: undefined });
        });

        const err = await exchangePaymentCredentials(
            client,
            'pay-001',
            'secret',
        ).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(GoPaySDKError);
        expect((err as GoPaySDKError).errorCode).toBe(
            GoPayErrorCodes.AUTH_INVALID_RESPONSE,
        );
    });

    it('does not store a token when the response is invalid', async () => {
        fetchMock.mockImplementation(async (req: Request) => {
            await req.text();
            return makeResponse({ ...validTokenPair, access_token: undefined });
        });

        await exchangePaymentCredentials(client, 'pay-001', 'secret').catch(
            () => {},
        );
        expect(client.tokenStore.get()).toBeNull();
    });

    it('defaults refresh_expires_in to 0 when absent in the response', async () => {
        fetchMock.mockImplementation(async (req: Request) => {
            await req.text();
            return makeResponse({
                ...validTokenPair,
                refresh_expires_in: undefined,
            });
        });
        await exchangePaymentCredentials(client, 'pay-001', 'secret');
        expect(client.tokenStore.get()?.refresh_expires_in).toBe(0);
    });
});

describe('createAuthApi()', () => {
    let client: ReturnType<typeof createHttpClient>;
    let auth: ReturnType<typeof createAuthApi>;

    const storedToken = {
        access_token: 'at',
        refresh_token: 'rt',
        expires_in: 900,
        refresh_expires_in: 0,
        token_type: 'bearer' as const,
    };

    beforeEach(() => {
        client = createHttpClient({ baseUrl: 'https://example.com' });
        auth = createAuthApi(client);
    });

    describe('isAuthenticated()', () => {
        it('returns false before any token is stored', () => {
            expect(auth.isAuthenticated()).toBe(false);
        });

        it('returns true after a token is stored', () => {
            client.setToken(storedToken);
            expect(auth.isAuthenticated()).toBe(true);
        });

        it('returns false after logout', () => {
            client.setToken(storedToken);
            auth.logout();
            expect(auth.isAuthenticated()).toBe(false);
        });
    });

    describe('logout()', () => {
        it('clears the token store', () => {
            client.setToken(storedToken);
            auth.logout();
            expect(client.tokenStore.get()).toBeNull();
        });
    });
});
