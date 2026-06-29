import { createHttpClient } from '@gopay-internal/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoPayErrorCodes, GoPaySDKError } from '../../src/errors.js';
import { createPaymentsApi } from '../../src/modules/payments/payments.module.js';
import { makeResponse } from './helpers.js';

const mockPaymentResponse = {
    id: 'pay_300000001',
    order_number: 'ORDER-001',
    state: 'CREATED',
    amount: 1000,
    currency: 'CZK',
    customer: { email: 'customer@example.com' },
    gw_url: 'https://gw.gopay.com/gw/v3/bCcvmwTKK5hrJx2aGG8ZnFyBJhAvF',
};

const createParams = {
    amount: 1000,
    currency: 'CZK',
    order_number: 'ORDER-001',
    customer: { email: 'customer@example.com' },
    callback: {
        notification_url: 'https://shop.example.com/notify',
        return_url: 'https://shop.example.com/return',
    },
} as const;

const mockChargeResponse = {
    id: 'pay_300000001',
    state: 'REQUESTED',
    payment_instrument: {
        payment_instrument: 'PAYMENT_CARD',
        details: {
            input_type: 'CARD_TOKEN',
            masked_pan: '406821******1234',
            expiration_month: '01',
            expiration_year: '30',
            scheme: 'VISA',
            fingerprint: '73c8d0a48d91def89761...',
        },
    },
    return_url: 'https://example.com/return',
    action: {
        action_type: 'EMV3DS',
        state: 'CREATED',
        redirect_url: 'https://gate.gopay.com/redirect',
    },
};

const chargeParams = {
    payment_instrument: {
        payment_instrument: 'PAYMENT_CARD',
        input: {
            input_type: 'CARD_TOKEN',
            card_token: 'J7HjFNwzyBOHS+jwIMMktubTwoIRy6qB/4opvjG...',
            challenge_preferrence: 'AUTO',
        },
    },
    return_url: 'https://example.com/return',
} as const;

