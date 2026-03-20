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

        const makeMockResponse = (
            data: unknown,
            status = 200,
            statusText = 'OK',
        ) => {
            const body = JSON.stringify(data);
            const res = {
                ok: status >= 200 && status < 300,
                status,
                statusText,
                headers: new Headers({ 'content-type': 'application/json' }),
                json: () => Promise.resolve(data),
                text: () => Promise.resolve(body),
                clone() {
                    return makeMockResponse(data, status, statusText);
                },
            };
            return res;
        };

        beforeEach(() => {
            vi.stubGlobal(
                'fetch',
                vi.fn().mockResolvedValue(makeMockResponse(mockTokenPair)),
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
            let capturedReq!: Request;
            let capturedBodyText = '';
            vi.stubGlobal(
                'fetch',
                vi.fn().mockImplementation(async (req: Request) => {
                    capturedReq = req;
                    capturedBodyText = await req.text();
                    return makeMockResponse(mockTokenPair);
                }),
            );

            const sdk = new GoPaySDK({ environment: 'sandbox' });
            const result = await sdk.auth.authenticate({
                grant_type: 'client_credentials',
                client_id: 'my-client',
                client_secret: 'my-secret',
                scope: 'payment:create',
            });

            expect(result).toEqual(mockTokenPair);
            expect(capturedReq.url).toBe(
                'https://api.sandbox.gopay.com/api/merchant/payments/4.0/oauth2/token',
            );
            expect(capturedReq.method).toBe('POST');
            expect(capturedReq.headers.get('Content-Type')).toBe(
                'application/x-www-form-urlencoded',
            );
            expect(capturedReq.headers.get('Authorization')).toBe(
                `Basic ${btoa('my-client:my-secret')}`,
            );
            const body = new URLSearchParams(capturedBodyText);
            expect(body.get('grant_type')).toBe('client_credentials');
            expect(body.get('scope')).toBe('payment:create');
        });

        it('exposes issueClientToken() and setClientToken()', () => {
            const sdk = new GoPaySDK();
            expect(typeof sdk.auth.issueClientToken).toBe('function');
            expect(typeof sdk.auth.setClientToken).toBe('function');
        });

        it('issueClientToken() returns a ClientToken without changing the server session', async () => {
            const clientTokenPair = {
                ...mockTokenPair,
                access_token: 'client-at',
                refresh_token: 'client-rt',
            };
            let callCount = 0;
            vi.stubGlobal(
                'fetch',
                vi.fn().mockImplementation(async (req: Request) => {
                    await req.text();
                    callCount++;
                    // First call: authenticate (server session)
                    // Second call: issueClientToken
                    return makeMockResponse(
                        callCount === 1 ? mockTokenPair : clientTokenPair,
                    );
                }),
            );

            const sdk = new GoPaySDK({ environment: 'sandbox' });
            await sdk.auth.authenticate({
                grant_type: 'client_credentials',
                client_id: 'my-client',
                client_secret: 'my-secret',
                scope: 'payment:create payment:read',
            });

            const token = await sdk.auth.issueClientToken('payment:create');
            expect(token.access_token).toBe('client-at');
            expect(token.refresh_token).toBe('client-rt');
            expect(typeof token.expires_in).toBe('number');
            expect(typeof token.refresh_expires_in).toBe('number');
        });

        it('authenticate() throws on non-ok HTTP response', async () => {
            vi.stubGlobal(
                'fetch',
                vi
                    .fn()
                    .mockResolvedValue(
                        makeMockResponse({}, 401, 'Unauthorized'),
                    ),
            );
            const sdk = new GoPaySDK();
            await expect(
                sdk.auth.authenticate({
                    grant_type: 'client_credentials',
                    client_id: 'bad-client',
                    client_secret: 'bad-secret',
                    scope: 'payment:create',
                }),
            ).rejects.toThrow('HTTP 401');
        });
    });

    describe('CardsModule', () => {
        it('exposes mountCardForm()', () => {
            const sdk = new GoPaySDK();
            expect(typeof sdk.cards.mountCardForm).toBe('function');
        });
    });

    describe('PaymentsModule', () => {
        const paymentMethods = [
            'create',
            'charge',
            'getGooglePayInfo',
            'getApplePayInfo',
            'startApplePaySession',
        ] as const;

        it.each(paymentMethods)('exposes %s()', (method) => {
            const sdk = new GoPaySDK();
            expect(typeof sdk.payments[method]).toBe('function');
        });

        it('create() sends POST to /eshops/{goid}/payments and returns response', async () => {
            const mockPayment = {
                id: 'pay_300000001',
                order_number: 'ORDER-001',
                state: 'CREATED',
                amount: 1000,
                currency: 'CZK',
                customer: { email: 'test@example.com' },
                gw_url: 'https://gw.gopay.com/gw/v3/abc',
            };
            let capturedPaymentReq!: Request;
            vi.stubGlobal(
                'fetch',
                vi.fn().mockImplementation(async (req: Request) => {
                    await req.text();
                    if (req.url.includes('/oauth2/token')) {
                        return new Response(
                            JSON.stringify({
                                token_type: 'bearer',
                                access_token: 'at-test',
                                refresh_token: 'rt-test',
                                scope: 'payment:create',
                                expires_in: 900,
                                refresh_expires_in: 86400,
                            }),
                            {
                                status: 200,
                                headers: { 'content-type': 'application/json' },
                            },
                        );
                    }
                    capturedPaymentReq = req;
                    return new Response(JSON.stringify(mockPayment), {
                        status: 200,
                        headers: { 'content-type': 'application/json' },
                    });
                }),
            );

            const sdk = new GoPaySDK({ environment: 'sandbox' });
            await sdk.auth.authenticate({
                grant_type: 'client_credentials',
                client_id: 'id',
                client_secret: 'secret',
                scope: 'payment:create',
            });
            const result = await sdk.payments.create('test-goid', {
                amount: 1000,
                currency: 'CZK',
                order_number: 'ORDER-001',
                customer: { email: 'test@example.com' },
                callback: {
                    notification_url: 'https://example.com/notify',
                    return_url: 'https://example.com/return',
                },
            });

            expect(capturedPaymentReq.method).toBe('POST');
            expect(capturedPaymentReq.url).toBe(
                'https://api.sandbox.gopay.com/api/merchant/payments/4.0/eshops/test-goid/payments',
            );
            expect(result).toEqual(mockPayment);
        });

        it('charge() sends POST to /payments/{id}/charge and returns response', async () => {
            const mockCharge = {
                id: 'pay_300000001',
                state: 'REQUESTED',
                payment_instrument: {
                    payment_instrument: 'PAYMENT_CARD',
                    details: {
                        input_type: 'CARD_TOKEN',
                        masked_pan: '406821******1234',
                    },
                },
                return_url: 'https://example.com/return',
                action: {
                    action_type: 'EMV3DS',
                    state: 'CREATED',
                    redirect_url: 'https://gate.gopay.com/redirect',
                },
            };
            let capturedChargeReq!: Request;
            vi.stubGlobal(
                'fetch',
                vi.fn().mockImplementation(async (req: Request) => {
                    await req.text();
                    if (req.url.includes('/oauth2/token')) {
                        return new Response(
                            JSON.stringify({
                                token_type: 'bearer',
                                access_token: 'at-test',
                                refresh_token: 'rt-test',
                                scope: 'payment:create',
                                expires_in: 900,
                                refresh_expires_in: 86400,
                            }),
                            {
                                status: 200,
                                headers: { 'content-type': 'application/json' },
                            },
                        );
                    }
                    capturedChargeReq = req;
                    return new Response(JSON.stringify(mockCharge), {
                        status: 201,
                        headers: { 'content-type': 'application/json' },
                    });
                }),
            );

            const sdk = new GoPaySDK({ environment: 'sandbox' });
            await sdk.auth.authenticate({
                grant_type: 'client_credentials',
                client_id: 'id',
                client_secret: 'secret',
                scope: 'payment:create',
            });
            const result = await sdk.payments.charge('pay_300000001', {
                payment_instrument: {
                    payment_instrument: 'PAYMENT_CARD',
                    input: {
                        input_type: 'CARD_TOKEN',
                        card_token: 'tok_123',
                    },
                },
                return_url: 'https://example.com/return',
            });

            expect(capturedChargeReq.method).toBe('POST');
            expect(capturedChargeReq.url).toBe(
                'https://api.sandbox.gopay.com/api/merchant/payments/4.0/payments/pay_300000001/charge',
            );
            expect(result).toEqual(mockCharge);
        });

        it('getGooglePayInfo() sends GET to /payments/{id}/google-pay/info', async () => {
            const mockGooglePay = {
                environment: 'TEST',
                paymentDataRequest: {},
            };
            let capturedReq!: Request;
            vi.stubGlobal(
                'fetch',
                vi.fn().mockImplementation(async (req: Request) => {
                    if (req.url.includes('/oauth2/token')) {
                        await req.text();
                        return new Response(
                            JSON.stringify({
                                token_type: 'bearer',
                                access_token: 'at-test',
                                refresh_token: 'rt-test',
                                expires_in: 900,
                                refresh_expires_in: 86400,
                            }),
                            {
                                status: 200,
                                headers: { 'content-type': 'application/json' },
                            },
                        );
                    }
                    capturedReq = req;
                    return new Response(JSON.stringify(mockGooglePay), {
                        status: 200,
                        headers: { 'content-type': 'application/json' },
                    });
                }),
            );

            const sdk = new GoPaySDK({ environment: 'sandbox' });
            await sdk.auth.authenticate({
                grant_type: 'client_credentials',
                client_id: 'id',
                client_secret: 'secret',
                scope: 'payment:create',
            });
            const result = await sdk.payments.getGooglePayInfo('payment-123');

            expect(capturedReq.method).toBe('GET');
            expect(capturedReq.url).toBe(
                'https://api.sandbox.gopay.com/api/merchant/payments/4.0/payments/payment-123/google-pay/info',
            );
            expect(result).toEqual(mockGooglePay);
        });

        it('getQRPaymentInfo() sends GET to /payments/{id}/qr-payment/info', async () => {
            const mockQR = {
                amount: 10000,
                currency: 'CZK',
                recipient: {
                    name: 'GoPay Czech',
                    bank_account: {
                        international: {
                            bic: 'FIOBCZPP',
                            iban: 'CZ51201',
                            reference: '123',
                        },
                    },
                },
                qr_code: { spayd: 'base64==' },
            };
            let capturedReq!: Request;
            vi.stubGlobal(
                'fetch',
                vi.fn().mockImplementation(async (req: Request) => {
                    if (req.url.includes('/oauth2/token')) {
                        await req.text();
                        return new Response(
                            JSON.stringify({
                                token_type: 'bearer',
                                access_token: 'at-test',
                                refresh_token: 'rt-test',
                                expires_in: 900,
                                refresh_expires_in: 86400,
                            }),
                            {
                                status: 200,
                                headers: { 'content-type': 'application/json' },
                            },
                        );
                    }
                    capturedReq = req;
                    return new Response(JSON.stringify(mockQR), {
                        status: 200,
                        headers: { 'content-type': 'application/json' },
                    });
                }),
            );

            const sdk = new GoPaySDK({ environment: 'sandbox' });
            await sdk.auth.authenticate({
                grant_type: 'client_credentials',
                client_id: 'id',
                client_secret: 'secret',
                scope: 'payment:create',
            });
            const result = await sdk.payments.getQRPaymentInfo(
                'payment-123',
                'svg',
            );

            expect(capturedReq.method).toBe('GET');
            expect(capturedReq.url).toBe(
                'https://api.sandbox.gopay.com/api/merchant/payments/4.0/payments/payment-123/qr-payment/info?format=svg',
            );
            expect(result).toEqual(mockQR);
        });
    });
});
