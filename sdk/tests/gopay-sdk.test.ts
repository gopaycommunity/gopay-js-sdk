import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpClient } from '../src/http/client.js';
import { GoPaySDK } from '../src/index.js';
import type { components } from '../src/types/generated.js';

type TokenPair =
    components['responses']['Token-Pair-Response']['content']['application/json'];

// Expose protected buildUrl for testing
class TestHttpClient extends HttpClient {
    public buildUrlPublic(path: string): string {
        return this.buildUrl(path);
    }
}

describe('HttpClient.buildUrl', () => {
    it.each([
        // [description, baseUrl, path, expected]
        [
            'base without trailing slash, path without leading slash',
            'https://api.sandbox.gopay.com/api/v4',
            'oauth2/token',
            'https://api.sandbox.gopay.com/api/v4/oauth2/token',
        ],
        [
            'base without trailing slash, path with leading slash',
            'https://api.sandbox.gopay.com/api/v4',
            '/oauth2/token',
            'https://api.sandbox.gopay.com/api/v4/oauth2/token',
        ],
        [
            'base with trailing slash, path without leading slash',
            'https://api.sandbox.gopay.com/api/v4/',
            'oauth2/token',
            'https://api.sandbox.gopay.com/api/v4/oauth2/token',
        ],
        [
            'base with trailing slash, path with leading slash',
            'https://api.sandbox.gopay.com/api/v4/',
            '/oauth2/token',
            'https://api.sandbox.gopay.com/api/v4/oauth2/token',
        ],
        [
            'path does not strip base path segments',
            'https://api.sandbox.gopay.com/api/v4',
            '/encryption/public-key',
            'https://api.sandbox.gopay.com/api/v4/encryption/public-key',
        ],
    ])('%s', (_, baseUrl, path, expected) => {
        const client = new TestHttpClient({ baseUrl });
        expect(client.buildUrlPublic(path)).toBe(expected);
    });

    it('uses sandbox base URL by default', () => {
        const client = new TestHttpClient({});
        expect(client.buildUrlPublic('oauth2/token')).toBe(
            'https://api.sandbox.gopay.com/api/merchant/payments/4.0/oauth2/token',
        );
    });

    it('uses production base URL when environment is production', () => {
        const client = new TestHttpClient({ environment: 'production' });
        expect(client.buildUrlPublic('oauth2/token')).toBe(
            'https://api.gopay.com/api/merchant/payments/4.0/oauth2/token',
        );
    });
});