describe('PaymentsModule', () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    let client: ReturnType<typeof createHttpClient>;
    let payments: ReturnType<typeof createPaymentsApi>;

    beforeEach(() => {
        fetchMock = vi
            .fn()
            .mockResolvedValue(makeResponse(mockPaymentResponse));
        vi.stubGlobal('fetch', fetchMock);
        client = createHttpClient({ baseUrl: 'https://example.com' });
        client.setToken({
            access_token: 'at-test',
            expires_in: 900,
            token_type: 'bearer',
        });
        payments = createPaymentsApi(client);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    describe('createPayment()', () => {
        it('sends POST to /eshops/{goid}/payments', async () => {
            let capturedReq!: Request;
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                await req.text();
                return makeResponse(mockPaymentResponse);
            });

            await payments.createPayment('goid-123', createParams);

            expect(capturedReq.method).toBe('POST');
            expect(capturedReq.url).toBe(
                'https://example.com/eshops/goid-123/payments',
            );
        });

        it('interpolates goid correctly into the URL', async () => {
            let capturedUrl = '';
            fetchMock.mockImplementation(async (req: Request) => {
                capturedUrl = req.url;
                await req.text();
                return makeResponse(mockPaymentResponse);
            });

            await payments.createPayment('merchant-456', createParams);

            expect(capturedUrl).toContain('/eshops/merchant-456/payments');
        });

        it('sends JSON body with payment params', async () => {
            let capturedBody = '';
            fetchMock.mockImplementation(async (req: Request) => {
                capturedBody = await req.text();
                return makeResponse(mockPaymentResponse);
            });

            await payments.createPayment('goid-123', createParams);

            expect(JSON.parse(capturedBody)).toEqual(createParams);
        });

        it('sends Content-Type: application/json', async () => {
            let capturedReq!: Request;
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                await req.text();
                return makeResponse(mockPaymentResponse);
            });

            await payments.createPayment('goid-123', createParams);

            expect(capturedReq.headers.get('Content-Type')).toContain(
                'application/json',
            );
        });

        it('sends Bearer token from token store', async () => {
            let capturedReq!: Request;
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                await req.text();
                return makeResponse(mockPaymentResponse);
            });

            await payments.createPayment('goid-123', createParams);

            expect(capturedReq.headers.get('Authorization')).toBe(
                'Bearer at-test',
            );
        });

        it('returns the payment response', async () => {
            const result = await payments.createPayment(
                'goid-123',
                createParams,
            );

            expect(result).toEqual(mockPaymentResponse);
            expect(result.id).toBe('pay_300000001');
        });
    });

    describe('chargePayment()', () => {
        beforeEach(() => {
            fetchMock.mockResolvedValue(makeResponse(mockChargeResponse, 201));
        });

        it('throws when paymentId is empty', async () => {
            await expect(
                payments.chargePayment('', chargeParams),
            ).rejects.toThrow('paymentId is required');
        });

        it('sends POST to /payments/{paymentId}/charge', async () => {
            let capturedReq!: Request;
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                await req.text();
                return makeResponse(mockChargeResponse, 201);
            });

            await payments.chargePayment('pay_300000001', chargeParams);

            expect(capturedReq.method).toBe('POST');
            expect(capturedReq.url).toBe(
                'https://example.com/payments/pay_300000001/charge',
            );
        });

        it('interpolates paymentId correctly into the URL', async () => {
            let capturedUrl = '';
            fetchMock.mockImplementation(async (req: Request) => {
                capturedUrl = req.url;
                await req.text();
                return makeResponse(mockChargeResponse, 201);
            });

            await payments.chargePayment('pay_999', chargeParams);

            expect(capturedUrl).toContain('/payments/pay_999/charge');
        });

        it('sends JSON body with charge params', async () => {
            let capturedBody = '';
            fetchMock.mockImplementation(async (req: Request) => {
                capturedBody = await req.text();
                return makeResponse(mockChargeResponse, 201);
            });

            await payments.chargePayment('pay_300000001', chargeParams);

            expect(JSON.parse(capturedBody)).toMatchObject(chargeParams);
        });

        it('sends Content-Type: application/json', async () => {
            let capturedReq!: Request;
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                await req.text();
                return makeResponse(mockChargeResponse, 201);
            });

            await payments.chargePayment('pay_300000001', chargeParams);

            expect(capturedReq.headers.get('Content-Type')).toContain(
                'application/json',
            );
        });

        it('sends Bearer token from token store', async () => {
            let capturedReq!: Request;
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                await req.text();
                return makeResponse(mockChargeResponse, 201);
            });

            await payments.chargePayment('pay_300000001', chargeParams);

            expect(capturedReq.headers.get('Authorization')).toBe(
                'Bearer at-test',
            );
        });

        it('returns the charge response', async () => {
            const result = await payments.chargePayment(
                'pay_300000001',
                chargeParams,
            );

            expect(result).toEqual(mockChargeResponse);
            expect(result.id).toBe('pay_300000001');
            expect(result.state).toBe('REQUESTED');
        });

        it('succeeds without return_url (return_url is optional)', async () => {
            let capturedBody = '';
            fetchMock.mockImplementation(async (req: Request) => {
                capturedBody = await req.text();
                return makeResponse(mockChargeResponse, 201);
            });

            const paramsWithoutReturnUrl = {
                payment_instrument: chargeParams.payment_instrument,
            };

            await expect(
                payments.chargePayment('pay_300000001', paramsWithoutReturnUrl),
            ).resolves.toBeDefined();

            const body = JSON.parse(capturedBody);
            expect(body).not.toHaveProperty('return_url');
        });
    });

    describe('getGooglePayInfo()', () => {
        const mockGooglePayResponse = {
            environment: 'TEST',
            paymentDataRequest: {
                apiVersion: 2,
                apiVersionMinor: 0,
                allowedPaymentMethods: [
                    {
                        type: 'CARD',
                        parameters: {
                            allowedAuthMethods: ['PAN_ONLY', 'CRYPTOGRAM_3DS'],
                            allowedCardNetworks: ['VISA', 'MASTERCARD'],
                        },
                        tokenizationSpecification: {
                            type: 'PAYMENT_GATEWAY',
                            parameters: {
                                gateway: 'gopay',
                                gatewayMerchantId: '26046768005768011132',
                            },
                        },
                    },
                ],
                transactionInfo: {
                    currencyCode: 'CZK',
                    countryCode: 'CZ',
                    totalPriceStatus: 'FINAL',
                    totalPrice: '5.00',
                },
                merchantInfo: {
                    merchantName: 'GoPay Czech',
                    merchantId: '14846034534970557458',
                },
                emailRequired: true,
            },
        };

        beforeEach(() => {
            fetchMock.mockResolvedValue(makeResponse(mockGooglePayResponse));
        });

        it('sends GET to /payments/{paymentId}/google-pay/info', async () => {
            let capturedReq!: Request;
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                return makeResponse(mockGooglePayResponse);
            });

            await payments.getGooglePayInfo('pay_300000001');

            expect(capturedReq.method).toBe('GET');
            expect(capturedReq.url).toBe(
                'https://example.com/payments/pay_300000001/google-pay/info',
            );
        });

        it('interpolates paymentId correctly into the URL', async () => {
            let capturedUrl = '';
            fetchMock.mockImplementation(async (req: Request) => {
                capturedUrl = req.url;
                return makeResponse(mockGooglePayResponse);
            });

            await payments.getGooglePayInfo('pay_999');

            expect(capturedUrl).toContain('/payments/pay_999/google-pay/info');
        });

        it('sends Bearer token from token store', async () => {
            let capturedReq!: Request;
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                return makeResponse(mockGooglePayResponse);
            });

            await payments.getGooglePayInfo('pay_300000001');

            expect(capturedReq.headers.get('Authorization')).toBe(
                'Bearer at-test',
            );
        });

        it('does not send a request body', async () => {
            let capturedBody: string | null = null;
            fetchMock.mockImplementation(async (req: Request) => {
                capturedBody = await req.text();
                return makeResponse(mockGooglePayResponse);
            });

            await payments.getGooglePayInfo('pay_300000001');

            expect(capturedBody).toBe('');
        });

        it('returns the full Google Pay info response', async () => {
            const result = await payments.getGooglePayInfo('pay_300000001');

            expect(result).toEqual(mockGooglePayResponse);
            expect(result.environment).toBe('TEST');
            expect(result.paymentDataRequest?.apiVersion).toBe(2);
            expect(
                result.paymentDataRequest?.transactionInfo?.currencyCode,
            ).toBe('CZK');
            expect(result.paymentDataRequest?.merchantInfo?.merchantName).toBe(
                'GoPay Czech',
            );
            expect(
                result.paymentDataRequest?.allowedPaymentMethods,
            ).toHaveLength(1);
            expect(
                result.paymentDataRequest?.allowedPaymentMethods?.[0]
                    ?.tokenizationSpecification?.parameters?.gateway,
            ).toBe('gopay');
        });

        it('returns PRODUCTION environment when set', async () => {
            const productionResponse = {
                ...mockGooglePayResponse,
                environment: 'PRODUCTION',
            };
            fetchMock.mockResolvedValue(makeResponse(productionResponse));

            const result = await payments.getGooglePayInfo('pay_300000001');

            expect(result.environment).toBe('PRODUCTION');
        });
    });

    describe('chargePayment() with Google Pay instrument', () => {
        const mockGooglePayChargeResponse = {
            id: 'pay_300000001',
            state: 'REQUESTED',
            payment_instrument: {
                payment_instrument: 'PAYMENT_CARD',
                details: {
                    input_type: 'GOOGLE_PAY',
                },
            },
            return_url: 'https://example.com/return',
            action: {
                action_type: 'EMV3DS',
                state: 'CREATED',
                redirect_url: 'https://gate.gopay.com/redirect',
            },
        };

        const googlePayChargeParams = {
            payment_instrument: {
                payment_instrument: 'PAYMENT_CARD',
                input: {
                    input_type: 'GOOGLE_PAY',
                    protocolVersion: 'ECv2',
                    signature: 'sig==',
                    signedMessage: '{"encryptedMessage":"enc=="}',
                },
            },
            return_url: 'https://example.com/return',
        } as const;

        beforeEach(() => {
            fetchMock.mockResolvedValue(
                makeResponse(mockGooglePayChargeResponse, 201),
            );
        });

        it('sends POST to /payments/{paymentId}/charge', async () => {
            let capturedReq!: Request;
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                await req.text();
                return makeResponse(mockGooglePayChargeResponse, 201);
            });

            await payments.chargePayment(
                'pay_300000001',
                googlePayChargeParams,
            );

            expect(capturedReq.method).toBe('POST');
            expect(capturedReq.url).toBe(
                'https://example.com/payments/pay_300000001/charge',
            );
        });

        it('sends JSON body with GOOGLE_PAY input_type', async () => {
            let capturedBody = '';
            fetchMock.mockImplementation(async (req: Request) => {
                capturedBody = await req.text();
                return makeResponse(mockGooglePayChargeResponse, 201);
            });

            await payments.chargePayment(
                'pay_300000001',
                googlePayChargeParams,
            );

            const body = JSON.parse(capturedBody);
            expect(body.payment_instrument.input.input_type).toBe('GOOGLE_PAY');
            expect(body.payment_instrument.input.protocolVersion).toBe('ECv2');
            expect(body.payment_instrument.input.signature).toBe('sig==');
            expect(body.payment_instrument.input.signedMessage).toBeDefined();
        });

        it('sends Bearer token from token store', async () => {
            let capturedReq!: Request;
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                await req.text();
                return makeResponse(mockGooglePayChargeResponse, 201);
            });

            await payments.chargePayment(
                'pay_300000001',
                googlePayChargeParams,
            );

            expect(capturedReq.headers.get('Authorization')).toBe(
                'Bearer at-test',
            );
        });

        it('returns the charge response', async () => {
            const result = await payments.chargePayment(
                'pay_300000001',
                googlePayChargeParams,
            );

            expect(result).toEqual(mockGooglePayChargeResponse);
            expect(result.state).toBe('REQUESTED');
        });
    });

    describe('chargePayment() with Apple Pay instrument', () => {
        const mockApplePayChargeResponse = {
            id: 'pay_300000001',
            state: 'REQUESTED',
            payment_instrument: {
                payment_instrument: 'PAYMENT_CARD',
                details: {
                    input_type: 'APPLE_PAY',
                },
            },
            return_url: 'https://example.com/return',
            action: {
                action_type: 'EMV3DS',
                state: 'CREATED',
                redirect_url: 'https://gate.gopay.com/redirect',
            },
        };

        const applePayChargeParams = {
            payment_instrument: {
                payment_instrument: 'PAYMENT_CARD',
                input: {
                    input_type: 'APPLE_PAY',
                    data: 'V7OcjttPJnUJaQH7x7OjbIeZSINuc==',
                    signature: 'MIAGCSqGSIb3DQEHAqCAM==',
                    version: 'EC_v1',
                    header: {
                        ephemeralPublicKey: 'MFkwEwYHKoZIzj==',
                        publicKeyHash:
                            'L6vppo38t31Q/9npxRy/xbA1+cs13h1LV+pMO/FYwvo=',
                        transactionId: '4f4fac7a1a6a8ba2c0e8c5',
                    },
                },
            },
            return_url: 'https://example.com/return',
        } as const;

        beforeEach(() => {
            fetchMock.mockResolvedValue(
                makeResponse(mockApplePayChargeResponse, 201),
            );
        });

        it('sends POST to /payments/{paymentId}/charge', async () => {
            let capturedReq!: Request;
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                await req.text();
                return makeResponse(mockApplePayChargeResponse, 201);
            });

            await payments.chargePayment('pay_300000001', applePayChargeParams);

            expect(capturedReq.method).toBe('POST');
            expect(capturedReq.url).toBe(
                'https://example.com/payments/pay_300000001/charge',
            );
        });

        it('sends JSON body with APPLE_PAY input_type and all required token fields', async () => {
            let capturedBody = '';
            fetchMock.mockImplementation(async (req: Request) => {
                capturedBody = await req.text();
                return makeResponse(mockApplePayChargeResponse, 201);
            });

            await payments.chargePayment('pay_300000001', applePayChargeParams);

            const body = JSON.parse(capturedBody);
            const input = body.payment_instrument.input;
            expect(input.input_type).toBe('APPLE_PAY');
            expect(input.data).toBe('V7OcjttPJnUJaQH7x7OjbIeZSINuc==');
            expect(input.signature).toBe('MIAGCSqGSIb3DQEHAqCAM==');
            expect(input.version).toBe('EC_v1');
            expect(input.header.ephemeralPublicKey).toBe('MFkwEwYHKoZIzj==');
            expect(input.header.publicKeyHash).toBe(
                'L6vppo38t31Q/9npxRy/xbA1+cs13h1LV+pMO/FYwvo=',
            );
            expect(input.header.transactionId).toBe('4f4fac7a1a6a8ba2c0e8c5');
        });

        it('sends Bearer token from token store', async () => {
            let capturedReq!: Request;
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                await req.text();
                return makeResponse(mockApplePayChargeResponse, 201);
            });

            await payments.chargePayment('pay_300000001', applePayChargeParams);

            expect(capturedReq.headers.get('Authorization')).toBe(
                'Bearer at-test',
            );
        });

        it('returns the charge response', async () => {
            const result = await payments.chargePayment(
                'pay_300000001',
                applePayChargeParams,
            );

            expect(result).toEqual(mockApplePayChargeResponse);
            expect(result.state).toBe('REQUESTED');
        });
    });

    describe('getApplePayInfo()', () => {
        const mockApplePayResponse = {
            applepayVersion: 6,
            merchantDisplayName: 'GoPay Czech Branch',
            merchantIdentifier: '8398119642',
            applePayPaymentRequest: {
                supportedNetworks: ['visa', 'masterCard'],
                countryCode: 'CZ',
                currencyCode: 'CZK',
                total: {
                    label: 'GoPay Czech Branch',
                    amount: '10.00',
                    type: 'final',
                },
            },
        };

        beforeEach(() => {
            fetchMock.mockResolvedValue(makeResponse(mockApplePayResponse));
        });

        it('sends GET to /payments/{paymentId}/apple-pay/info', async () => {
            let capturedReq!: Request;
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                return makeResponse(mockApplePayResponse);
            });

            await payments.getApplePayInfo('pay_300000001');

            expect(capturedReq.method).toBe('GET');
            expect(capturedReq.url).toBe(
                'https://example.com/payments/pay_300000001/apple-pay/info',
            );
        });

        it('interpolates paymentId correctly into the URL', async () => {
            let capturedUrl = '';
            fetchMock.mockImplementation(async (req: Request) => {
                capturedUrl = req.url;
                return makeResponse(mockApplePayResponse);
            });

            await payments.getApplePayInfo('pay_999');

            expect(capturedUrl).toContain('/payments/pay_999/apple-pay/info');
        });

        it('sends Bearer token from token store', async () => {
            let capturedReq!: Request;
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                return makeResponse(mockApplePayResponse);
            });

            await payments.getApplePayInfo('pay_300000001');

            expect(capturedReq.headers.get('Authorization')).toBe(
                'Bearer at-test',
            );
        });

        it('returns the Apple Pay info response', async () => {
            const result = await payments.getApplePayInfo('pay_300000001');

            expect(result).toEqual(mockApplePayResponse);
        });
    });

    describe('getPaymentStatus()', () => {
        beforeEach(() => {
            fetchMock.mockResolvedValue(makeResponse(mockPaymentResponse));
        });

        it('sends GET to /payments/{paymentId}', async () => {
            let capturedReq!: Request;
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                return makeResponse(mockPaymentResponse);
            });

            await payments.getPaymentStatus('pay_300000001');

            expect(capturedReq.method).toBe('GET');
            expect(capturedReq.url).toBe(
                'https://example.com/payments/pay_300000001',
            );
        });

        it('interpolates paymentId correctly into the URL', async () => {
            let capturedUrl = '';
            fetchMock.mockImplementation(async (req: Request) => {
                capturedUrl = req.url;
                return makeResponse(mockPaymentResponse);
            });

            await payments.getPaymentStatus('pay_999');

            expect(capturedUrl).toContain('/payments/pay_999');
            expect(capturedUrl).not.toContain('/charge');
        });

        it('sends Bearer token from token store', async () => {
            let capturedReq!: Request;
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                return makeResponse(mockPaymentResponse);
            });

            await payments.getPaymentStatus('pay_300000001');

            expect(capturedReq.headers.get('Authorization')).toBe(
                'Bearer at-test',
            );
        });

        it('does not send a request body', async () => {
            let capturedBody: string | null = null;
            fetchMock.mockImplementation(async (req: Request) => {
                capturedBody = await req.text();
                return makeResponse(mockPaymentResponse);
            });

            await payments.getPaymentStatus('pay_300000001');

            expect(capturedBody).toBe('');
        });

        it('returns the payment status response', async () => {
            const result = await payments.getPaymentStatus('pay_300000001');

            expect(result).toEqual(mockPaymentResponse);
            expect(result.id).toBe('pay_300000001');
            expect(result.state).toBe('CREATED');
            expect(result.amount).toBe(1000);
        });

        it('throws when paymentId is empty', async () => {
            await expect(payments.getPaymentStatus('')).rejects.toThrow(
                'paymentId is required',
            );
        });
    });

    describe('getChargeState()', () => {
        beforeEach(() => {
            fetchMock.mockResolvedValue(makeResponse(mockChargeResponse));
        });

        it('sends GET to /payments/{paymentId}/charge', async () => {
            let capturedReq!: Request;
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                return makeResponse(mockChargeResponse);
            });

            await payments.getChargeState('pay_300000001');

            expect(capturedReq.method).toBe('GET');
            expect(capturedReq.url).toBe(
                'https://example.com/payments/pay_300000001/charge',
            );
        });

        it('interpolates paymentId correctly into the URL', async () => {
            let capturedUrl = '';
            fetchMock.mockImplementation(async (req: Request) => {
                capturedUrl = req.url;
                return makeResponse(mockChargeResponse);
            });

            await payments.getChargeState('pay_999');

            expect(capturedUrl).toContain('/payments/pay_999/charge');
        });

        it('sends Bearer token from token store', async () => {
            let capturedReq!: Request;
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                return makeResponse(mockChargeResponse);
            });

            await payments.getChargeState('pay_300000001');

            expect(capturedReq.headers.get('Authorization')).toBe(
                'Bearer at-test',
            );
        });

        it('does not send a request body', async () => {
            let capturedBody: string | null = null;
            fetchMock.mockImplementation(async (req: Request) => {
                capturedBody = await req.text();
                return makeResponse(mockChargeResponse);
            });

            await payments.getChargeState('pay_300000001');

            expect(capturedBody).toBe('');
        });

        it('returns the charge state response', async () => {
            const result = await payments.getChargeState('pay_300000001');

            expect(result).toEqual(mockChargeResponse);
            expect(result.id).toBe('pay_300000001');
            expect(result.state).toBe('REQUESTED');
            expect(result.return_url).toBe('https://example.com/return');
        });

        it('throws when paymentId is empty', async () => {
            await expect(payments.getChargeState('')).rejects.toThrow(
                'paymentId is required',
            );
        });
    });

    describe('startApplePaySession()', () => {
        let mockSession: {
            onvalidatemerchant: ((event: unknown) => void) | null;
            oncancel: ((event: unknown) => void) | null;
            completeMerchantValidation: ReturnType<
                typeof vi.fn<(merchantSession: unknown) => void>
            >;
            abort: ReturnType<typeof vi.fn<() => void>>;
            begin: ReturnType<typeof vi.fn<() => void>>;
        };

        beforeEach(() => {
            mockSession = {
                onvalidatemerchant: null,
                oncancel: null,
                completeMerchantValidation:
                    vi.fn<(merchantSession: unknown) => void>(),
                abort: vi.fn<() => void>(),
                begin: vi.fn<() => void>(),
            };
        });

        it('throws when paymentId is empty', () => {
            expect(() =>
                payments.startApplePaySession(
                    '',
                    mockSession,
                    'https://merchant.example.com',
                ),
            ).toThrow('paymentId is required');
        });

        it('throws for a non-https origin', () => {
            expect(() =>
                payments.startApplePaySession(
                    'pay_123',
                    mockSession,
                    'http://merchant.example.com',
                ),
            ).toThrow('origin must be an https: origin');
        });

        it('throws for an invalid URL origin', () => {
            expect(() =>
                payments.startApplePaySession(
                    'pay_123',
                    mockSession,
                    'not-a-url',
                ),
            ).toThrow('invalid origin');
        });

        it('throws when origin includes a path', () => {
            expect(() =>
                payments.startApplePaySession(
                    'pay_123',
                    mockSession,
                    'https://merchant.example.com/path',
                ),
            ).toThrow('origin must be an https: origin');
        });

        it('accepts an empty origin string and skips validation', () => {
            expect(() =>
                payments.startApplePaySession('pay_123', mockSession, ''),
            ).not.toThrow();
            expect(mockSession.begin).toHaveBeenCalledOnce();
        });

        it('calls session.begin()', () => {
            payments.startApplePaySession(
                'pay_123',
                mockSession,
                'https://merchant.example.com',
            );

            expect(mockSession.begin).toHaveBeenCalledOnce();
        });

        it('wires up onvalidatemerchant', () => {
            payments.startApplePaySession(
                'pay_123',
                mockSession,
                'https://merchant.example.com',
            );

            expect(mockSession.onvalidatemerchant).toBeTypeOf('function');
        });

        it('wires up oncancel', () => {
            payments.startApplePaySession(
                'pay_123',
                mockSession,
                'https://merchant.example.com',
            );

            expect(mockSession.oncancel).toBeTypeOf('function');
        });

        it('oncancel fires the provided callback', () => {
            const oncancel = vi.fn();
            payments.startApplePaySession(
                'pay_123',
                mockSession,
                'https://merchant.example.com',
                { oncancel },
            );

            const event = { type: 'cancel' };
            mockSession.oncancel?.(event);

            expect(oncancel).toHaveBeenCalledWith(event);
        });

        it('oncancel does not throw when no callback is provided', () => {
            payments.startApplePaySession(
                'pay_123',
                mockSession,
                'https://merchant.example.com',
            );

            expect(() => mockSession.oncancel?.({})).not.toThrow();
        });

        it('uses empty string origin when globalThis.location is undefined', () => {
            vi.stubGlobal('location', undefined);

            expect(() =>
                payments.startApplePaySession('pay_123', mockSession),
            ).not.toThrow();
            expect(mockSession.begin).toHaveBeenCalledOnce();
        });

        it('onvalidatemerchant sends no Origin header when origin is empty string', async () => {
            let capturedReq!: Request;
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                await req.text();
                return makeResponse({});
            });

            payments.startApplePaySession('pay_123', mockSession, '');
            mockSession.onvalidatemerchant?.({
                validationURL: 'https://apple.com/validate',
            });

            await vi.waitFor(() => expect(capturedReq).toBeDefined());

            expect(capturedReq.headers.get('Origin')).toBeNull();
        });

        it('onvalidatemerchant sends no body when event has no validationURL', async () => {
            let capturedBody = '';
            fetchMock.mockImplementation(async (req: Request) => {
                capturedBody = await req.text();
                return makeResponse({});
            });

            payments.startApplePaySession(
                'pay_123',
                mockSession,
                'https://merchant.example.com',
            );
            mockSession.onvalidatemerchant?.({});

            await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());

            expect(capturedBody).toBe('');
        });

        it('onvalidatemerchant POSTs to apple-pay/validate', async () => {
            let capturedReq!: Request;
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                await req.text();
                return makeResponse({ token: 'merchant-token' });
            });

            payments.startApplePaySession(
                'pay_300000001',
                mockSession,
                'https://merchant.example.com',
            );
            mockSession.onvalidatemerchant?.({
                validationURL: 'https://apple.com/validate',
            });

            await vi.waitFor(() => expect(capturedReq).toBeDefined());

            expect(capturedReq.method).toBe('POST');
            expect(capturedReq.url).toBe(
                'https://example.com/payments/pay_300000001/apple-pay/validate',
            );
        });

        it('onvalidatemerchant sends Origin header', async () => {
            let capturedReq!: Request;
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                await req.text();
                return makeResponse({});
            });

            payments.startApplePaySession(
                'pay_300000001',
                mockSession,
                'https://merchant.example.com',
            );
            mockSession.onvalidatemerchant?.({
                validationURL: 'https://apple.com/validate',
            });

            await vi.waitFor(() => expect(capturedReq).toBeDefined());

            expect(capturedReq.headers.get('Origin')).toBe(
                'https://merchant.example.com',
            );
        });

        it('onvalidatemerchant sends validationUrl in request body', async () => {
            let capturedReq!: Request;
            let capturedBody = '';
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                capturedBody = await req.text();
                return makeResponse({});
            });

            payments.startApplePaySession(
                'pay_300000001',
                mockSession,
                'https://merchant.example.com',
            );
            mockSession.onvalidatemerchant?.({
                validationURL: 'https://apple.com/validate',
            });

            await vi.waitFor(() => expect(capturedReq).toBeDefined());

            expect(JSON.parse(capturedBody)).toEqual({
                validationUrl: 'https://apple.com/validate',
            });
            expect(capturedReq.headers.get('Apple-Validation-Url')).toBeNull();
        });

        it('calls completeMerchantValidation with the server response', async () => {
            const merchantSession = { token: 'ms-token' };
            fetchMock.mockResolvedValue(makeResponse(merchantSession));

            payments.startApplePaySession(
                'pay_300000001',
                mockSession,
                'https://merchant.example.com',
            );
            mockSession.onvalidatemerchant?.({
                validationURL: 'https://apple.com/validate',
            });

            await vi.waitFor(() =>
                expect(
                    mockSession.completeMerchantValidation,
                ).toHaveBeenCalledWith(merchantSession),
            );
        });

        it('calls session.abort() when the validation POST fails', async () => {
            fetchMock.mockRejectedValue(new Error('network error'));

            payments.startApplePaySession(
                'pay_300000001',
                mockSession,
                'https://merchant.example.com',
            );
            mockSession.onvalidatemerchant?.({
                validationURL: 'https://apple.com/validate',
            });

            await vi.waitFor(() =>
                expect(mockSession.abort).toHaveBeenCalledOnce(),
            );
        });
    });

    // -------------------------------------------------------------------------
    // awaitChargeState()
    // -------------------------------------------------------------------------

    describe('awaitChargeState()', () => {
        it('throws synchronously when paymentId is empty', () => {
            expect(() => payments.awaitChargeState('')).toThrow(
                'paymentId is required',
            );
        });

        it('resolves with charge state when SUCCEEDED on first poll', async () => {
            const succeededState = {
                id: 'pay_300000001',
                state: 'SUCCEEDED',
                payment_instrument: { payment_instrument: 'PAYMENT_CARD' },
                return_url: 'https://example.com/return',
            };
            fetchMock.mockResolvedValue(makeResponse(succeededState));

            const result = await payments.awaitChargeState('pay_300000001', {
                intervalMs: 10,
                initialTimeoutMs: 5000,
            });

            expect(result.state).toBe('SUCCEEDED');
            expect(result.id).toBe('pay_300000001');
        });

        it('rejects with CHARGE_FAILED when charge state is FAILED', async () => {
            const failedState = {
                id: 'pay_300000001',
                state: 'FAILED',
                payment_instrument: { payment_instrument: 'PAYMENT_CARD' },
                return_url: 'https://example.com/return',
            };
            fetchMock.mockResolvedValue(makeResponse(failedState));

            const err = await payments
                .awaitChargeState('pay_300000001', {
                    intervalMs: 10,
                    initialTimeoutMs: 5000,
                })
                .catch((e: unknown) => e);

            expect(err).toBeInstanceOf(GoPaySDKError);
            expect((err as GoPaySDKError).errorCode).toBe(
                GoPayErrorCodes.CHARGE_FAILED,
            );
        });

        it('rejects with CHARGE_TIMEOUT when charge stays in REQUESTED within timeout', async () => {
            vi.useFakeTimers();

            fetchMock.mockImplementation(async () =>
                makeResponse({
                    id: 'pay_300000001',
                    state: 'REQUESTED',
                    payment_instrument: { payment_instrument: 'PAYMENT_CARD' },
                }),
            );

            const promise = payments.awaitChargeState('pay_300000001', {
                intervalMs: 100,
                initialTimeoutMs: 500,
            });

            // Attach catch before advancing timers so the rejection is not unhandled.
            const errPromise = promise.catch((e: unknown) => e);

            await vi.advanceTimersByTimeAsync(600);
            vi.clearAllTimers();
            vi.useRealTimers();

            const err = await errPromise;

            expect(err).toBeInstanceOf(GoPaySDKError);
            expect((err as GoPaySDKError).errorCode).toBe(
                GoPayErrorCodes.CHARGE_TIMEOUT,
            );
        });

        it('fires onActionRequired when ACTION_REQUIRED state is polled', async () => {
            fetchMock
                .mockResolvedValueOnce(
                    makeResponse({
                        id: 'pay_300000001',
                        state: 'ACTION_REQUIRED',
                        action: { redirect_url: 'https://3ds.example.com' },
                    }),
                )
                .mockResolvedValue(
                    makeResponse({
                        id: 'pay_300000001',
                        state: 'SUCCEEDED',
                    }),
                );

            const onActionRequired = vi.fn();
            const result = await payments.awaitChargeState('pay_300000001', {
                intervalMs: 10,
                initialTimeoutMs: 5000,
                onActionRequired,
            });

            expect(onActionRequired).toHaveBeenCalledOnce();
            expect(onActionRequired).toHaveBeenCalledWith(
                'https://3ds.example.com',
            );
            expect(result.state).toBe('SUCCEEDED');
        });

        it('fires onStateChange for each polled state including terminal', async () => {
            fetchMock
                .mockResolvedValueOnce(
                    makeResponse({
                        id: 'pay_300000001',
                        state: 'PROCESSING',
                    }),
                )
                .mockResolvedValue(
                    makeResponse({
                        id: 'pay_300000001',
                        state: 'SUCCEEDED',
                    }),
                );

            const onStateChange = vi.fn();
            await payments.awaitChargeState('pay_300000001', {
                intervalMs: 10,
                initialTimeoutMs: 5000,
                onStateChange,
            });

            expect(onStateChange).toHaveBeenCalledTimes(2);
            expect(onStateChange).toHaveBeenCalledWith(
                expect.objectContaining({ state: 'PROCESSING' }),
            );
            expect(onStateChange).toHaveBeenCalledWith(
                expect.objectContaining({ state: 'SUCCEEDED' }),
            );
        });

        it('rejects with CHARGE_FAILED when aborted via AbortSignal', async () => {
            fetchMock.mockImplementation(async () =>
                makeResponse({
                    id: 'pay_300000001',
                    state: 'REQUESTED',
                }),
            );

            const ac = new AbortController();
            const promise = payments.awaitChargeState('pay_300000001', {
                intervalMs: 50,
                initialTimeoutMs: 5000,
                signal: ac.signal,
            });

            ac.abort();

            const err = await promise.catch((e: unknown) => e);
            expect(err).toBeInstanceOf(GoPaySDKError);
            expect((err as GoPaySDKError).errorCode).toBe(
                GoPayErrorCodes.CHARGE_FAILED,
            );
        });

        it('rejects immediately with CHARGE_FAILED when signal is already aborted', async () => {
            const ac = new AbortController();
            ac.abort();

            const err = await payments
                .awaitChargeState('pay_300000001', {
                    signal: ac.signal,
                })
                .catch((e: unknown) => e);

            expect(err).toBeInstanceOf(GoPaySDKError);
            expect((err as GoPaySDKError).errorCode).toBe(
                GoPayErrorCodes.CHARGE_FAILED,
            );
        });

        it('attaches chargeState to the CHARGE_FAILED error when state is FAILED', async () => {
            const failedState = {
                id: 'pay_300000001',
                state: 'FAILED',
                payment_instrument: { payment_instrument: 'PAYMENT_CARD' },
                return_url: 'https://example.com/return',
            };
            fetchMock.mockResolvedValue(makeResponse(failedState));

            const err = await payments
                .awaitChargeState('pay_300000001', {
                    intervalMs: 10,
                    initialTimeoutMs: 5000,
                })
                .catch((e: unknown) => e);

            expect(err).toBeInstanceOf(GoPaySDKError);
            expect((err as GoPaySDKError).errorCode).toBe(
                GoPayErrorCodes.CHARGE_FAILED,
            );
            expect((err as GoPaySDKError).chargeState).toEqual(failedState);
        });
    });

    // -------------------------------------------------------------------------
    // awaitPaymentStatus()
    // -------------------------------------------------------------------------

    describe('awaitPaymentStatus()', () => {
        it('throws synchronously when paymentId is empty', () => {
            expect(() => payments.awaitPaymentStatus('')).toThrow(
                'paymentId is required',
            );
        });

        it('resolves with payment details when PAID on first poll', async () => {
            const paidState = { ...mockPaymentResponse, state: 'PAID' };
            fetchMock.mockResolvedValue(makeResponse(paidState));

            const result = await payments.awaitPaymentStatus('pay_300000001', {
                intervalMs: 10,
            });

            expect(result.state).toBe('PAID');
            expect(result.id).toBe('pay_300000001');
        });

        it('polls until a terminal state is reached', async () => {
            const pendingState = { ...mockPaymentResponse, state: 'CREATED' };
            const paidState = { ...mockPaymentResponse, state: 'PAID' };

            fetchMock
                .mockResolvedValueOnce(makeResponse(pendingState))
                .mockResolvedValueOnce(makeResponse(pendingState))
                .mockResolvedValue(makeResponse(paidState));

            const result = await payments.awaitPaymentStatus('pay_300000001', {
                intervalMs: 10,
            });

            expect(result.state).toBe('PAID');
            expect(fetchMock).toHaveBeenCalledTimes(3);
        });

        it('resolves on CANCELED terminal state', async () => {
            fetchMock.mockResolvedValue(
                makeResponse({ ...mockPaymentResponse, state: 'CANCELED' }),
            );

            const result = await payments.awaitPaymentStatus('pay_300000001', {
                intervalMs: 10,
            });

            expect(result.state).toBe('CANCELED');
        });

        it('rejects with CHARGE_TIMEOUT when timeoutMs expires', async () => {
            vi.useFakeTimers();

            fetchMock.mockImplementation(async () =>
                makeResponse({ ...mockPaymentResponse, state: 'CREATED' }),
            );

            const promise = payments.awaitPaymentStatus('pay_300000001', {
                intervalMs: 100,
                timeoutMs: 500,
            });

            const errPromise = promise.catch((e: unknown) => e);

            await vi.advanceTimersByTimeAsync(600);
            vi.clearAllTimers();
            vi.useRealTimers();

            const err = await errPromise;

            expect(err).toBeInstanceOf(GoPaySDKError);
            expect((err as GoPaySDKError).errorCode).toBe(
                GoPayErrorCodes.CHARGE_TIMEOUT,
            );
        });

        it('rejects with CHARGE_FAILED when aborted via AbortSignal', async () => {
            fetchMock.mockImplementation(async () =>
                makeResponse({ ...mockPaymentResponse, state: 'CREATED' }),
            );

            const ac = new AbortController();
            const promise = payments.awaitPaymentStatus('pay_300000001', {
                intervalMs: 50,
                signal: ac.signal,
            });

            ac.abort();

            const err = await promise.catch((e: unknown) => e);
            expect(err).toBeInstanceOf(GoPaySDKError);
            expect((err as GoPaySDKError).errorCode).toBe(
                GoPayErrorCodes.CHARGE_FAILED,
            );
        });

        it('rejects immediately with CHARGE_FAILED when signal is already aborted', async () => {
            const ac = new AbortController();
            ac.abort();

            const err = await payments
                .awaitPaymentStatus('pay_300000001', { signal: ac.signal })
                .catch((e: unknown) => e);

            expect(err).toBeInstanceOf(GoPaySDKError);
            expect((err as GoPaySDKError).errorCode).toBe(
                GoPayErrorCodes.CHARGE_FAILED,
            );
        });

        it('fires onStateChange for each polled state including terminal', async () => {
            fetchMock
                .mockResolvedValueOnce(
                    makeResponse({ ...mockPaymentResponse, state: 'CREATED' }),
                )
                .mockResolvedValue(
                    makeResponse({ ...mockPaymentResponse, state: 'PAID' }),
                );

            const onStateChange = vi.fn();
            await payments.awaitPaymentStatus('pay_300000001', {
                intervalMs: 10,
                onStateChange,
            });

            expect(onStateChange).toHaveBeenCalledTimes(2);
            expect(onStateChange).toHaveBeenCalledWith(
                expect.objectContaining({ state: 'CREATED' }),
            );
            expect(onStateChange).toHaveBeenCalledWith(
                expect.objectContaining({ state: 'PAID' }),
            );
        });

        it('resolves with custom terminal states', async () => {
            fetchMock.mockResolvedValue(
                makeResponse({ ...mockPaymentResponse, state: 'PROCESSING' }),
            );

            const result = await payments.awaitPaymentStatus('pay_300000001', {
                intervalMs: 10,
                terminalStates: ['PROCESSING'],
            });

            expect(result.state).toBe('PROCESSING');
        });

        it('does not resolve on default terminal state when custom terminalStates excludes it', async () => {
            fetchMock
                .mockResolvedValueOnce(
                    makeResponse({ ...mockPaymentResponse, state: 'PAID' }),
                )
                .mockResolvedValue(
                    makeResponse({ ...mockPaymentResponse, state: 'CANCELED' }),
                );

            const result = await payments.awaitPaymentStatus('pay_300000001', {
                intervalMs: 10,
                terminalStates: ['CANCELED'],
            });

            expect(result.state).toBe('CANCELED');
            expect(fetchMock).toHaveBeenCalledTimes(2);
        });
    });

    describe('getQRPaymentInfo()', () => {
        const mockQRPaymentResponse = {
            amount: 10000,
            currency: 'CZK',
            recipient: {
                name: 'GoPay Czech',
                bank_account: {
                    international: {
                        bic: 'FIOBCZPP',
                        iban: 'CZ5120100000000009878039',
                        reference: '3123456789',
                    },
                },
            },
            qr_code: {
                spayd: 'base64encodedQR==',
            },
        };

        beforeEach(() => {
            fetchMock.mockResolvedValue(makeResponse(mockQRPaymentResponse));
        });

        it('sends GET to /payments/{paymentId}/qr-payment/info', async () => {
            let capturedReq!: Request;
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                return makeResponse(mockQRPaymentResponse);
            });

            await payments.getQRPaymentInfo('pay_300000001');

            expect(capturedReq.method).toBe('GET');
            expect(capturedReq.url).toBe(
                'https://example.com/payments/pay_300000001/qr-payment/info',
            );
        });

        it('interpolates paymentId correctly into the URL', async () => {
            let capturedUrl = '';
            fetchMock.mockImplementation(async (req: Request) => {
                capturedUrl = req.url;
                return makeResponse(mockQRPaymentResponse);
            });

            await payments.getQRPaymentInfo('pay_999');

            expect(capturedUrl).toContain('/payments/pay_999/qr-payment/info');
        });

        it('appends ?format=svg when format is provided', async () => {
            let capturedUrl = '';
            fetchMock.mockImplementation(async (req: Request) => {
                capturedUrl = req.url;
                return makeResponse(mockQRPaymentResponse);
            });

            await payments.getQRPaymentInfo('pay_300000001', 'svg');

            expect(capturedUrl).toContain(
                '/payments/pay_300000001/qr-payment/info?format=svg',
            );
        });

        it('does not append format when not provided', async () => {
            let capturedUrl = '';
            fetchMock.mockImplementation(async (req: Request) => {
                capturedUrl = req.url;
                return makeResponse(mockQRPaymentResponse);
            });

            await payments.getQRPaymentInfo('pay_300000001');

            expect(capturedUrl).not.toContain('format');
        });

        it('sends Bearer token from token store', async () => {
            let capturedReq!: Request;
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                return makeResponse(mockQRPaymentResponse);
            });

            await payments.getQRPaymentInfo('pay_300000001');

            expect(capturedReq.headers.get('Authorization')).toBe(
                'Bearer at-test',
            );
        });

        it('returns the QR payment info response', async () => {
            const result = await payments.getQRPaymentInfo('pay_300000001');

            expect(result).toEqual(mockQRPaymentResponse);
            expect(result.qr_code?.spayd).toBe('base64encodedQR==');
        });
    });
});
