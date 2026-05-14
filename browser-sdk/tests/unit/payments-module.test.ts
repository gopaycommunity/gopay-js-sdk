import { createHttpClient } from '@gopay-internal/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPaymentsApi } from '../../src/modules/payments/payments.module.js';

const makeResponse = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
    });

const PAYMENT_ID = 'pay_browser_001';

const storedToken = {
    access_token: 'at-test',
    refresh_token: 'rt-test',
    expires_in: 900,
    refresh_expires_in: 0,
    token_type: 'bearer' as const,
};

describe('createPaymentsApi() — browser SDK', () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    let client: ReturnType<typeof createHttpClient>;
    let api: ReturnType<typeof createPaymentsApi>;

    beforeEach(() => {
        fetchMock = vi.fn().mockResolvedValue(makeResponse({}));
        vi.stubGlobal('fetch', fetchMock);
        client = createHttpClient({ baseUrl: 'https://example.com' });
        client.setToken(storedToken);
        api = createPaymentsApi(client, PAYMENT_ID);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // -------------------------------------------------------------------------
    // getStatus()
    // -------------------------------------------------------------------------

    describe('getStatus()', () => {
        it('sends GET to /payments/{paymentId}', async () => {
            let capturedReq!: Request;
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                return makeResponse({});
            });

            await api.getStatus();

            expect(capturedReq.method).toBe('GET');
            expect(capturedReq.url).toBe(
                `https://example.com/payments/${PAYMENT_ID}`,
            );
        });
    });

    // -------------------------------------------------------------------------
    // chargePayment()
    // -------------------------------------------------------------------------

    describe('chargePayment()', () => {
        it('sends POST to /payments/{paymentId}/charge', async () => {
            let capturedReq!: Request;
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                await req.text();
                return makeResponse({});
            });

            await api.chargePayment({});

            expect(capturedReq.method).toBe('POST');
            expect(capturedReq.url).toBe(
                `https://example.com/payments/${PAYMENT_ID}/charge`,
            );
        });

        it('injects browser_data into PAYMENT_CARD instrument', async () => {
            let capturedBody = '';
            fetchMock.mockImplementation(async (req: Request) => {
                capturedBody = await req.text();
                return makeResponse({});
            });

            await api.chargePayment({
                payment_instrument: {
                    payment_instrument: 'PAYMENT_CARD',
                    input: {
                        input_type: 'Encrypted-Card-Input',
                        payload: 'enc_payload',
                    },
                },
            });

            const body = JSON.parse(capturedBody);
            expect(body.payment_instrument.browser_data).toBeDefined();
            expect(
                body.payment_instrument.browser_data.javascript_enabled,
            ).toBe(true);
        });

        it('caller-supplied browser_data fields override collected values', async () => {
            let capturedBody = '';
            fetchMock.mockImplementation(async (req: Request) => {
                capturedBody = await req.text();
                return makeResponse({});
            });

            await api.chargePayment({
                payment_instrument: {
                    payment_instrument: 'PAYMENT_CARD',
                    input: {
                        input_type: 'Encrypted-Card-Input',
                        payload: 'enc_payload',
                    },
                    browser_data: { language: 'fr-FR' },
                },
            });

            const body = JSON.parse(capturedBody);
            expect(body.payment_instrument.browser_data.language).toBe('fr-FR');
        });

        it('does not inject browser_data for non-PAYMENT_CARD instruments', async () => {
            let capturedBody = '';
            fetchMock.mockImplementation(async (req: Request) => {
                capturedBody = await req.text();
                return makeResponse({});
            });

            await api.chargePayment({});

            const body = JSON.parse(capturedBody);
            expect(body.payment_instrument?.browser_data).toBeUndefined();
        });
    });

    // -------------------------------------------------------------------------
    // getChargeState()
    // -------------------------------------------------------------------------

    describe('getChargeState()', () => {
        it('sends GET to /payments/{paymentId}/charge', async () => {
            let capturedReq!: Request;
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                return makeResponse({});
            });

            await api.getChargeState();

            expect(capturedReq.method).toBe('GET');
            expect(capturedReq.url).toBe(
                `https://example.com/payments/${PAYMENT_ID}/charge`,
            );
        });
    });

    // -------------------------------------------------------------------------
    // Wallet info endpoints
    // -------------------------------------------------------------------------

    describe('getGooglePayInfo()', () => {
        it('sends GET to /payments/{paymentId}/google-pay/info', async () => {
            let capturedUrl = '';
            fetchMock.mockImplementation(async (req: Request) => {
                capturedUrl = req.url;
                return makeResponse({});
            });

            await api.getGooglePayInfo();
            expect(capturedUrl).toBe(
                `https://example.com/payments/${PAYMENT_ID}/google-pay/info`,
            );
        });
    });

    describe('getApplePayInfo()', () => {
        it('sends GET to /payments/{paymentId}/apple-pay/info', async () => {
            let capturedUrl = '';
            fetchMock.mockImplementation(async (req: Request) => {
                capturedUrl = req.url;
                return makeResponse({});
            });

            await api.getApplePayInfo();
            expect(capturedUrl).toBe(
                `https://example.com/payments/${PAYMENT_ID}/apple-pay/info`,
            );
        });
    });

    describe('getApplePayAppInfo()', () => {
        it('sends GET to /payments/{paymentId}/apple-pay/app-info', async () => {
            let capturedUrl = '';
            fetchMock.mockImplementation(async (req: Request) => {
                capturedUrl = req.url;
                return makeResponse({});
            });

            await api.getApplePayAppInfo();
            expect(capturedUrl).toBe(
                `https://example.com/payments/${PAYMENT_ID}/apple-pay/app-info`,
            );
        });
    });

    // -------------------------------------------------------------------------
    // getQRPaymentInfo()
    // -------------------------------------------------------------------------

    describe('getQRPaymentInfo()', () => {
        it('does not append format param by default', async () => {
            let capturedUrl = '';
            fetchMock.mockImplementation(async (req: Request) => {
                capturedUrl = req.url;
                return makeResponse({});
            });

            await api.getQRPaymentInfo();
            expect(capturedUrl).not.toContain('format=');
        });

        it('appends ?format=png when requested', async () => {
            let capturedUrl = '';
            fetchMock.mockImplementation(async (req: Request) => {
                capturedUrl = req.url;
                return makeResponse({});
            });

            await api.getQRPaymentInfo('png');
            expect(capturedUrl).toContain('format=png');
        });

        it('appends ?format=svg when requested', async () => {
            let capturedUrl = '';
            fetchMock.mockImplementation(async (req: Request) => {
                capturedUrl = req.url;
                return makeResponse({});
            });

            await api.getQRPaymentInfo('svg');
            expect(capturedUrl).toContain('format=svg');
        });
    });

    // -------------------------------------------------------------------------
    // startApplePaySession()
    // -------------------------------------------------------------------------

    describe('startApplePaySession()', () => {
        function makeMockSession() {
            return {
                onvalidatemerchant: null as ((event: unknown) => void) | null,
                oncancel: null as ((event: unknown) => void) | null,
                completeMerchantValidation: vi.fn(),
                abort: vi.fn(),
                begin: vi.fn(),
            };
        }

        it('calls session.begin()', () => {
            const session = makeMockSession();
            api.startApplePaySession(session, 'https://example.com');
            expect(session.begin).toHaveBeenCalledOnce();
        });

        it('throws on an unparseable origin string', () => {
            const session = makeMockSession();
            expect(() =>
                api.startApplePaySession(session, 'not-a-url'),
            ).toThrow();
        });

        it('throws when origin uses http: instead of https:', () => {
            const session = makeMockSession();
            expect(() =>
                api.startApplePaySession(session, 'http://example.com'),
            ).toThrow('https:');
        });

        it('wires onvalidatemerchant to call completeMerchantValidation on success', async () => {
            const merchantSession = { key: 'ms_token' };
            fetchMock.mockImplementation(async (req: Request) => {
                await req.text();
                return makeResponse(merchantSession);
            });

            const session = makeMockSession();
            api.startApplePaySession(session, 'https://example.com');

            session.onvalidatemerchant?.({
                validationURL: 'https://apple.com/validate',
            });
            await new Promise((r) => setTimeout(r, 0));

            expect(session.completeMerchantValidation).toHaveBeenCalledWith(
                merchantSession,
            );
        });

        it('calls session.abort() when merchant validation returns an HTTP error', async () => {
            fetchMock.mockImplementation(
                async () =>
                    new Response(null, { status: 500, statusText: 'Error' }),
            );

            const session = makeMockSession();
            api.startApplePaySession(session, 'https://example.com');

            session.onvalidatemerchant?.({});
            await new Promise((r) => setTimeout(r, 10));

            expect(session.abort).toHaveBeenCalledOnce();
        });

        it('fires the oncancel callback when the session is cancelled', () => {
            const session = makeMockSession();
            const oncancel = vi.fn();
            api.startApplePaySession(session, 'https://example.com', {
                oncancel,
            });

            session.oncancel?.({ type: 'cancel' });
            expect(oncancel).toHaveBeenCalledWith({ type: 'cancel' });
        });
    });
});