describe('GoPaySDK', () => {
    it('instantiates with default config', () => {
        const sdk = new GoPaySDK();
        expect(sdk).toBeInstanceOf(GoPaySDK);
    });

    it('exposes all sub-modules', () => {
        const sdk = new GoPaySDK({ environment: 'sandbox' });
        expect(sdk.auth).toBeDefined();
        expect(sdk.payments).toBeDefined();
        expect(sdk.cards).toBeDefined();
        expect(sdk.encryption).toBeDefined();
    });

    describe('AuthModule', () => {
        const mockTokenPair = {
            token_type: 'bearer' as const,
            access_token: 'access_abc123',
            refresh_token: 'refresh_xyz789',
            scope: 'payment:create',
            expires_in: 3600,
            refresh_expires_in: 86400,
        } satisfies TokenPair;

        beforeEach(() => {
            vi.stubGlobal(
                'fetch',
                vi.fn().mockResolvedValue({
                    ok: true,
                    json: () => Promise.resolve(mockTokenPair),
                }),
            );
            vi.spyOn(console, 'log').mockImplementation(() => {});
        });

        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('exposes authenticate()', () => {
            const sdk = new GoPaySDK();
            expect(typeof sdk.auth.authenticate).toBe('function');
        });

        it('authenticate() with client_credentials sends correct request', async () => {
            const sdk = new GoPaySDK({ environment: 'sandbox' });
            const result = await sdk.auth.authenticate({
                grant_type: 'client_credentials',
                client_id: 'my-client',
                client_secret: 'my-secret',
                scope: 'payment:create',
            });

            expect(result).toEqual(mockTokenPair);

            const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock
                .calls[0];
            expect(url).toBe(
                'https://api.sandbox.gopay.com/api/merchant/payments/4.0/oauth2/token',
            );
            expect(init.method).toBe('POST');
            expect(init.headers['Content-Type']).toBe(
                'application/x-www-form-urlencoded',
            );
            expect(init.headers.Authorization).toBe(
                `Basic ${btoa('my-client:my-secret')}`,
            );
            const body = new URLSearchParams(init.body);
            expect(body.get('grant_type')).toBe('client_credentials');
            expect(body.get('scope')).toBe('payment:create');
        });

        it('authenticate() with refresh_token sends correct request', async () => {
            const sdk = new GoPaySDK({ environment: 'sandbox' });
            const result = await sdk.auth.authenticate({
                grant_type: 'refresh_token',
                refresh_token: 'refresh_xyz789',
                scope: 'payment:create',
            });

            expect(result).toEqual(mockTokenPair);

            const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
            expect(init.headers.Authorization).toBeUndefined();
            const body = new URLSearchParams(init.body);
            expect(body.get('grant_type')).toBe('refresh_token');
            expect(body.get('refresh_token')).toBe('refresh_xyz789');
            expect(body.get('scope')).toBe('payment:create');
        });

        it('authenticate() logs the token pair to console', async () => {
            const sdk = new GoPaySDK();
            await sdk.auth.authenticate({
                grant_type: 'client_credentials',
                client_id: 'my-client',
                client_secret: 'my-secret',
                scope: 'payment:create',
            });

            expect(console.log).toHaveBeenCalledWith(
                '[GoPaySDK] authenticate response:',
                mockTokenPair,
            );
        });

        it('authenticate() throws on non-ok HTTP response', async () => {
            vi.stubGlobal(
                'fetch',
                vi.fn().mockResolvedValue({
                    ok: false,
                    status: 401,
                    statusText: 'Unauthorized',
                }),
            );
            const sdk = new GoPaySDK();
            await expect(
                sdk.auth.authenticate({
                    grant_type: 'client_credentials',
                    client_id: 'bad-client',
                    client_secret: 'bad-secret',
                    scope: 'payment:create',
                }),
            ).rejects.toThrow('HTTP 401: Unauthorized');
        });
    });

    describe('EncryptionModule', () => {
        it('exposes fetchPublicKey()', () => {
            const sdk = new GoPaySDK();
            expect(typeof sdk.encryption.fetchPublicKey).toBe('function');
        });

        it('fetchPublicKey() throws Not implemented', async () => {
            const sdk = new GoPaySDK();
            await expect(sdk.encryption.fetchPublicKey()).rejects.toThrow(
                'Not implemented',
            );
        });
    });

    describe('CardsModule', () => {
        it('exposes createToken()', () => {
            const sdk = new GoPaySDK();
            expect(typeof sdk.cards.createToken).toBe('function');
        });

        it('createToken() throws Not implemented', async () => {
            const sdk = new GoPaySDK();
            await expect(
                sdk.cards.createToken({ payload: 'encrypted' }),
            ).rejects.toThrow('Not implemented');
        });
    });

    describe('PaymentsModule', () => {
        const paymentMethods = [
            'create',
            'charge',
            'getGooglePayInfo',
            'getApplePayInfo',
            'validateApplePayMerchant',
        ] as const;

        it.each(paymentMethods)('exposes %s()', (method) => {
            const sdk = new GoPaySDK();
            expect(typeof sdk.payments[method]).toBe('function');
        });

        it('create() throws Not implemented', async () => {
            const sdk = new GoPaySDK();
            await expect(
                sdk.payments.create('test-goid', {
                    amount: 1000,
                    currency: 'CZK',
                    order_number: 'ORDER-001',
                    customer: { email: 'test@example.com' },
                    callback: {
                        notification_url: 'https://example.com/notify',
                        return_url: 'https://example.com/return',
                    },
                }),
            ).rejects.toThrow('Not implemented');
        });

        it('charge() throws Not implemented', async () => {
            const sdk = new GoPaySDK();
            await expect(
                sdk.payments.charge('payment-123', {
                    payment_instrument: {
                        payment_instrument: 'PAYMENT_CARD',
                        input: {
                            input_type: 'CARD_TOKEN',
                            card_token: 'tok_123',
                        },
                    },
                    return_url: 'https://example.com/return',
                }),
            ).rejects.toThrow('Not implemented');
        });

        it('getGooglePayInfo() throws Not implemented', async () => {
            const sdk = new GoPaySDK();
            await expect(
                sdk.payments.getGooglePayInfo('payment-123'),
            ).rejects.toThrow('Not implemented');
        });

        it('getApplePayInfo() throws Not implemented', async () => {
            const sdk = new GoPaySDK();
            await expect(
                sdk.payments.getApplePayInfo('payment-123'),
            ).rejects.toThrow('Not implemented');
        });

        it('validateApplePayMerchant() throws Not implemented', async () => {
            const sdk = new GoPaySDK();
            await expect(
                sdk.payments.validateApplePayMerchant(
                    'payment-123',
                    'https://shop.example.com',
                ),
            ).rejects.toThrow('Not implemented');
        });
    });
});
