import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpClient } from '../../src/http/client.js';
import type { TokenStore } from '../../src/http/token-store.js';
import { PaymentsModule } from '../../src/modules/payments/payments.module.js';

const tokenStore = (client: HttpClient) =>
    (client as unknown as { tokenStore: TokenStore }).tokenStore;

const makeResponse = (data: unknown, status = 200, statusText = 'OK') =>
    new Response(JSON.stringify(data), {
        status,
        statusText,
        headers: { 'content-type': 'application/json' },
    });

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
    let client: HttpClient;
    let payments: PaymentsModule;

    beforeEach(() => {
        fetchMock = vi
            .fn()
            .mockResolvedValue(makeResponse(mockPaymentResponse));
        vi.stubGlobal('fetch', fetchMock);
        client = new HttpClient({ baseUrl: 'https://example.com' });
        tokenStore(client).set({
            access_token: 'at-test',
            refresh_token: 'rt-test',
            expires_in: 900,
            refresh_expires_in: 86400,
            token_type: 'bearer',
        });
        payments = new PaymentsModule(client);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('create()', () => {
        it('sends POST to /eshops/{goid}/payments', async () => {
            let capturedReq!: Request;
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                await req.text();
                return makeResponse(mockPaymentResponse);
            });

            await payments.create('goid-123', createParams);

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

            await payments.create('merchant-456', createParams);

            expect(capturedUrl).toContain('/eshops/merchant-456/payments');
        });

        it('sends JSON body with payment params', async () => {
            let capturedBody = '';
            fetchMock.mockImplementation(async (req: Request) => {
                capturedBody = await req.text();
                return makeResponse(mockPaymentResponse);
            });

            await payments.create('goid-123', createParams);

            expect(JSON.parse(capturedBody)).toEqual(createParams);
        });

        it('sends Content-Type: application/json', async () => {
            let capturedReq!: Request;
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                await req.text();
                return makeResponse(mockPaymentResponse);
            });

            await payments.create('goid-123', createParams);

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

            await payments.create('goid-123', createParams);

            expect(capturedReq.headers.get('Authorization')).toBe(
                'Bearer at-test',
            );
        });

        it('returns the payment response', async () => {
            const result = await payments.create('goid-123', createParams);

            expect(result).toEqual(mockPaymentResponse);
            expect(result.id).toBe('pay_300000001');
        });
    });

    describe('charge()', () => {
        beforeEach(() => {
            fetchMock.mockResolvedValue(makeResponse(mockChargeResponse, 201));
            vi.stubGlobal('navigator', {
                language: 'en-US',
                userAgent: 'test-agent',
            });
            vi.stubGlobal('screen', {
                width: 1920,
                height: 1080,
                colorDepth: 24,
            });
        });

        it('sends POST to /payments/{paymentId}/charge', async () => {
            let capturedReq!: Request;
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                await req.text();
                return makeResponse(mockChargeResponse, 201);
            });

            await payments.charge('pay_300000001', chargeParams);

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

            await payments.charge('pay_999', chargeParams);

            expect(capturedUrl).toContain('/payments/pay_999/charge');
        });

        it('sends JSON body with charge params', async () => {
            let capturedBody = '';
            fetchMock.mockImplementation(async (req: Request) => {
                capturedBody = await req.text();
                return makeResponse(mockChargeResponse, 201);
            });

            await payments.charge('pay_300000001', chargeParams);

            expect(JSON.parse(capturedBody)).toMatchObject(chargeParams);
        });

        it('sends Content-Type: application/json', async () => {
            let capturedReq!: Request;
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                await req.text();
                return makeResponse(mockChargeResponse, 201);
            });

            await payments.charge('pay_300000001', chargeParams);

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

            await payments.charge('pay_300000001', chargeParams);

            expect(capturedReq.headers.get('Authorization')).toBe(
                'Bearer at-test',
            );
        });

        it('returns the charge response', async () => {
            const result = await payments.charge('pay_300000001', chargeParams);

            expect(result).toEqual(mockChargeResponse);
            expect(result.id).toBe('pay_300000001');
            expect(result.state).toBe('REQUESTED');
        });

        it('auto-injects browser_data into charge request body', async () => {
            let capturedBody = '';
            fetchMock.mockImplementation(async (req: Request) => {
                capturedBody = await req.text();
                return makeResponse(mockChargeResponse, 201);
            });

            await payments.charge('pay_300000001', chargeParams);

            const body = JSON.parse(capturedBody);
            expect(body.browser_data).toMatchObject({
                language: 'en-US',
                user_agent: 'test-agent',
                screen_width: 1920,
                screen_height: 1080,
                color_depth: 24,
                javascript_enabled: true,
                java_enabled: false,
            });
        });

        it('caller-supplied browser_data fields override auto-collected values', async () => {
            let capturedBody = '';
            fetchMock.mockImplementation(async (req: Request) => {
                capturedBody = await req.text();
                return makeResponse(mockChargeResponse, 201);
            });

            await payments.charge('pay_300000001', {
                ...chargeParams,
                browser_data: { language: 'fr-FR', ip: '1.2.3.4' },
            });

            const body = JSON.parse(capturedBody);
            expect(body.browser_data.language).toBe('fr-FR');
            expect(body.browser_data.ip).toBe('1.2.3.4');
            // auto-collected fields still present for non-overridden keys
            expect(body.browser_data.user_agent).toBe('test-agent');
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

    describe('charge() with Google Pay instrument', () => {
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

            await payments.charge('pay_300000001', googlePayChargeParams);

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

            await payments.charge('pay_300000001', googlePayChargeParams);

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

            await payments.charge('pay_300000001', googlePayChargeParams);

            expect(capturedReq.headers.get('Authorization')).toBe(
                'Bearer at-test',
            );
        });

        it('returns the charge response', async () => {
            const result = await payments.charge(
                'pay_300000001',
                googlePayChargeParams,
            );

            expect(result).toEqual(mockGooglePayChargeResponse);
            expect(result.state).toBe('REQUESTED');
        });
    });

    describe('charge() with Apple Pay instrument', () => {
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

            await payments.charge('pay_300000001', applePayChargeParams);

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

            await payments.charge('pay_300000001', applePayChargeParams);

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

            await payments.charge('pay_300000001', applePayChargeParams);

            expect(capturedReq.headers.get('Authorization')).toBe(
                'Bearer at-test',
            );
        });

        it('returns the charge response', async () => {
            const result = await payments.charge(
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

    describe('startApplePaySession()', () => {
        const mockMerchantSession = { merchantSessionIdentifier: 'ms-abc123' };

        function makeSession() {
            return {
                onvalidatemerchant: null as ((event: unknown) => void) | null,
                completeMerchantValidation: vi.fn(),
                abort: vi.fn(),
                begin: vi.fn(),
            };
        }

        it('sets onvalidatemerchant and calls session.begin()', () => {
            const session = makeSession();
            payments.startApplePaySession(
                'pay_123',
                session,
                'https://shop.example.com',
            );
            expect(typeof session.onvalidatemerchant).toBe('function');
            expect(session.begin).toHaveBeenCalledOnce();
        });

        it('calls completeMerchantValidation with the API response on success', async () => {
            fetchMock.mockImplementation(async (req: Request) => {
                if (req.url.includes('/apple-pay/validate')) {
                    return makeResponse(mockMerchantSession);
                }
                return makeResponse({});
            });

            const session = makeSession();
            payments.startApplePaySession(
                'pay_123',
                session,
                'https://shop.example.com',
            );
            (session.onvalidatemerchant as (e: unknown) => void)({});
            await new Promise((r) => setTimeout(r, 10));

            expect(session.completeMerchantValidation).toHaveBeenCalledWith(
                mockMerchantSession,
            );
            expect(session.abort).not.toHaveBeenCalled();
        });

        it('calls session.abort() when merchant validation fails', async () => {
            fetchMock.mockImplementation(async (req: Request) => {
                if (req.url.includes('/apple-pay/validate')) {
                    await req.text();
                    return makeResponse(
                        { error: 'FORBIDDEN' },
                        403,
                        'Forbidden',
                    );
                }
                return makeResponse({});
            });

            const session = makeSession();
            payments.startApplePaySession(
                'pay_123',
                session,
                'https://shop.example.com',
            );
            (session.onvalidatemerchant as (e: unknown) => void)({});
            await new Promise((r) => setTimeout(r, 10));

            expect(session.abort).toHaveBeenCalledOnce();
            expect(session.completeMerchantValidation).not.toHaveBeenCalled();
        });

        it('POSTs to /payments/{paymentId}/apple-pay/validate with Origin header', async () => {
            let capturedReq: Request | undefined;
            fetchMock.mockImplementation(async (req: Request) => {
                if (req.url.includes('/apple-pay/validate')) {
                    capturedReq = req;
                    return makeResponse(mockMerchantSession);
                }
                return makeResponse({});
            });

            const session = makeSession();
            payments.startApplePaySession(
                'pay_abc',
                session,
                'https://merchant.example.com',
            );
            (session.onvalidatemerchant as (e: unknown) => void)({});
            await new Promise((r) => setTimeout(r, 10));

            expect(capturedReq?.method).toBe('POST');
            expect(capturedReq?.url).toContain(
                '/payments/pay_abc/apple-pay/validate',
            );
            expect(capturedReq?.headers.get('Origin')).toBe(
                'https://merchant.example.com',
            );
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
