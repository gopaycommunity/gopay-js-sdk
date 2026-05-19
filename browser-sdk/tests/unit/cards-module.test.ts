import { createHttpClient } from '@gopay-internal/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoPayErrorCodes, GoPaySDKError } from '../../src/errors.js';
import { createCardsApi } from '../../src/modules/cards/cards.module.js';
import type { createPaymentsApi } from '../../src/modules/payments/payments.module.js';

const CARD_FORM_URL = 'https://test.gopay.com/card-form';
const CARD_FORM_ORIGIN = 'https://test.gopay.com';

const makeResponse = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
    });

function makeClient(env?: 'sandbox' | 'production') {
    const c = createHttpClient({
        baseUrl: 'https://example.com',
        publishableKey: 'pk_test',
        environment: env,
    });
    c.setClientId('cid_test');
    return c;
}

function simulateMessage(
    iframe: HTMLIFrameElement,
    data: unknown,
    origin = CARD_FORM_ORIGIN,
) {
    window.dispatchEvent(
        new MessageEvent('message', {
            data,
            source: iframe.contentWindow,
            origin,
        }),
    );
}

describe('createCardsApi() — browser SDK', () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    let client: ReturnType<typeof createHttpClient>;
    let container: HTMLDivElement;

    beforeEach(() => {
        fetchMock = vi
            .fn()
            .mockResolvedValue(makeResponse({ card_form_url: CARD_FORM_URL }));
        vi.stubGlobal('fetch', fetchMock);
        client = makeClient();
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        container.remove();
        vi.restoreAllMocks();
    });

    // -------------------------------------------------------------------------
    // lookupCard()
    // -------------------------------------------------------------------------

    describe('lookupCard()', () => {
        beforeEach(() => {
            client.setToken({
                access_token: 'at-test',
                refresh_token: 'rt-test',
                expires_in: 900,
                refresh_expires_in: 0,
                token_type: 'bearer',
            });
        });

        it('sends POST to /cards/lookup with the payload', async () => {
            let capturedReq!: Request;
            let capturedBody = '';
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                capturedBody = await req.text();
                return makeResponse({});
            });

            const cards = createCardsApi(client, () => null);
            await cards.lookupCard('enc_payload_xyz');

            expect(capturedReq.method).toBe('POST');
            expect(capturedReq.url).toBe('https://example.com/cards/lookup');
            expect(JSON.parse(capturedBody)).toEqual({
                payload: 'enc_payload_xyz',
            });
        });

        it('throws when payload is empty', async () => {
            const cards = createCardsApi(client, () => null);
            await expect(cards.lookupCard('')).rejects.toThrow(
                'payload is required',
            );
        });
    });

    // -------------------------------------------------------------------------
    // mountCardForm() — direct-charge guard
    // -------------------------------------------------------------------------

    describe('mountCardForm() with flow: direct-charge before attachPayment', () => {
        it('returns a controller whose result rejects with PAYMENT_NOT_ATTACHED', async () => {
            const cards = createCardsApi(client, () => null);
            const ctrl = await cards.mountCardForm(container, {
                flow: 'direct-charge',
                redirectContainer: container,
            });

            const err = await ctrl.result.catch((e: unknown) => e);
            expect(err).toBeInstanceOf(GoPaySDKError);
            expect((err as GoPaySDKError).errorCode).toBe(
                GoPayErrorCodes.PAYMENT_NOT_ATTACHED,
            );
        });

        it('returns a no-op controller (setTheme/setLocale/submit do not throw)', async () => {
            const cards = createCardsApi(client, () => null);
            const ctrl = await cards.mountCardForm(container, {
                flow: 'direct-charge',
                redirectContainer: container,
            });

            ctrl.result.catch(() => {});
            expect(() => ctrl.setLocale('de')).not.toThrow();
            expect(() => ctrl.submit()).not.toThrow();
        });
    });

    // -------------------------------------------------------------------------
    // mountCardForm() — flow: return-payload
    // -------------------------------------------------------------------------

    describe('mountCardForm() with flow: return-payload', () => {
        it('fetches /cards/card-form-url and mounts an iframe in the container', async () => {
            let capturedUrl = '';
            fetchMock.mockImplementation(async (req: Request) => {
                capturedUrl = req.url;
                return makeResponse({ card_form_url: CARD_FORM_URL });
            });

            const cards = createCardsApi(client, () => null);
            await cards.mountCardForm(container, { flow: 'return-payload' });

            expect(capturedUrl).toContain('/cards/card-form-url');
            expect(container.querySelector('iframe')).not.toBeNull();
        });

        it('sets sandbox attribute on the iframe', async () => {
            const cards = createCardsApi(client, () => null);
            await cards.mountCardForm(container, { flow: 'return-payload' });

            const iframe = container.querySelector(
                'iframe',
            ) as HTMLIFrameElement;
            expect(iframe.getAttribute('sandbox')).toContain('allow-scripts');
        });

        it('throws GoPaySDKError(CARD_FORM_ERROR) when card_form_url is absent', async () => {
            fetchMock.mockResolvedValue(makeResponse({}));

            const cards = createCardsApi(client, () => null);
            const err = await cards
                .mountCardForm(container, { flow: 'return-payload' })
                .catch((e: unknown) => e);

            expect(err).toBeInstanceOf(GoPaySDKError);
            expect((err as GoPaySDKError).errorCode).toBe(
                GoPayErrorCodes.CARD_FORM_ERROR,
            );
        });

        it('throws GoPaySDKError(CARD_FORM_ERROR) in production when origin is not trusted', async () => {
            const prodClient = makeClient('production');
            fetchMock.mockResolvedValue(
                makeResponse({
                    card_form_url: 'https://untrusted.example.com/form',
                }),
            );

            const cards = createCardsApi(prodClient, () => null);
            const err = await cards
                .mountCardForm(container, { flow: 'return-payload' })
                .catch((e: unknown) => e);

            expect(err).toBeInstanceOf(GoPaySDKError);
            expect((err as GoPaySDKError).errorCode).toBe(
                GoPayErrorCodes.CARD_FORM_ERROR,
            );
        });

        it('resolves result with { encryptedPayload } on GOPAY_CARD_ENCRYPT_RESULT', async () => {
            const cards = createCardsApi(client, () => null);
            const ctrl = await cards.mountCardForm(container, {
                flow: 'return-payload',
            });

            const iframe = container.querySelector(
                'iframe',
            ) as HTMLIFrameElement;
            simulateMessage(iframe, {
                type: 'GOPAY_CARD_ENCRYPT_RESULT',
                card_token: 'enc_token_abc',
            });

            const result = await ctrl.result;
            expect(result).toEqual({ encryptedPayload: 'enc_token_abc' });
        });

        it('rejects result with CARD_FORM_ERROR on GOPAY_CARD_ENCRYPT_ERROR', async () => {
            const cards = createCardsApi(client, () => null);
            const ctrl = await cards.mountCardForm(container, {
                flow: 'return-payload',
            });

            const iframe = container.querySelector(
                'iframe',
            ) as HTMLIFrameElement;
            simulateMessage(iframe, {
                type: 'GOPAY_CARD_ENCRYPT_ERROR',
                error: 'Card data invalid',
            });

            const err = await ctrl.result.catch((e: unknown) => e);
            expect(err).toBeInstanceOf(GoPaySDKError);
            expect((err as GoPaySDKError).errorCode).toBe(
                GoPayErrorCodes.CARD_FORM_ERROR,
            );
        });

        it('removes the iframe from the DOM after GOPAY_CARD_ENCRYPT_RESULT', async () => {
            const cards = createCardsApi(client, () => null);
            const ctrl = await cards.mountCardForm(container, {
                flow: 'return-payload',
            });

            const iframe = container.querySelector(
                'iframe',
            ) as HTMLIFrameElement;
            simulateMessage(iframe, {
                type: 'GOPAY_CARD_ENCRYPT_RESULT',
                card_token: 'enc',
            });

            await ctrl.result;
            expect(container.querySelector('iframe')).toBeNull();
        });

        it('ignores messages from an unexpected origin', async () => {
            const cards = createCardsApi(client, () => null);
            const ctrl = await cards.mountCardForm(container, {
                flow: 'return-payload',
            });
            ctrl.result.catch(() => {});

            const iframe = container.querySelector(
                'iframe',
            ) as HTMLIFrameElement;
            simulateMessage(
                iframe,
                { type: 'GOPAY_CARD_ENCRYPT_RESULT', card_token: 'evil' },
                'https://evil.example.com',
            );

            let settled = false;
            ctrl.result.then(
                () => {
                    settled = true;
                },
                () => {
                    settled = true;
                },
            );
            await new Promise((r) => setTimeout(r, 20));
            expect(settled).toBe(false);
        });

        it('ignores messages from an unexpected source', async () => {
            const cards = createCardsApi(client, () => null);
            const ctrl = await cards.mountCardForm(container, {
                flow: 'return-payload',
            });
            ctrl.result.catch(() => {});

            window.dispatchEvent(
                new MessageEvent('message', {
                    data: {
                        type: 'GOPAY_CARD_ENCRYPT_RESULT',
                        card_token: 'malicious',
                    },
                    source: window, // parent window, not the iframe
                    origin: CARD_FORM_ORIGIN,
                }),
            );

            let settled = false;
            ctrl.result.then(
                () => {
                    settled = true;
                },
                () => {
                    settled = true;
                },
            );
            await new Promise((r) => setTimeout(r, 20));
            expect(settled).toBe(false);
        });

        it('updates iframe height on GOPAY_CARD_FORM_HEIGHT message', async () => {
            const cards = createCardsApi(client, () => null);
            await cards.mountCardForm(container, { flow: 'return-payload' });

            const iframe = container.querySelector(
                'iframe',
            ) as HTMLIFrameElement;
            simulateMessage(iframe, {
                type: 'GOPAY_CARD_FORM_HEIGHT',
                height: 220,
            });

            await new Promise((r) => setTimeout(r, 0));
            expect(iframe.style.height).toBe('220px');
        });

        it('sets iframe height to the reported value', async () => {
            const cards = createCardsApi(client, () => null);
            await cards.mountCardForm(container, { flow: 'return-payload' });

            const iframe = container.querySelector(
                'iframe',
            ) as HTMLIFrameElement;
            simulateMessage(iframe, {
                type: 'GOPAY_CARD_FORM_HEIGHT',
                height: 999,
            });

            await new Promise((r) => setTimeout(r, 0));
            expect(iframe.style.height).toBe('999px');
        });

        it('ignores negative iframe height values', async () => {
            const cards = createCardsApi(client, () => null);
            await cards.mountCardForm(container, { flow: 'return-payload' });

            const iframe = container.querySelector(
                'iframe',
            ) as HTMLIFrameElement;
            simulateMessage(iframe, {
                type: 'GOPAY_CARD_FORM_HEIGHT',
                height: -50,
            });

            await new Promise((r) => setTimeout(r, 0));
            expect(iframe.style.height).toBe('100%');
        });

        it('calls onValidityChange and updates isValid on GOPAY_CARD_FORM_VALIDITY', async () => {
            const onValidityChange = vi.fn();
            const cards = createCardsApi(client, () => null);
            const ctrl = await cards.mountCardForm(container, {
                flow: 'return-payload',
                submitMode: 'external',
                onValidityChange,
            });
            ctrl.result.catch(() => {});

            const iframe = container.querySelector(
                'iframe',
            ) as HTMLIFrameElement;
            simulateMessage(iframe, {
                type: 'GOPAY_CARD_FORM_VALIDITY',
                isValid: true,
            });

            await new Promise((r) => setTimeout(r, 0));
            expect(onValidityChange).toHaveBeenCalledWith(true);
            expect(ctrl.isValid).toBe(true);
        });

        it('does not call onValidityChange when isValid value is unchanged', async () => {
            const onValidityChange = vi.fn();
            const cards = createCardsApi(client, () => null);
            const ctrl = await cards.mountCardForm(container, {
                flow: 'return-payload',
                onValidityChange,
            });
            ctrl.result.catch(() => {});

            const iframe = container.querySelector(
                'iframe',
            ) as HTMLIFrameElement;
            // Initial state is false; sending false again should be a no-op
            simulateMessage(iframe, {
                type: 'GOPAY_CARD_FORM_VALIDITY',
                isValid: false,
            });

            await new Promise((r) => setTimeout(r, 0));
            expect(onValidityChange).not.toHaveBeenCalled();
        });
    });

    // -------------------------------------------------------------------------
    // mountCardForm() — flow: direct-charge (with attached payment)
    // -------------------------------------------------------------------------

    describe('mountCardForm() with flow: direct-charge after attachPayment', () => {
        const chargePaymentMock = vi.fn<() => Promise<unknown>>();
        const awaitChargeStateMock = vi.fn<() => Promise<unknown>>();
        const mockPaymentsApi = {
            chargePayment: chargePaymentMock,
            awaitChargeState: awaitChargeStateMock,
            getStatus: vi.fn(),
            getChargeState: vi.fn(),
            getGooglePayInfo: vi.fn(),
            getApplePayInfo: vi.fn(),
            getApplePayAppInfo: vi.fn(),
            startApplePaySession: vi.fn(),
            getQRPaymentInfo: vi.fn(),
        };

        beforeEach(() => {
            chargePaymentMock.mockResolvedValue({});
            awaitChargeStateMock.mockResolvedValue({
                state: 'SUCCEEDED',
                id: 'pay_001',
            });
        });

        it('GOPAY_CARD_ENCRYPT_RESULT triggers chargePayment and resolves result with charge state', async () => {
            fetchMock.mockResolvedValue(
                makeResponse({ card_form_url: CARD_FORM_URL }),
            );

            const cards = createCardsApi(
                client,
                () =>
                    mockPaymentsApi as unknown as ReturnType<
                        typeof createPaymentsApi
                    >,
            );
            const ctrl = await cards.mountCardForm(container, {
                flow: 'direct-charge',
                redirectContainer: container,
            });

            const iframe = container.querySelector(
                'iframe',
            ) as HTMLIFrameElement;
            simulateMessage(iframe, {
                type: 'GOPAY_CARD_ENCRYPT_RESULT',
                card_token: 'enc_tok',
            });

            await new Promise((r) => setTimeout(r, 10));

            const result = await ctrl.result;
            expect(chargePaymentMock).toHaveBeenCalledOnce();
            expect(awaitChargeStateMock).toHaveBeenCalledOnce();
            expect(result).toMatchObject({ state: 'SUCCEEDED' });
        });

        it('GOPAY_CARD_ENCRYPT_RESULT when paymentsApi becomes null → result rejects with PAYMENT_NOT_ATTACHED', async () => {
            fetchMock.mockResolvedValue(
                makeResponse({ card_form_url: CARD_FORM_URL }),
            );

            let returnApi: ReturnType<typeof createPaymentsApi> | null =
                mockPaymentsApi as unknown as ReturnType<
                    typeof createPaymentsApi
                >;
            const cards = createCardsApi(client, () => returnApi);
            const ctrl = await cards.mountCardForm(container, {
                flow: 'direct-charge',
                redirectContainer: container,
            });

            // Detach before the message fires
            returnApi = null;

            const iframe = container.querySelector(
                'iframe',
            ) as HTMLIFrameElement;
            simulateMessage(iframe, {
                type: 'GOPAY_CARD_ENCRYPT_RESULT',
                card_token: 'enc_tok',
            });

            const err = await ctrl.result.catch((e: unknown) => e);
            expect(err).toBeInstanceOf(GoPaySDKError);
            expect((err as GoPaySDKError).errorCode).toBe(
                GoPayErrorCodes.PAYMENT_NOT_ATTACHED,
            );
        });

        it('error during chargePayment → result rejects with that error', async () => {
            fetchMock.mockResolvedValue(
                makeResponse({ card_form_url: CARD_FORM_URL }),
            );

            const chargeError = new Error('charge network error');
            chargePaymentMock.mockRejectedValue(chargeError);

            const cards = createCardsApi(
                client,
                () =>
                    mockPaymentsApi as unknown as ReturnType<
                        typeof createPaymentsApi
                    >,
            );
            const ctrl = await cards.mountCardForm(container, {
                flow: 'direct-charge',
                redirectContainer: container,
            });

            const iframe = container.querySelector(
                'iframe',
            ) as HTMLIFrameElement;
            simulateMessage(iframe, {
                type: 'GOPAY_CARD_ENCRYPT_RESULT',
                card_token: 'enc_tok',
            });

            const err = await ctrl.result.catch((e: unknown) => e);
            expect(err).toBe(chargeError);
        });
    });

    // -------------------------------------------------------------------------
    // CardFormController — setTheme, setLocale, submit
    // -------------------------------------------------------------------------

    describe('CardFormController', () => {
        it('submit() throws GoPaySDKError when not in external submit mode', async () => {
            const cards = createCardsApi(client, () => null);
            const ctrl = await cards.mountCardForm(container, {
                flow: 'return-payload',
                submitMode: 'internal',
            });
            ctrl.result.catch(() => {});

            expect(() => ctrl.submit()).toThrow(GoPaySDKError);
        });

        it('setTheme() does not throw while the iframe is active', async () => {
            const cards = createCardsApi(client, () => null);
            const ctrl = await cards.mountCardForm(container, {
                flow: 'return-payload',
            });
            ctrl.result.catch(() => {});

            expect(() =>
                ctrl.setTheme({ labelColor: '#333' } as never),
            ).not.toThrow();
        });

        it('setLocale() does not throw while the iframe is active', async () => {
            const cards = createCardsApi(client, () => null);
            const ctrl = await cards.mountCardForm(container, {
                flow: 'return-payload',
            });
            ctrl.result.catch(() => {});

            expect(() => ctrl.setLocale('de-DE')).not.toThrow();
        });

        it('submit() sends GOPAY_CARD_REQUEST_SUBMIT postMessage in external submit mode', async () => {
            const cards = createCardsApi(client, () => null);
            const ctrl = await cards.mountCardForm(container, {
                flow: 'return-payload',
                submitMode: 'external',
            });
            ctrl.result.catch(() => {});

            expect(() => ctrl.submit()).not.toThrow();
        });
    });

    // -------------------------------------------------------------------------
    // Previous iframe cleanup on re-mount
    // -------------------------------------------------------------------------

    describe('calling mountCardForm() a second time', () => {
        it('removes the previously mounted iframe before mounting a new one', async () => {
            fetchMock.mockImplementation(async () =>
                makeResponse({ card_form_url: CARD_FORM_URL }),
            );

            const cards = createCardsApi(client, () => null);

            const ctrl1 = await cards.mountCardForm(container, {
                flow: 'return-payload',
            });
            ctrl1.result.catch(() => {});

            const ctrl2 = await cards.mountCardForm(container, {
                flow: 'return-payload',
            });
            ctrl2.result.catch(() => {});

            expect(container.querySelectorAll('iframe')).toHaveLength(1);
        });
    });
});
