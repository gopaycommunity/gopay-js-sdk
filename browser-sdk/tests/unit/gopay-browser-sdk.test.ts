import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoPayErrorCodes, GoPaySDKError } from '../../src/errors.js';
import { createGoPayBrowserSDK } from '../../src/gopay-browser-sdk.js';

const CARD_FORM_URL = 'https://test.gopay.com/card-form';

const makeResponse = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
    });

const validTokenPair = {
    access_token: 'at-attach',
    expires_in: 1800,
    token_type: 'bearer',
};

describe('createGoPayBrowserSDK()', () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    let sdk: ReturnType<typeof createGoPayBrowserSDK>;

    beforeEach(() => {
        fetchMock = vi.fn().mockResolvedValue(makeResponse({}));
        vi.stubGlobal('fetch', fetchMock);
        sdk = createGoPayBrowserSDK({
            baseUrl: 'https://example.com',
            shareableKey: 'pk_test',
            clientId: 'cid_test',
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    // -------------------------------------------------------------------------
    // notAttached guard — payment methods before attachPayment
    // -------------------------------------------------------------------------

    describe('payment methods before attachPayment()', () => {
        it.each([
            ['getStatus', () => sdk.getStatus()],
            ['chargePayment', () => sdk.chargePayment({})],
            ['getChargeState', () => sdk.getChargeState()],
            ['getGooglePayInfo', () => sdk.getGooglePayInfo()],
            ['getApplePayInfo', () => sdk.getApplePayInfo()],
            ['getApplePayAppInfo', () => sdk.getApplePayAppInfo()],
            ['getQRPaymentInfo', () => sdk.getQRPaymentInfo()],
        ])('%s() throws PAYMENT_NOT_ATTACHED', async (_, call) => {
            const err = await (call() as Promise<unknown>).catch(
                (e: unknown) => e,
            );
            expect(err).toBeInstanceOf(GoPaySDKError);
            expect((err as GoPaySDKError).errorCode).toBe(
                GoPayErrorCodes.PAYMENT_NOT_ATTACHED,
            );
        });

        it('awaitChargeState() throws PAYMENT_NOT_ATTACHED synchronously', () => {
            expect(() => sdk.awaitChargeState()).toThrow(GoPaySDKError);
        });

        it('startApplePaySession() throws PAYMENT_NOT_ATTACHED before attachPayment', () => {
            const session = {
                onvalidatemerchant: null as ((e: unknown) => void) | null,
                oncancel: null as ((e: unknown) => void) | null,
                completeMerchantValidation: vi.fn(),
                abort: vi.fn(),
                begin: vi.fn(),
            };
            expect(() =>
                sdk.startApplePaySession(session, 'https://example.com'),
            ).toThrow(
                expect.objectContaining({
                    errorCode: GoPayErrorCodes.PAYMENT_NOT_ATTACHED,
                }),
            );
        });
    });

    // -------------------------------------------------------------------------
    // isAuthenticated() / logout()
    // -------------------------------------------------------------------------

    describe('isAuthenticated()', () => {
        it('returns false before attachPayment', () => {
            expect(sdk.isAuthenticated()).toBe(false);
        });

        it('returns true after successful attachPayment', async () => {
            fetchMock.mockResolvedValue(makeResponse(validTokenPair));
            await sdk.attachPayment({
                paymentId: 'pay_001',
                paymentSecret: 'secret',
            });
            expect(sdk.isAuthenticated()).toBe(true);
        });
    });

    describe('logout()', () => {
        it('clears the stored token so isAuthenticated returns false', async () => {
            fetchMock.mockResolvedValue(makeResponse(validTokenPair));
            await sdk.attachPayment({
                paymentId: 'pay_001',
                paymentSecret: 'secret',
            });
            sdk.logout();
            expect(sdk.isAuthenticated()).toBe(false);
        });
    });

    // -------------------------------------------------------------------------
    // attachPayment()
    // -------------------------------------------------------------------------

    describe('attachPayment()', () => {
        it('exchanges the payment secret via payment_credentials grant with Basic auth', async () => {
            let capturedReq!: Request;
            let capturedBody = '';
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                capturedBody = await req.text();
                return makeResponse(validTokenPair);
            });

            await sdk.attachPayment({
                paymentId: 'pay_001',
                paymentSecret: 'payment_secret_xyz',
            });

            const params = new URLSearchParams(capturedBody);
            expect(params.get('grant_type')).toBe('payment_credentials');
            expect(params.get('authorization_code')).toBeNull();
            expect(params.get('client_id')).toBeNull();
            expect(capturedReq.headers.get('Authorization')).toBe(
                `Basic ${btoa('pay_001:payment_secret_xyz')}`,
            );
        });

        it('enables getStatus() after attachment', async () => {
            fetchMock.mockImplementation(async (req: Request) => {
                if (req.url.includes('/oauth2/token')) {
                    await req.text();
                    return makeResponse(validTokenPair);
                }
                return makeResponse({ state: 'CREATED' });
            });

            await sdk.attachPayment({
                paymentId: 'pay_status',
                paymentSecret: 'secret',
            });
            const result = await sdk.getStatus();
            expect(result).toEqual({ state: 'CREATED' });
        });

        it('getStatus() hits the URL for the attached paymentId', async () => {
            let capturedUrl = '';
            fetchMock.mockImplementation(async (req: Request) => {
                if (req.url.includes('/oauth2/token')) {
                    await req.text();
                    return makeResponse(validTokenPair);
                }
                capturedUrl = req.url;
                return makeResponse({});
            });

            await sdk.attachPayment({
                paymentId: 'pay_xyz',
                paymentSecret: 'secret',
            });
            await sdk.getStatus();
            expect(capturedUrl).toContain('/payments/pay_xyz');
        });
    });

    // -------------------------------------------------------------------------
    // mountCardForm() delegation
    // -------------------------------------------------------------------------

    describe('mountCardForm()', () => {
        it('rejects with PAYMENT_NOT_ATTACHED for direct-charge before attachPayment', async () => {
            const container = document.createElement('div');
            document.body.appendChild(container);

            const ctrl = await sdk.mountCardForm(container, {
                flow: 'direct-charge',
            });

            const err = await ctrl.result.catch((e: unknown) => e);
            expect(err).toBeInstanceOf(GoPaySDKError);
            expect((err as GoPaySDKError).errorCode).toBe(
                GoPayErrorCodes.PAYMENT_NOT_ATTACHED,
            );
            container.remove();
        });

        it('mounts an iframe for the return-payload flow', async () => {
            fetchMock.mockResolvedValue(
                makeResponse({ card_form_url: CARD_FORM_URL }),
            );

            const container = document.createElement('div');
            document.body.appendChild(container);

            const ctrl = await sdk.mountCardForm(container, {
                flow: 'return-payload',
            });
            ctrl.result.catch(() => {});

            expect(container.querySelector('iframe')).not.toBeNull();
            container.remove();
        });
    });
});
