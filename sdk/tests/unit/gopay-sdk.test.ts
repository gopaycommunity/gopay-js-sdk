import { buildUrl } from '@gopay-internal/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGoPaySDK } from '../../src/index.js';
import type { components } from '../../src/types/generated.js';

type TokenPair = components['schemas']['Token-Pair'];

describe('buildUrl', () => {
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
        expect(buildUrl(baseUrl, path)).toBe(expected);
    });

    it('uses sandbox base URL by default', () => {
        expect(
            buildUrl(
                'https://api.sandbox.gopay.com/api/merchant/payments/4.0',
                'oauth2/token',
            ),
        ).toBe(
            'https://api.sandbox.gopay.com/api/merchant/payments/4.0/oauth2/token',
        );
    });

    it('uses production base URL when environment is production', () => {
        expect(
            buildUrl(
                'https://api.gopay.com/api/merchant/payments/4.0',
                'oauth2/token',
            ),
        ).toBe('https://api.gopay.com/api/merchant/payments/4.0/oauth2/token');
    });
});

describe('GoPaySDK', () => {
    it('instantiates with default config', () => {
        const sdk = createGoPaySDK();
        expect(sdk).toBeDefined();
    });

    it('exposes flat methods', () => {
        const sdk = createGoPaySDK({ environment: 'sandbox' });
        expect(typeof sdk.authenticate).toBe('function');
        expect(typeof sdk.isAuthenticated).toBe('function');
        expect(typeof sdk.logout).toBe('function');
        expect(typeof sdk.createPayment).toBe('function');
        expect(typeof sdk.getPaymentStatus).toBe('function');
        expect(typeof sdk.chargePayment).toBe('function');
        expect(typeof sdk.tokenizeEncryptedCard).toBe('function');
        expect(typeof sdk.getCardDetails).toBe('function');
        expect(typeof sdk.deleteCard).toBe('function');
    });

    describe('AuthModule', () => {
        const mockTokenPair = {
            token_type: 'bearer' as const,
            access_token: 'access_abc123',
            refresh_token: 'refresh_xyz789',
            scope: 'payment:write',
            expires_in: 3600,
            refresh_expires_in: 86400,
        } satisfies TokenPair;

        const makeMockResponse = (
            data: unknown,
            status = 200,
            statusText = 'OK',
        ) =>
            new Response(JSON.stringify(data), {
                status,
                statusText,
                headers: { 'content-type': 'application/json' },
            });

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
            const sdk = createGoPaySDK();
            expect(typeof sdk.authenticate).toBe('function');
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

            const sdk = createGoPaySDK({ environment: 'sandbox' });
            await sdk.authenticate({
                grant_type: 'client_credentials',
                client_id: 'my-client',
                client_secret: 'my-secret',
                scope: 'payment:write',
            });

            expect(sdk.isAuthenticated()).toBe(true);
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
            expect(body.get('scope')).toBe('payment:write');
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
            const sdk = createGoPaySDK();
            await expect(
                sdk.authenticate({
                    grant_type: 'client_credentials',
                    client_id: 'bad-client',
                    client_secret: 'bad-secret',
                    scope: 'payment:write',
                }),
            ).rejects.toThrow('HTTP 401');
        });
    });

    describe('CardsModule', () => {
        it('exposes tokenizeEncryptedCard()', () => {
            const sdk = createGoPaySDK();
            expect(typeof sdk.tokenizeEncryptedCard).toBe('function');
        });

        it('exposes getCardDetails()', () => {
            const sdk = createGoPaySDK();
            expect(typeof sdk.getCardDetails).toBe('function');
        });

        it('exposes deleteCard()', () => {
            const sdk = createGoPaySDK();
            expect(typeof sdk.deleteCard).toBe('function');
        });
    });

    describe('PaymentsModule', () => {
        const paymentMethods = [
            'createPayment',
            'chargePayment',
            'getPaymentStatus',
            'getChargeState',
            'getGooglePayInfo',
            'getApplePayInfo',
        ] as const;

        it.each(paymentMethods)('exposes %s()', (method) => {
            const sdk = createGoPaySDK();
            expect(typeof sdk[method]).toBe('function');
        });

        it('createPayment() sends POST to /eshops/{goid}/payments and returns response', async () => {
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
                                scope: 'payment:write',
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

            const sdk = createGoPaySDK({ environment: 'sandbox' });
            await sdk.authenticate({
                grant_type: 'client_credentials',
                client_id: 'id',
                client_secret: 'secret',
                scope: 'payment:write',
            });
            const result = await sdk.createPayment('test-goid', {
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

        it('chargePayment() sends POST to /payments/{id}/charge and returns response', async () => {
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
                                scope: 'payment:write',
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

            const sdk = createGoPaySDK({ environment: 'sandbox' });
            await sdk.authenticate({
                grant_type: 'client_credentials',
                client_id: 'id',
                client_secret: 'secret',
                scope: 'payment:write',
            });
            const result = await sdk.chargePayment('pay_300000001', {
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

            const sdk = createGoPaySDK({ environment: 'sandbox' });
            await sdk.authenticate({
                grant_type: 'client_credentials',
                client_id: 'id',
                client_secret: 'secret',
                scope: 'payment:write',
            });
            const result = await sdk.getGooglePayInfo('payment-123');

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

            const sdk = createGoPaySDK({ environment: 'sandbox' });
            await sdk.authenticate({
                grant_type: 'client_credentials',
                client_id: 'id',
                client_secret: 'secret',
                scope: 'payment:write',
            });
            const result = await sdk.getQRPaymentInfo('payment-123', 'svg');

            expect(capturedReq.method).toBe('GET');
            expect(capturedReq.url).toBe(
                'https://api.sandbox.gopay.com/api/merchant/payments/4.0/payments/payment-123/qr-payment/info?format=svg',
            );
            expect(result).toEqual(mockQR);
        });
    });
});
