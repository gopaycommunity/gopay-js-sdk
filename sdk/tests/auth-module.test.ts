import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpClient } from '../src/http/client.js';
import type { TokenStore } from '../src/http/token-store.js';
import { AuthModule } from '../src/modules/auth/auth.module.js';

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
    // Token store population
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

    // -------------------------------------------------------------------------
    // refresh_token optional fields
    // -------------------------------------------------------------------------

    it('omits client_id from form when not provided in refresh_token grant', async () => {
        let capturedBodyText = '';
        fetchMock.mockImplementation(async (req: Request) => {
            capturedBodyText = await req.text();
            return makeResponse(validTokenPair);
        });

        await auth.authenticate({
            grant_type: 'refresh_token',
            refresh_token: 'rt-xyz',
        });

        const params = new URLSearchParams(capturedBodyText);
        expect(params.has('client_id')).toBe(false);
    });

    it('includes client_id in form when provided in refresh_token grant', async () => {
        let capturedBodyText = '';
        fetchMock.mockImplementation(async (req: Request) => {
            capturedBodyText = await req.text();
            return makeResponse(validTokenPair);
        });

        await auth.authenticate({
            grant_type: 'refresh_token',
            refresh_token: 'rt-xyz',
            client_id: 'my-client',
        });

        const params = new URLSearchParams(capturedBodyText);
        expect(params.get('client_id')).toBe('my-client');
    });

    it('omits scope from form when not provided in refresh_token grant', async () => {
        let capturedBodyText = '';
        fetchMock.mockImplementation(async (req: Request) => {
            capturedBodyText = await req.text();
            return makeResponse(validTokenPair);
        });

        await auth.authenticate({
            grant_type: 'refresh_token',
            refresh_token: 'rt-xyz',
        });

        const params = new URLSearchParams(capturedBodyText);
        expect(params.has('scope')).toBe(false);
    });

    it('includes scope in form when provided in refresh_token grant', async () => {
        let capturedBodyText = '';
        fetchMock.mockImplementation(async (req: Request) => {
            capturedBodyText = await req.text();
            return makeResponse(validTokenPair);
        });

        await auth.authenticate({
            grant_type: 'refresh_token',
            refresh_token: 'rt-xyz',
            scope: 'payment:read',
        });

        const params = new URLSearchParams(capturedBodyText);
        expect(params.get('scope')).toBe('payment:read');
    });

    // -------------------------------------------------------------------------
    // Invalid token response
    // -------------------------------------------------------------------------

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
    ])('throws on invalid token response: %s', async (_, partial) => {
        fetchMock.mockImplementation(async (req: Request) => {
            await req.text();
            return makeResponse(partial);
        });

        await expect(
            auth.authenticate({
                grant_type: 'client_credentials',
                client_id: 'id',
                client_secret: 'secret',
                scope: 'payment:create',
            }),
        ).rejects.toThrow('Invalid token response: missing required fields.');
    });

    // -------------------------------------------------------------------------
    // setRefreshToken() — browser client flow
    // -------------------------------------------------------------------------

    it('setRefreshToken() stores the token and triggers exchange on first API call', async () => {
        auth.setRefreshToken('rt-from-server');

        expect(tokenStore(client).hasPendingRefreshToken()).toBe(true);
        expect(tokenStore(client).hasAccessToken()).toBe(false);

        // Simulate what the http client does: exchange pending refresh token
        let capturedBodyText = '';
        fetchMock.mockImplementation(async (req: Request) => {
            capturedBodyText = await req.text();
            return makeResponse(validTokenPair);
        });

        await auth.authenticate({
            grant_type: 'refresh_token',
            refresh_token: 'rt-from-server',
        });

        const params = new URLSearchParams(capturedBodyText);
        expect(params.get('grant_type')).toBe('refresh_token');
        expect(params.get('refresh_token')).toBe('rt-from-server');
        expect(tokenStore(client).hasAccessToken()).toBe(true);
        expect(tokenStore(client).hasPendingRefreshToken()).toBe(false);
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
});
