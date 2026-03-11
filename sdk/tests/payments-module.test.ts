import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpClient } from '../src/http/client.js';
import type { TokenStore } from '../src/http/token-store.js';
import { PaymentsModule } from '../src/modules/payments/payments.module.js';

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
            expect(result.gw_url).toBe(
                'https://gw.gopay.com/gw/v3/bCcvmwTKK5hrJx2aGG8ZnFyBJhAvF',
            );
        });
    });

    describe('charge()', () => {
        beforeEach(() => {
            fetchMock.mockResolvedValue(makeResponse(mockChargeResponse, 201));
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

            expect(JSON.parse(capturedBody)).toEqual(chargeParams);
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
    });

    describe('getGooglePayInfo()', () => {
        const mockGooglePayResponse = {
            environment: 'TEST',
            paymentDataRequest: {
                apiVersion: 2,
                apiVersionMinor: 0,
                merchantInfo: { merchantName: 'GoPay Czech Branch' },
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

        it('returns the Google Pay info response', async () => {
            const result = await payments.getGooglePayInfo('pay_300000001');

            expect(result).toEqual(mockGooglePayResponse);
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

    describe('validateApplePayMerchant()', () => {
        const mockValidateMerchantResponse = {
            epochTimestamp: 15445664606792,
            expiresAt: 154167344466792,
            merchantSessionIdentifier: 'SSHC45CB',
            nonce: '8f47a9c1',
            merchantIdentifier: '8398119642',
            domainName: 'www.example.com',
            displayName: 'GoPay Czech Branch',
        };

        beforeEach(() => {
            fetchMock.mockResolvedValue(
                makeResponse(mockValidateMerchantResponse),
            );
        });

        it('sends POST to /payments/{paymentId}/apple-pay/validate', async () => {
            let capturedReq!: Request;
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                await req.text();
                return makeResponse(mockValidateMerchantResponse);
            });

            await payments.validateApplePayMerchant(
                'pay_300000001',
                'https://shop.example.com',
            );

            expect(capturedReq.method).toBe('POST');
            expect(capturedReq.url).toBe(
                'https://example.com/payments/pay_300000001/apple-pay/validate',
            );
        });

        it('interpolates paymentId correctly into the URL', async () => {
            let capturedUrl = '';
            fetchMock.mockImplementation(async (req: Request) => {
                capturedUrl = req.url;
                await req.text();
                return makeResponse(mockValidateMerchantResponse);
            });

            await payments.validateApplePayMerchant(
                'pay_999',
                'https://shop.example.com',
            );

            expect(capturedUrl).toContain(
                '/payments/pay_999/apple-pay/validate',
            );
        });

        it('sends the Origin header', async () => {
            let capturedReq!: Request;
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                await req.text();
                return makeResponse(mockValidateMerchantResponse);
            });

            await payments.validateApplePayMerchant(
                'pay_300000001',
                'https://shop.example.com',
            );

            expect(capturedReq.headers.get('Origin')).toBe(
                'https://shop.example.com',
            );
        });

        it('sends Bearer token from token store', async () => {
            let capturedReq!: Request;
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                await req.text();
                return makeResponse(mockValidateMerchantResponse);
            });

            await payments.validateApplePayMerchant(
                'pay_300000001',
                'https://shop.example.com',
            );

            expect(capturedReq.headers.get('Authorization')).toBe(
                'Bearer at-test',
            );
        });

        it('returns the validate merchant response', async () => {
            const result = await payments.validateApplePayMerchant(
                'pay_300000001',
                'https://shop.example.com',
            );

            expect(result).toEqual(mockValidateMerchantResponse);
            expect(result.domainName).toBe('www.example.com');
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
