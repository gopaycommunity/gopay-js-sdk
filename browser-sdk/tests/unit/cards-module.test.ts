import { createHttpClient } from '@gopay-internal/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoPayErrorCodes, GoPaySDKError } from '../../src/errors.js';
import type { BrowserTelemetry } from '../../src/logging/gw-logger.js';
import { createCardsApi } from '../../src/modules/cards/cards.module.js';
import type { CardFormTheme } from '../../src/modules/cards/iframe-protocol.js';
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
        shareableKey: 'pk_test',
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
        // callIntegrator rethrows a consumer's error on a later task, so any
        // test that makes one throw has to own that timer — otherwise it
        // fires after the test and vitest counts it as an unhandled error,
        // which fails the run even with every assertion green. Restoring here
        // rather than in each test body means a test that fails early cannot
        // leave fake timers behind for the next one.
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    // -------------------------------------------------------------------------
    // mountCardForm() — direct-charge guard
    // -------------------------------------------------------------------------

    describe('mountCardForm() with flow: direct-charge before attachPayment', () => {
        it('returns a controller whose result rejects with PAYMENT_NOT_ATTACHED', async () => {
            const cards = createCardsApi(client, () => null);
            const ctrl = await cards.mountCardForm(container, {
                flow: 'direct-charge',
                threeDS: { mode: 'manual' },
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
                threeDS: { mode: 'manual' },
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

        it('uses `:shareableKey` Basic credential when client_id is absent', async () => {
            let capturedAuth = '';
            fetchMock.mockImplementation(async (req: Request) => {
                capturedAuth = req.headers.get('Authorization') ?? '';
                return makeResponse({ card_form_url: CARD_FORM_URL });
            });

            const noIdClient = createHttpClient({
                baseUrl: 'https://example.com',
                shareableKey: 'pk_only',
            });
            const cards = createCardsApi(noIdClient, () => null);
            await cards.mountCardForm(container, { flow: 'return-payload' });

            const expectedCredentials = btoa(':pk_only');
            expect(capturedAuth).toBe(`Basic ${expectedCredentials}`);
        });

        it('always uses Basic auth with the shareable key for /cards/card-form-url, even when a bearer token is present', async () => {
            let capturedAuth = '';
            fetchMock.mockImplementation(async (req: Request) => {
                capturedAuth = req.headers.get('Authorization') ?? '';
                return makeResponse({ card_form_url: CARD_FORM_URL });
            });

            // Seed a bearer token to prove it is NOT used for this endpoint.
            client.setToken({
                access_token: 'bearer_should_not_be_used',
                expires_in: 3600,
                token_type: 'bearer',
            });

            const cards = createCardsApi(client, () => null);
            await cards.mountCardForm(container, { flow: 'return-payload' });

            const expectedCredentials = btoa('cid_test:pk_test');
            expect(capturedAuth).toBe(`Basic ${expectedCredentials}`);
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

        it('does not throw in production when card form origin is trusted', async () => {
            const prodClient = makeClient('production');
            fetchMock.mockResolvedValue(
                makeResponse({
                    card_form_url: 'https://secure.gopay.com/card-form',
                }),
            );

            const cards = createCardsApi(prodClient, () => null);
            const ctrl = await cards.mountCardForm(container, {
                flow: 'return-payload',
            });
            ctrl.result.catch(() => {});

            expect(container.querySelector('iframe')).not.toBeNull();
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

        it('defaults locale to "en" when options.locale is absent and navigator.language is not set', async () => {
            vi.stubGlobal('navigator', { language: null });

            const cards = createCardsApi(client, () => null);
            const ctrl = await cards.mountCardForm(container, {
                flow: 'return-payload',
            });
            ctrl.result.catch(() => {});

            const iframe = container.querySelector(
                'iframe',
            ) as HTMLIFrameElement;
            const postMessageSpy = vi.spyOn(
                iframe.contentWindow as Window,
                'postMessage',
            );
            iframe.onload?.(new Event('load'));

            expect(postMessageSpy).toHaveBeenCalledWith(
                expect.objectContaining({ locale: 'en' }),
                CARD_FORM_ORIGIN,
            );
        });

        it('sends GOPAY_CARD_FORM_INIT postMessage when the iframe loads', async () => {
            const cards = createCardsApi(client, () => null);
            const ctrl = await cards.mountCardForm(container, {
                flow: 'return-payload',
            });
            ctrl.result.catch(() => {});

            const iframe = container.querySelector(
                'iframe',
            ) as HTMLIFrameElement;
            const postMessageSpy = vi.spyOn(
                iframe.contentWindow as Window,
                'postMessage',
            );

            iframe.onload?.(new Event('load'));

            expect(postMessageSpy).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'GOPAY_CARD_FORM_INIT' }),
                CARD_FORM_ORIGIN,
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

        it('survives a throwing onValidityChange and reports it without the message', async () => {
            // Guards the wiring, not the helper: the helper has its own tests,
            // but a call site quietly reverting to `catch {}` would make the
            // integrator's bug invisible again and nothing else would notice.
            vi.useFakeTimers();
            const telemetry = {
                apiCall: vi.fn(),
                error: vi.fn(),
                lifecycle: vi.fn(),
                submit: vi.fn(),
                walletUnavailable: vi.fn(),
                integratorError: vi.fn(),
                unmount: vi.fn(),
                walletAvailability: vi.fn(),
                walletStep: vi.fn(),
                cardFormHeight: vi.fn(),
            };
            const cards = createCardsApi(
                client,
                () => null,
                telemetry as unknown as BrowserTelemetry,
            );
            const ctrl = await cards.mountCardForm(container, {
                flow: 'return-payload',
                submitMode: 'external',
                onValidityChange: () => {
                    throw new TypeError('secret@merchant.test blew up');
                },
            });
            ctrl.result.catch(() => {});

            const iframe = container.querySelector(
                'iframe',
            ) as HTMLIFrameElement;
            expect(() =>
                simulateMessage(iframe, {
                    type: 'GOPAY_CARD_FORM_VALIDITY',
                    isValid: true,
                }),
            ).not.toThrow();

            expect(telemetry.integratorError).toHaveBeenCalledWith(
                'onValidityChange',
                'TypeError',
            );
            // Consume the deferred rethrow: in a browser it lands in
            // window.onerror, which is the point, and here it has to be
            // asserted rather than left to escape into the runner.
            expect(() => vi.runAllTimers()).toThrow(TypeError);
            expect(
                JSON.stringify(telemetry.integratorError.mock.calls),
            ).not.toContain('secret@merchant.test');
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

        it('forwards GOPAY_CARD_FORM_ERRORS to onFieldErrors', async () => {
            const onFieldErrors = vi.fn();
            const cards = createCardsApi(client, () => null);
            const ctrl = await cards.mountCardForm(container, {
                flow: 'return-payload',
                onFieldErrors,
            });
            ctrl.result.catch(() => {});

            const iframe = container.querySelector(
                'iframe',
            ) as HTMLIFrameElement;
            simulateMessage(iframe, {
                type: 'GOPAY_CARD_FORM_ERRORS',
                errors: [{ field: 'pan', code: 'pattern' }],
            });
            simulateMessage(iframe, {
                type: 'GOPAY_CARD_FORM_ERRORS',
                errors: [],
            });

            await new Promise((r) => setTimeout(r, 0));
            expect(onFieldErrors).toHaveBeenNthCalledWith(1, [
                { field: 'pan', code: 'pattern' },
            ]);
            expect(onFieldErrors).toHaveBeenNthCalledWith(2, []);
        });

        it('reports only field and code, dropping anything else the iframe sends', async () => {
            const onFieldErrors = vi.fn();
            const cards = createCardsApi(client, () => null);
            const ctrl = await cards.mountCardForm(container, {
                flow: 'return-payload',
                onFieldErrors,
            });
            ctrl.result.catch(() => {});

            const iframe = container.querySelector(
                'iframe',
            ) as HTMLIFrameElement;
            simulateMessage(iframe, {
                type: 'GOPAY_CARD_FORM_ERRORS',
                errors: [
                    {
                        field: 'pan',
                        code: 'pattern',
                        value: '4111111111111111',
                    },
                ],
            });

            await new Promise((r) => setTimeout(r, 0));
            // the card form is deployed separately — the SDK enforces the
            // "codes only, never values" guarantee on this side too
            expect(onFieldErrors).toHaveBeenCalledWith([
                { field: 'pan', code: 'pattern' },
            ]);
        });

        it('drops malformed entries instead of throwing in the listener', async () => {
            const onFieldErrors = vi.fn();
            const cards = createCardsApi(client, () => null);
            const ctrl = await cards.mountCardForm(container, {
                flow: 'return-payload',
                onFieldErrors,
            });
            ctrl.result.catch(() => {});

            const iframe = container.querySelector(
                'iframe',
            ) as HTMLIFrameElement;
            simulateMessage(iframe, {
                type: 'GOPAY_CARD_FORM_ERRORS',
                errors: [
                    null,
                    'nonsense',
                    { field: 'cvv' },
                    // right shape, values outside the protocol enums
                    { field: 'unknown', code: 'invalid' },
                    // prototype keys must not pass as protocol values either
                    { field: 'toString', code: 'constructor' },
                    { field: 'pan', code: 'required' },
                ],
            });

            await new Promise((r) => setTimeout(r, 0));
            expect(onFieldErrors).toHaveBeenCalledWith([
                { field: 'pan', code: 'required' },
            ]);
        });

        it('keeps the form usable when onFieldErrors throws', async () => {
            // The throw is no longer swallowed — callIntegrator defers it to a
            // later task so the page's own handler sees it. The form staying
            // usable is still what this test is about; the timer is just the
            // part it now has to account for.
            vi.useFakeTimers();
            const onFieldErrors = vi.fn(() => {
                throw new Error('consumer callback exploded');
            });
            const onValidityChange = vi.fn();
            const cards = createCardsApi(client, () => null);
            const ctrl = await cards.mountCardForm(container, {
                flow: 'return-payload',
                submitMode: 'external',
                onFieldErrors,
                onValidityChange,
            });
            ctrl.result.catch(() => {});

            const iframe = container.querySelector(
                'iframe',
            ) as HTMLIFrameElement;
            simulateMessage(iframe, {
                type: 'GOPAY_CARD_FORM_ERRORS',
                errors: [{ field: 'cvv', code: 'required' }],
            });
            simulateMessage(iframe, {
                type: 'GOPAY_CARD_FORM_VALIDITY',
                isValid: true,
            });

            expect(() => vi.runAllTimers()).toThrow(
                'consumer callback exploded',
            );
            expect(onFieldErrors).toHaveBeenCalledOnce();
            // the throwing consumer must not stop later protocol messages
            expect(onValidityChange).toHaveBeenCalledWith(true);
            expect(ctrl.isValid).toBe(true);
        });

        it('ignores GOPAY_CARD_ENCRYPT_READY messages without settling result', async () => {
            const cards = createCardsApi(client, () => null);
            const ctrl = await cards.mountCardForm(container, {
                flow: 'return-payload',
            });
            ctrl.result.catch(() => {});

            const iframe = container.querySelector(
                'iframe',
            ) as HTMLIFrameElement;
            simulateMessage(iframe, { type: 'GOPAY_CARD_ENCRYPT_READY' });

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

        it('ignores unknown message types without settling result', async () => {
            const cards = createCardsApi(client, () => null);
            const ctrl = await cards.mountCardForm(container, {
                flow: 'return-payload',
            });
            ctrl.result.catch(() => {});

            const iframe = container.querySelector(
                'iframe',
            ) as HTMLIFrameElement;
            simulateMessage(iframe, {
                type: 'GOPAY_SOME_FUTURE_EVENT',
                payload: 42,
            });

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
        // Takes the options the real one does: two specs below drive the 3DS
        // path by calling onStateChange from the implementation.
        const awaitChargeStateMock =
            vi.fn<
                (opts?: {
                    onStateChange?: (s: unknown) => void;
                }) => Promise<unknown>
            >();
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
                threeDS: { mode: 'manual' },
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
                threeDS: { mode: 'manual' },
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
                threeDS: { mode: 'manual' },
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

        it('default threeDS (omitted) forwards undefined threeDS to awaitChargeState', async () => {
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
            });

            const iframe = container.querySelector(
                'iframe',
            ) as HTMLIFrameElement;
            simulateMessage(iframe, {
                type: 'GOPAY_CARD_ENCRYPT_RESULT',
                card_token: 'enc_tok',
            });

            await ctrl.result;

            // threeDS not provided — awaitChargeState gets undefined threeDS (defaults to redirect)
            expect(awaitChargeStateMock).toHaveBeenCalledWith(
                expect.objectContaining({ threeDS: undefined }),
            );
        });

        it('removes the spinner when onStateChange fires ACTION_REQUIRED with a redirect_url', async () => {
            fetchMock.mockResolvedValue(
                makeResponse({ card_form_url: CARD_FORM_URL }),
            );

            awaitChargeStateMock.mockImplementation(
                async (opts?: { onStateChange?: (s: unknown) => void }) => {
                    opts?.onStateChange?.({
                        state: 'ACTION_REQUIRED',
                        action: { redirect_url: 'https://3ds.example.com' },
                    });
                    return { state: 'SUCCEEDED', id: 'pay_001' };
                },
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
            });

            const iframe = container.querySelector(
                'iframe',
            ) as HTMLIFrameElement;
            simulateMessage(iframe, {
                type: 'GOPAY_CARD_ENCRYPT_RESULT',
                card_token: 'enc_tok',
            });

            const result = await ctrl.result;
            expect(result).toMatchObject({ state: 'SUCCEEDED' });
        });

        it('uses default spinner color when theme lacks submitBackgroundColor', async () => {
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
                theme: { labelColor: '#000000' }, // no submitBackgroundColor
            });

            const iframe = container.querySelector(
                'iframe',
            ) as HTMLIFrameElement;
            simulateMessage(iframe, {
                type: 'GOPAY_CARD_ENCRYPT_RESULT',
                card_token: 'enc_tok',
            });

            const result = await ctrl.result;
            expect(result).toMatchObject({ state: 'SUCCEEDED' });
        });

        it('forwards awaitOptions.onStateChange calls to the caller', async () => {
            fetchMock.mockResolvedValue(
                makeResponse({ card_form_url: CARD_FORM_URL }),
            );

            const onStateChange = vi.fn();
            awaitChargeStateMock.mockImplementation(
                async (opts?: { onStateChange?: (s: unknown) => void }) => {
                    opts?.onStateChange?.({ state: 'PROCESSING' });
                    return { state: 'SUCCEEDED', id: 'pay_001' };
                },
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
                awaitOptions: { onStateChange },
            });

            const iframe = container.querySelector(
                'iframe',
            ) as HTMLIFrameElement;
            simulateMessage(iframe, {
                type: 'GOPAY_CARD_ENCRYPT_RESULT',
                card_token: 'enc_tok',
            });

            await ctrl.result;
            expect(onStateChange).toHaveBeenCalledWith(
                expect.objectContaining({ state: 'PROCESSING' }),
            );
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

        /**
         * iframe-protocol.ts is duplicated by hand into gw-ui-cc-v4, so the two
         * copies drift silently. The theme here is passed uncast on purpose —
         * the other theme tests use `as never` — which makes removing a key from
         * CardFormTheme a type error rather than nothing at all. `yarn typecheck`
         * covers this file, so that error is what says the copies have parted.
         */
        it('takes the theme keys the card form added, uncast', async () => {
            const theme: CardFormTheme = {
                inputFontWeight: 600,
                labelLineHeight: 12,
                errorSpacing: 3,
            };
            const cards = createCardsApi(client, () => null);
            const ctrl = await cards.mountCardForm(container, {
                flow: 'return-payload',
                theme,
            });
            ctrl.result.catch(() => {});

            expect(() => ctrl.setTheme(theme)).not.toThrow();
        });

        /**
         * The type check above is only half the story: `satisfies CardSetTheme`
         * is erased at build time, so nothing was asserting that the theme
         * reaches the iframe at all. Dropping `theme` from either payload — or
         * emptying setTheme entirely — left all 52 specs in this file green.
         * Both directions are pinned here.
         */
        it('sends the theme to the iframe on init and on setTheme', async () => {
            const theme: CardFormTheme = {
                inputFontWeight: 600,
                labelLineHeight: 12,
                errorSpacing: 3,
            };
            const cards = createCardsApi(client, () => null);
            const ctrl = await cards.mountCardForm(container, {
                flow: 'return-payload',
                theme,
            });
            ctrl.result.catch(() => {});

            const iframe = container.querySelector(
                'iframe',
            ) as HTMLIFrameElement;
            const postMessageSpy = vi.spyOn(
                iframe.contentWindow as Window,
                'postMessage',
            );

            iframe.onload?.(new Event('load'));
            expect(postMessageSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'GOPAY_CARD_FORM_INIT',
                    theme: expect.objectContaining(theme),
                }),
                CARD_FORM_ORIGIN,
            );

            postMessageSpy.mockClear();
            ctrl.setTheme({ ...theme, labelLineHeight: 16 });
            expect(postMessageSpy).toHaveBeenCalledWith(
                {
                    type: 'GOPAY_CARD_SET_THEME',
                    theme: { ...theme, labelLineHeight: 16 },
                },
                CARD_FORM_ORIGIN,
            );
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

        it('submit() is a silent no-op after unmount (external mode)', async () => {
            const cards = createCardsApi(client, () => null);
            const ctrl = await cards.mountCardForm(container, {
                flow: 'return-payload',
                submitMode: 'external',
            });
            ctrl.result.catch(() => {});

            ctrl.unmount();
            expect(() => ctrl.submit()).not.toThrow();
        });
    });

    // -------------------------------------------------------------------------
    // CardFormController — unmount()
    // -------------------------------------------------------------------------

    describe('CardFormController — unmount()', () => {
        it('rejects result with CARD_FORM_ERROR and removes the iframe', async () => {
            const cards = createCardsApi(client, () => null);
            const ctrl = await cards.mountCardForm(container, {
                flow: 'return-payload',
            });

            ctrl.unmount();

            const err = await ctrl.result.catch((e: unknown) => e);
            expect(err).toBeInstanceOf(GoPaySDKError);
            expect((err as GoPaySDKError).errorCode).toBe(
                GoPayErrorCodes.CARD_FORM_ERROR,
            );
            expect(container.querySelector('iframe')).toBeNull();
        });

        it('is a no-op when called a second time', async () => {
            const cards = createCardsApi(client, () => null);
            const ctrl = await cards.mountCardForm(container, {
                flow: 'return-payload',
            });
            ctrl.result.catch(() => {});

            ctrl.unmount();
            expect(() => ctrl.unmount()).not.toThrow();
        });

        it('setTheme() and setLocale() are silent no-ops after unmount', async () => {
            const cards = createCardsApi(client, () => null);
            const ctrl = await cards.mountCardForm(container, {
                flow: 'return-payload',
            });

            ctrl.unmount();
            ctrl.result.catch(() => {});

            expect(() => ctrl.setTheme({} as never)).not.toThrow();
            expect(() => ctrl.setLocale('cs')).not.toThrow();
        });

        it('aborts the charge and rejects result when unmounted during direct-charge polling', async () => {
            // GPOMA-2512: cleanup() runs as soon as the card is encrypted, so
            // unmount() used to early-return and leave polling running with an
            // unsettled result.
            fetchMock.mockResolvedValue(
                makeResponse({ card_form_url: CARD_FORM_URL }),
            );

            let pollingSignal: AbortSignal | undefined;
            let chargeSignal: AbortSignal | undefined;
            const paymentsApi = {
                chargePayment: vi.fn(
                    (_params: unknown, options?: { signal?: AbortSignal }) => {
                        chargeSignal = options?.signal;
                        return Promise.resolve({});
                    },
                ),
                // never settles — the flow stays in polling until unmount()
                awaitChargeState: vi.fn(
                    (options?: { signal?: AbortSignal }) => {
                        pollingSignal = options?.signal;
                        return new Promise(() => {});
                    },
                ),
                getStatus: vi.fn(),
                getChargeState: vi.fn(),
                getGooglePayInfo: vi.fn(),
                getApplePayInfo: vi.fn(),
                getApplePayAppInfo: vi.fn(),
                startApplePaySession: vi.fn(),
                getQRPaymentInfo: vi.fn(),
            };

            const cards = createCardsApi(
                client,
                () =>
                    paymentsApi as unknown as ReturnType<
                        typeof createPaymentsApi
                    >,
            );
            const ctrl = await cards.mountCardForm(container, {
                flow: 'direct-charge',
                threeDS: { mode: 'manual' },
            });

            const iframe = container.querySelector(
                'iframe',
            ) as HTMLIFrameElement;
            simulateMessage(iframe, {
                type: 'GOPAY_CARD_ENCRYPT_RESULT',
                card_token: 'enc_tok',
            });

            await new Promise((r) => setTimeout(r, 10));
            expect(pollingSignal?.aborted).toBe(false);

            ctrl.unmount();

            expect(pollingSignal?.aborted).toBe(true);
            expect(chargeSignal?.aborted).toBe(true);
            const err = await ctrl.result.catch((e: unknown) => e);
            expect(err).toBeInstanceOf(GoPaySDKError);
            expect((err as GoPaySDKError).errorCode).toBe(
                GoPayErrorCodes.CARD_FORM_ERROR,
            );
            // idempotent in the charge phase too
            expect(() => ctrl.unmount()).not.toThrow();
        });

        it('is a no-op once the direct-charge flow has resolved', async () => {
            fetchMock.mockResolvedValue(
                makeResponse({ card_form_url: CARD_FORM_URL }),
            );

            let pollingSignal: AbortSignal | undefined;
            const paymentsApi = {
                chargePayment: vi.fn().mockResolvedValue({}),
                awaitChargeState: vi.fn(
                    (options?: { signal?: AbortSignal }) => {
                        pollingSignal = options?.signal;
                        return Promise.resolve({
                            state: 'SUCCEEDED',
                            id: 'pay_1',
                        });
                    },
                ),
                getStatus: vi.fn(),
                getChargeState: vi.fn(),
                getGooglePayInfo: vi.fn(),
                getApplePayInfo: vi.fn(),
                getApplePayAppInfo: vi.fn(),
                startApplePaySession: vi.fn(),
                getQRPaymentInfo: vi.fn(),
            };

            const cards = createCardsApi(
                client,
                () =>
                    paymentsApi as unknown as ReturnType<
                        typeof createPaymentsApi
                    >,
            );
            const ctrl = await cards.mountCardForm(container, {
                flow: 'direct-charge',
                threeDS: { mode: 'manual' },
            });

            const iframe = container.querySelector(
                'iframe',
            ) as HTMLIFrameElement;
            simulateMessage(iframe, {
                type: 'GOPAY_CARD_ENCRYPT_RESULT',
                card_token: 'enc_tok',
            });

            await expect(ctrl.result).resolves.toMatchObject({
                state: 'SUCCEEDED',
            });

            ctrl.unmount();
            // a completed flow must not be aborted retroactively
            expect(pollingSignal?.aborted).toBe(false);
        });

        it('does not release a session a later mount has taken', async () => {
            // David Kolář's review: cleanup() runs at encryption time, so a
            // later unmount() on the old controller used to clear the shared
            // mounted flag — releasing the session belonging to the form
            // mounted in between, and letting a third form mount alongside it.
            fetchMock.mockResolvedValue(
                makeResponse({ card_form_url: CARD_FORM_URL }),
            );
            const paymentsApi = {
                chargePayment: vi.fn().mockResolvedValue({}),
                awaitChargeState: vi.fn(() => new Promise(() => {})),
                getStatus: vi.fn(),
                getChargeState: vi.fn(),
                getGooglePayInfo: vi.fn(),
                getApplePayInfo: vi.fn(),
                getApplePayAppInfo: vi.fn(),
                startApplePaySession: vi.fn(),
                getQRPaymentInfo: vi.fn(),
            };
            const cards = createCardsApi(
                client,
                () =>
                    paymentsApi as unknown as ReturnType<
                        typeof createPaymentsApi
                    >,
            );

            const first = await cards.mountCardForm(container, {
                flow: 'direct-charge',
                threeDS: { mode: 'manual' },
            });
            first.result.catch(() => {});

            // encryption tears the iframe down; the charge keeps running
            const iframe = container.querySelector(
                'iframe',
            ) as HTMLIFrameElement;
            simulateMessage(iframe, {
                type: 'GOPAY_CARD_ENCRYPT_RESULT',
                card_token: 'enc_tok',
            });
            await new Promise((r) => setTimeout(r, 10));
            expect(cards.isCardFormMounted()).toBe(false);

            // a second form takes the session
            const second = await cards.mountCardForm(container, {
                flow: 'return-payload',
            });
            second.result.catch(() => {});
            expect(cards.isCardFormMounted()).toBe(true);

            // tearing down the first must leave the second's session alone
            first.unmount();
            expect(cards.isCardFormMounted()).toBe(true);

            const third = await cards.mountCardForm(container, {
                flow: 'return-payload',
            });
            const err = await third.result.catch((e: unknown) => e);
            expect((err as GoPaySDKError).errorCode).toBe(
                GoPayErrorCodes.CARD_FORM_ALREADY_MOUNTED,
            );

            second.unmount();
            expect(cards.isCardFormMounted()).toBe(false);
        });

        it('fires the onError callback for the already-mounted guard', async () => {
            // This guard returns its own already-rejected promise and never
            // reaches rejectResult, so it needs reporting of its own.
            const onError = vi.fn();
            const c = createHttpClient({
                baseUrl: 'https://example.com',
                shareableKey: 'pk_test',
                onError,
            });
            c.setClientId('cid_test');
            fetchMock.mockResolvedValue(
                makeResponse({ card_form_url: CARD_FORM_URL }),
            );

            const cards = createCardsApi(c, () => null);
            const first = await cards.mountCardForm(container, {
                flow: 'return-payload',
            });
            first.result.catch(() => {});

            const second = await cards.mountCardForm(container, {
                flow: 'return-payload',
            });
            second.result.catch(() => {});

            expect(onError).toHaveBeenCalledWith(
                expect.objectContaining({
                    errorCode: GoPayErrorCodes.CARD_FORM_ALREADY_MOUNTED,
                }),
            );
        });

        it('fires the onError callback for the direct-charge not-attached guard', async () => {
            const onError = vi.fn();
            const c = createHttpClient({
                baseUrl: 'https://example.com',
                shareableKey: 'pk_test',
                onError,
            });
            c.setClientId('cid_test');
            fetchMock.mockResolvedValue(
                makeResponse({ card_form_url: CARD_FORM_URL }),
            );

            const cards = createCardsApi(c, () => null);
            const ctrl = await cards.mountCardForm(container, {
                flow: 'direct-charge',
            });
            ctrl.result.catch(() => {});

            expect(onError).toHaveBeenCalledWith(
                expect.objectContaining({
                    errorCode: GoPayErrorCodes.PAYMENT_NOT_ATTACHED,
                }),
            );
        });

        it('fires the onError callback when submit() is called in internal mode', async () => {
            const onError = vi.fn();
            const c = createHttpClient({
                baseUrl: 'https://example.com',
                shareableKey: 'pk_test',
                onError,
            });
            c.setClientId('cid_test');
            fetchMock.mockResolvedValue(
                makeResponse({ card_form_url: CARD_FORM_URL }),
            );

            const cards = createCardsApi(c, () => null);
            const ctrl = await cards.mountCardForm(container, {
                flow: 'return-payload',
            });
            ctrl.result.catch(() => {});

            // Still throws to the caller — reporting must not swallow it.
            expect(() => ctrl.submit()).toThrow(GoPaySDKError);
            expect(onError).toHaveBeenCalledWith(
                expect.objectContaining({
                    errorCode: GoPayErrorCodes.INVALID_ARGUMENT,
                }),
            );
        });

        it('fires the onError callback when the iframe reports an encrypt error', async () => {
            // The card form delivers its failures by rejecting `result` rather
            // than by throwing, so these reached the caller without onError
            // ever seeing them (GPOMA-2647).
            const onError = vi.fn();
            const c = createHttpClient({
                baseUrl: 'https://example.com',
                shareableKey: 'pk_test',
                onError,
            });
            c.setClientId('cid_test');
            fetchMock.mockResolvedValue(
                makeResponse({ card_form_url: CARD_FORM_URL }),
            );

            const cards = createCardsApi(c, () => null);
            const ctrl = await cards.mountCardForm(container, {
                flow: 'return-payload',
            });
            ctrl.result.catch(() => {});

            const iframe = container.querySelector(
                'iframe',
            ) as HTMLIFrameElement;
            simulateMessage(iframe, {
                type: 'GOPAY_CARD_ENCRYPT_ERROR',
                error: 'ENCRYPTION_FAILED',
            });

            await new Promise((r) => setTimeout(r, 0));

            expect(onError).toHaveBeenCalledWith(
                expect.objectContaining({
                    errorCode: GoPayErrorCodes.CARD_FORM_ERROR,
                }),
            );
        });

        it('fires the onError callback with the unmount error', async () => {
            const onError = vi.fn();
            const c = createHttpClient({
                baseUrl: 'https://example.com',
                shareableKey: 'pk_test',
                onError,
            });
            c.setClientId('cid_test');
            fetchMock.mockResolvedValue(
                makeResponse({ card_form_url: CARD_FORM_URL }),
            );

            const cards = createCardsApi(c, () => null);
            const ctrl = await cards.mountCardForm(container, {
                flow: 'return-payload',
            });

            ctrl.unmount();
            ctrl.result.catch(() => {});

            expect(onError).toHaveBeenCalledWith(
                expect.objectContaining({
                    errorCode: GoPayErrorCodes.CARD_FORM_ERROR,
                }),
            );
        });
    });

    // -------------------------------------------------------------------------
    // Concurrent mount guard (D1)
    // -------------------------------------------------------------------------

    describe('mountCardForm() while a form is being mounted', () => {
        it('returns a controller whose result rejects with CARD_FORM_ALREADY_MOUNTED', async () => {
            const cards = createCardsApi(client, () => null);

            // Start (but don't await) the first mount so cardFormSessionActive is set
            const promise1 = cards.mountCardForm(container, {
                flow: 'return-payload',
            });
            promise1.then((c) => c.result.catch(() => {})).catch(() => {});

            // Second call runs synchronously against the active flag
            const ctrl2 = await cards.mountCardForm(container, {
                flow: 'return-payload',
            });

            const err = await ctrl2.result.catch((e: unknown) => e);
            expect(err).toBeInstanceOf(GoPaySDKError);
            expect((err as GoPaySDKError).errorCode).toBe(
                GoPayErrorCodes.CARD_FORM_ALREADY_MOUNTED,
            );
        });

        it('the no-op controller from a concurrent mount has silent no-op methods', async () => {
            const cards = createCardsApi(client, () => null);

            const promise1 = cards.mountCardForm(container, {
                flow: 'return-payload',
            });
            promise1.then((c) => c.result.catch(() => {})).catch(() => {});

            const ctrl2 = await cards.mountCardForm(container, {
                flow: 'return-payload',
            });
            ctrl2.result.catch(() => {});

            expect(() => ctrl2.setTheme({} as never)).not.toThrow();
            expect(() => ctrl2.setLocale('cs')).not.toThrow();
            expect(() => ctrl2.submit()).not.toThrow();
            expect(() => ctrl2.unmount()).not.toThrow();
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

    // -------------------------------------------------------------------------
    // getCardFormUrl() — cache invalidation on failure
    // -------------------------------------------------------------------------

    describe('getCardFormUrl() cache', () => {
        it('reuses the cached card form URL on a subsequent mount without re-fetching', async () => {
            const cards = createCardsApi(client, () => null);

            // First mount — fetches and caches the URL
            const ctrl1 = await cards.mountCardForm(container, {
                flow: 'return-payload',
            });
            ctrl1.unmount();
            await ctrl1.result.catch(() => {});

            // Second mount — activeCleanup is now cleared; cache should be reused
            fetchMock.mockClear();
            const ctrl2 = await cards.mountCardForm(container, {
                flow: 'return-payload',
            });
            ctrl2.result.catch(() => {});

            expect(fetchMock).not.toHaveBeenCalled();
            expect(container.querySelector('iframe')).not.toBeNull();
        });

        it('retries the fetch on a subsequent mountCardForm call after a previous failure', async () => {
            // First call: API returns no card_form_url — triggers CARD_FORM_ERROR.
            fetchMock.mockResolvedValueOnce(makeResponse({}));

            const cards = createCardsApi(client, () => null);
            const err = await cards
                .mountCardForm(container, { flow: 'return-payload' })
                .catch((e: unknown) => e);

            expect(err).toBeInstanceOf(GoPaySDKError);
            expect((err as GoPaySDKError).errorCode).toBe(
                GoPayErrorCodes.CARD_FORM_ERROR,
            );

            // Allow the internal p.catch() that clears cardFormUrlPromise to run.
            await new Promise((r) => setTimeout(r, 0));

            // Second call: API now returns a valid URL — should succeed (cache was cleared).
            fetchMock.mockResolvedValue(
                makeResponse({ card_form_url: CARD_FORM_URL }),
            );
            const ctrl2 = await cards.mountCardForm(container, {
                flow: 'return-payload',
            });
            ctrl2.result.catch(() => {});

            expect(container.querySelector('iframe')).not.toBeNull();
            // Two separate fetches were made (the failed one was not cached).
            expect(fetchMock).toHaveBeenCalledTimes(2);
        });
    });
});

/**
 * The submit is the only thing the customer does that the SDK can observe:
 * everything they type is inside the iframe and stays there. Without it the
 * funnel jumps from "the form was mounted" straight to the charge, so a
 * customer who never submitted and a submit whose result never arrived are the
 * same absence.
 */
describe('the card form submit is reported', () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    let client: ReturnType<typeof createHttpClient>;
    let container: HTMLDivElement;
    let telemetry: BrowserTelemetry & {
        submit: ReturnType<typeof vi.fn>;
        lifecycle: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
        fetchMock = vi
            .fn()
            .mockResolvedValue(makeResponse({ card_form_url: CARD_FORM_URL }));
        vi.stubGlobal('fetch', fetchMock);
        client = makeClient();
        container = document.createElement('div');
        document.body.appendChild(container);
        telemetry = {
            apiCall: vi.fn(),
            error: vi.fn(),
            lifecycle: vi.fn(),
            submit: vi.fn(),
            cardFormHeight: vi.fn(),
        } as unknown as typeof telemetry;
    });

    afterEach(() => {
        container.remove();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    /** Enough of the surface for the charge to resolve; the flow itself is
     *  covered elsewhere — what matters here is that the submit precedes it. */
    const stubPaymentsApi = () =>
        ({
            chargePayment: vi.fn().mockResolvedValue({}),
            awaitChargeState: vi
                .fn()
                .mockResolvedValue({ state: 'SUCCEEDED', id: 'pay_001' }),
            getStatus: vi.fn(),
            getChargeState: vi.fn(),
            getGooglePayInfo: vi.fn(),
            getApplePayInfo: vi.fn(),
            getApplePayAppInfo: vi.fn(),
            startApplePaySession: vi.fn(),
            getQRPaymentInfo: vi.fn(),
        }) as unknown as ReturnType<typeof createPaymentsApi>;

    const mountAndSubmit = async (flow: 'return-payload' | 'direct-charge') => {
        const paymentsApi = flow === 'direct-charge' ? stubPaymentsApi() : null;
        const cards = createCardsApi(client, () => paymentsApi, telemetry);
        const ctrl = await cards.mountCardForm(
            container,
            flow === 'direct-charge'
                ? { flow, threeDS: { mode: 'manual' } }
                : { flow },
        );
        ctrl.result.catch(() => {});
        const iframe = container.querySelector('iframe') as HTMLIFrameElement;
        iframe.onload?.(new Event('load'));
        simulateMessage(iframe, {
            type: 'GOPAY_CARD_ENCRYPT_RESULT',
            card_token: 'enc_token_abc',
        });
        return ctrl;
    };

    it('reports the submit in the encrypt-only flow, which makes no request at all after it', async () => {
        const ctrl = await mountAndSubmit('return-payload');
        await ctrl.result;

        expect(telemetry.submit).toHaveBeenCalledOnce();
        expect(telemetry.submit.mock.calls[0]?.[0]).toBe('card-form');
        expect(telemetry.submit.mock.calls[0]?.[1]).toMatchObject({
            paymentMethod: 'card',
            flow: 'return-payload',
        });
    });

    it('reports the submit in the direct-charge flow too, ahead of the charge', async () => {
        const ctrl = await mountAndSubmit('direct-charge');
        await ctrl.result.catch(() => {});

        expect(telemetry.submit).toHaveBeenCalledOnce();
        expect(telemetry.submit.mock.calls[0]?.[1]).toMatchObject({
            paymentMethod: 'card',
            flow: 'direct-charge',
        });
    });

    it('never puts the encrypted payload, or anything derived from it, in the event', async () => {
        const ctrl = await mountAndSubmit('return-payload');
        await ctrl.result;

        const reported = JSON.stringify(telemetry.submit.mock.calls[0]);
        expect(reported).not.toContain('enc_token_abc');
        // A length or a hash would be derived from card data too — the only
        // number here is how long the form was on the page.
        expect(Object.keys(telemetry.submit.mock.calls[0]?.[1] ?? {})).toEqual([
            'paymentMethod',
            'flow',
            'durationMs',
        ]);
    });

    it('measures the form being on the page, and reports null when it never loaded', async () => {
        const cards = createCardsApi(client, () => null, telemetry);
        const ctrl = await cards.mountCardForm(container, {
            flow: 'return-payload',
        });
        ctrl.result.catch(() => {});
        const iframe = container.querySelector('iframe') as HTMLIFrameElement;

        // No onload: the iframe never became usable, so there is no start to
        // measure from and a fabricated 0 would read as an instant submit.
        simulateMessage(iframe, {
            type: 'GOPAY_CARD_ENCRYPT_RESULT',
            card_token: 'enc_token_abc',
        });
        await ctrl.result;

        expect(telemetry.submit.mock.calls[0]?.[1]?.durationMs).toBeNull();
    });
});

/**
 * The height the iframe reports is applied as it arrives and was never
 * recorded, so a height jumping up and down — suspected while the customer
 * fills the form — left nothing behind to measure. What it reports now is
 * bounded on purpose: at most one event when the height starts oscillating
 * and one summary when the form goes away, never one per message.
 */
describe('the card form height is reported', () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    let client: ReturnType<typeof createHttpClient>;
    let container: HTMLDivElement;
    let telemetry: BrowserTelemetry & {
        cardFormHeight: ReturnType<typeof vi.fn>;
    };
    let mounted: { unmount: () => void }[];

    beforeEach(() => {
        fetchMock = vi
            .fn()
            .mockResolvedValue(makeResponse({ card_form_url: CARD_FORM_URL }));
        vi.stubGlobal('fetch', fetchMock);
        client = makeClient();
        container = document.createElement('div');
        document.body.appendChild(container);
        telemetry = {
            apiCall: vi.fn(),
            error: vi.fn(),
            lifecycle: vi.fn(),
            submit: vi.fn(),
            walletUnavailable: vi.fn(),
            integratorError: vi.fn(),
            unmount: vi.fn(),
            walletAvailability: vi.fn(),
            walletStep: vi.fn(),
            cardFormHeight: vi.fn(),
        } as unknown as typeof telemetry;
        mounted = [];
    });

    afterEach(() => {
        // Each mount registers its own pagehide listener; unmounting is what
        // removes it, so one test's form cannot answer the next test's event.
        for (const ctrl of mounted) {
            ctrl.unmount();
        }
        container.remove();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    const mount = async ({ loaded = true } = {}) => {
        const cards = createCardsApi(client, () => null, telemetry);
        const ctrl = await cards.mountCardForm(container, {
            flow: 'return-payload',
        });
        ctrl.result.catch(() => {});
        mounted.push(ctrl);
        const iframe = container.querySelector('iframe') as HTMLIFrameElement;
        if (loaded) {
            iframe.onload?.(new Event('load'));
        }
        const sendHeights = (...heights: number[]) => {
            for (const height of heights) {
                simulateMessage(iframe, {
                    type: 'GOPAY_CARD_FORM_HEIGHT',
                    height,
                });
            }
        };
        return { ctrl, iframe, sendHeights };
    };

    /** What each cardFormHeight call was given, in order. */
    const reports = () =>
        telemetry.cardFormHeight.mock.calls.map(
            (call) =>
                call[0] as {
                    phase: string;
                    flow: string;
                    durationMs: number | null;
                    measurements: Record<string, unknown>;
                },
        );

    it('sends nothing per message, however many arrive', async () => {
        const { iframe, sendHeights } = await mount();
        for (let height = 100; height < 150; height += 1) {
            sendHeights(height);
        }

        expect(telemetry.cardFormHeight).not.toHaveBeenCalled();
        // Applying the height is what the tracking must never get in the way of.
        expect(iframe.style.height).toBe('149px');
    });

    it('reports an oscillation the moment it happens, and only once', async () => {
        const { iframe, sendHeights } = await mount();
        sendHeights(178, 194, 178, 194, 178);

        expect(reports()).toHaveLength(1);
        expect(reports()[0]).toMatchObject({
            phase: 'oscillation',
            flow: 'return-payload',
            measurements: {
                reversals: 3,
                min: 178,
                max: 194,
                recent: '178,194,178,194,178',
                oscillated: true,
            },
        });
        expect(reports()[0]?.durationMs).toEqual(expect.any(Number));

        sendHeights(194, 178, 194, 178, 194, 178);
        expect(reports()).toHaveLength(1);
        expect(iframe.style.height).toBe('178px');
    });

    it('summarises the heights once when the form is unmounted', async () => {
        const { ctrl, sendHeights } = await mount();
        sendHeights(178, 218, 178);

        ctrl.unmount();
        ctrl.unmount();
        window.dispatchEvent(new Event('pagehide'));

        expect(reports()).toHaveLength(1);
        expect(reports()[0]).toMatchObject({
            phase: 'summary',
            flow: 'return-payload',
            measurements: {
                messages: 3,
                changes: 2,
                reversals: 1,
                min: 178,
                max: 218,
                last: 178,
                recent: '178,218,178',
                oscillated: false,
                ended: 'unmount',
            },
        });
    });

    it('summarises when the card is submitted', async () => {
        const { ctrl, iframe, sendHeights } = await mount();
        sendHeights(178);
        simulateMessage(iframe, {
            type: 'GOPAY_CARD_ENCRYPT_RESULT',
            card_token: 'enc_token_abc',
        });
        await ctrl.result;

        expect(reports()).toHaveLength(1);
        expect(reports()[0]?.measurements).toMatchObject({
            messages: 1,
            ended: 'encrypted',
        });
        // The payload is the one thing that must never ride along.
        expect(JSON.stringify(reports())).not.toContain('enc_token_abc');
    });

    it('summarises when the customer leaves with the form still mounted', async () => {
        const { ctrl, sendHeights } = await mount();
        sendHeights(178, 194);

        window.dispatchEvent(new Event('pagehide'));
        ctrl.unmount();

        expect(reports()).toHaveLength(1);
        expect(reports()[0]?.measurements).toMatchObject({
            messages: 2,
            ended: 'leave',
        });
    });

    it('treats a page restored from the back/forward cache as a second visit', async () => {
        const pageTransition = (type: string, persisted: boolean) => {
            const event = new Event(type);
            Object.defineProperty(event, 'persisted', { value: persisted });
            return event;
        };
        const { ctrl, sendHeights } = await mount();
        sendHeights(178, 194);

        // Into the cache: the summary goes out, since the page may never
        // come back and this is then the last word.
        window.dispatchEvent(pageTransition('pagehide', true));
        expect(reports()).toHaveLength(1);
        expect(reports()[0]?.measurements).toMatchObject({
            messages: 2,
            ended: 'leave',
        });

        // Back again, form still mounted: its heights and its end are the
        // second visit's, not lost behind the first summary.
        window.dispatchEvent(pageTransition('pageshow', true));
        sendHeights(231);
        ctrl.unmount();

        expect(reports()).toHaveLength(2);
        expect(reports()[1]?.measurements).toMatchObject({
            messages: 1,
            last: 231,
            ended: 'unmount',
        });
    });

    it('sends nothing for a form that never loaded', async () => {
        const { ctrl } = await mount({ loaded: false });

        ctrl.unmount();
        window.dispatchEvent(new Event('pagehide'));

        expect(telemetry.cardFormHeight).not.toHaveBeenCalled();
    });

    it('measures the frame while it is still in the document', async () => {
        // The summary is sent from cleanup(), which also removes the iframe; a
        // detached frame measures 0 wide, which would read as a real width.
        vi.spyOn(
            HTMLIFrameElement.prototype,
            'getBoundingClientRect',
        ).mockImplementation(function (this: HTMLIFrameElement) {
            return { width: this.isConnected ? 518.1818 : 0 } as DOMRect;
        });
        const { ctrl, sendHeights } = await mount();
        sendHeights(176);

        ctrl.unmount();

        expect(reports()[0]?.measurements).toMatchObject({
            iframe_width: 518.18,
            device_pixel_ratio: globalThis.devicePixelRatio,
        });
    });
});

/**
 * Tearing the form down on purpose is not a failure. It used to reach
 * gw-logger as SDK.CARD_FORM_ERROR — the same event as an iframe that never
 * loaded — while the wallet buttons already reported theirs as an unmount
 * (GPOMA-2668). The integrator's side is deliberately unchanged: `result`
 * still rejects and onError still fires.
 */
describe('unmounting the card form is reported as an unmount, not an error', () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    let container: HTMLDivElement;
    let onError: ReturnType<typeof vi.fn<(error: unknown) => void>>;
    /** Core's seam: where SDK errors become events. */
    let coreTelemetry: {
        apiCall: ReturnType<typeof vi.fn>;
        error: ReturnType<typeof vi.fn>;
    };
    let telemetry: BrowserTelemetry & { unmount: ReturnType<typeof vi.fn> };
    let client: ReturnType<typeof createHttpClient>;

    beforeEach(() => {
        fetchMock = vi
            .fn()
            .mockResolvedValue(makeResponse({ card_form_url: CARD_FORM_URL }));
        vi.stubGlobal('fetch', fetchMock);
        container = document.createElement('div');
        document.body.appendChild(container);
        onError = vi.fn<(error: unknown) => void>();
        coreTelemetry = { apiCall: vi.fn(), error: vi.fn() };
        client = createHttpClient(
            {
                baseUrl: 'https://example.com',
                shareableKey: 'pk_test',
                onError,
            },
            undefined,
            coreTelemetry as never,
        );
        client.setClientId('cid_test');
        telemetry = {
            apiCall: vi.fn(),
            error: vi.fn(),
            lifecycle: vi.fn(),
            submit: vi.fn(),
            walletUnavailable: vi.fn(),
            integratorError: vi.fn(),
            unmount: vi.fn(),
            walletAvailability: vi.fn(),
            walletStep: vi.fn(),
            cardFormHeight: vi.fn(),
        } as unknown as typeof telemetry;
    });

    afterEach(() => {
        container.remove();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    const loadedIframe = () => {
        const iframe = container.querySelector('iframe') as HTMLIFrameElement;
        iframe.onload?.(new Event('load'));
        return iframe;
    };

    it('reports an idle unmount as its own event and no error event', async () => {
        const cards = createCardsApi(client, () => null, telemetry);
        const ctrl = await cards.mountCardForm(container, {
            flow: 'return-payload',
        });
        loadedIframe();

        ctrl.unmount();

        await expect(ctrl.result).rejects.toMatchObject({
            errorCode: GoPayErrorCodes.CARD_FORM_ERROR,
        });
        expect(telemetry.unmount).toHaveBeenCalledOnce();
        expect(telemetry.unmount).toHaveBeenCalledWith({
            paymentMethod: 'card',
            sheetOpen: false,
            chargeInFlight: false,
        });
        // One teardown is one event.
        expect(coreTelemetry.error).not.toHaveBeenCalled();
        // The integrator still hears about it, exactly once.
        expect(onError).toHaveBeenCalledOnce();
        expect(onError).toHaveBeenCalledWith(
            expect.objectContaining({
                errorCode: GoPayErrorCodes.CARD_FORM_ERROR,
            }),
        );
    });

    it('marks an unmount during the direct charge as a charge in flight', async () => {
        // The one teardown that leaves the outcome unknown: the charge can
        // still succeed at GoPay after `result` rejects.
        const paymentsApi = {
            chargePayment: vi.fn(() => new Promise(() => {})),
            awaitChargeState: vi.fn(),
        } as unknown as ReturnType<typeof createPaymentsApi>;
        const cards = createCardsApi(client, () => paymentsApi, telemetry);
        const ctrl = await cards.mountCardForm(container, {
            flow: 'direct-charge',
            threeDS: { mode: 'manual' },
        });
        ctrl.result.catch(() => {});
        const iframe = loadedIframe();
        simulateMessage(iframe, {
            type: 'GOPAY_CARD_ENCRYPT_RESULT',
            card_token: 'enc_token_abc',
        });
        expect(paymentsApi.chargePayment).toHaveBeenCalledOnce();

        ctrl.unmount();

        expect(telemetry.unmount).toHaveBeenCalledWith({
            paymentMethod: 'card',
            sheetOpen: false,
            chargeInFlight: true,
        });
        expect(coreTelemetry.error).not.toHaveBeenCalled();
    });

    /**
     * The terminal `idle` is emitted before `result` settles, and the
     * integrator's callback runs synchronously — so an unmount() from inside
     * it must not describe a charge whose outcome is already known as still
     * in flight.
     */
    const unmountFromTerminalIdle = async (
        awaitChargeState: () => Promise<unknown>,
    ) => {
        const paymentsApi = {
            chargePayment: vi.fn().mockResolvedValue({}),
            awaitChargeState: vi.fn(awaitChargeState),
        } as unknown as ReturnType<typeof createPaymentsApi>;
        const cards = createCardsApi(client, () => paymentsApi, telemetry);
        let ctrl: Awaited<ReturnType<typeof cards.mountCardForm>> | undefined;
        let previous: string | undefined;
        ctrl = await cards.mountCardForm(container, {
            flow: 'direct-charge',
            threeDS: { mode: 'manual' },
            onLoadingStateChange: (state) => {
                // Recorded first: unmount() emits `idle` again from its own
                // teardown, and that nested call must not unmount a second
                // time.
                const was = previous;
                previous = state;
                if (state === 'idle' && was === 'polling-charge-state') {
                    ctrl?.unmount();
                }
            },
        });
        const iframe = loadedIframe();
        simulateMessage(iframe, {
            type: 'GOPAY_CARD_ENCRYPT_RESULT',
            card_token: 'enc_token_abc',
        });
        await ctrl.result.catch(() => {});
        return telemetry.unmount.mock.calls[0]?.[0];
    };

    it('does not call a charge that succeeded in flight', async () => {
        const reported = await unmountFromTerminalIdle(() =>
            Promise.resolve({ state: 'SUCCEEDED', id: 'pay_001' }),
        );
        expect(reported).toMatchObject({ chargeInFlight: false });
    });

    it('does not call a charge that terminally failed in flight', async () => {
        const reported = await unmountFromTerminalIdle(() =>
            Promise.reject(
                new GoPaySDKError('[GoPaySDK] Charge failed', {
                    errorCode: GoPayErrorCodes.CHARGE_FAILED,
                    chargeState: { state: 'FAILED' },
                }),
            ),
        );
        expect(reported).toMatchObject({ chargeInFlight: false });
    });

    it('keeps a charge whose outcome is unknown in flight', async () => {
        // A timeout carries no state: the charge may still complete at GoPay.
        const reported = await unmountFromTerminalIdle(() =>
            Promise.reject(
                new GoPaySDKError('[GoPaySDK] Charge did not progress', {
                    errorCode: GoPayErrorCodes.CHARGE_TIMEOUT,
                }),
            ),
        );
        expect(reported).toMatchObject({ chargeInFlight: true });
    });

    it('still reports a card form that genuinely failed as an error', async () => {
        const cards = createCardsApi(client, () => null, telemetry);
        const ctrl = await cards.mountCardForm(container, {
            flow: 'return-payload',
        });
        ctrl.result.catch(() => {});
        const iframe = loadedIframe();

        simulateMessage(iframe, {
            type: 'GOPAY_CARD_ENCRYPT_ERROR',
            error: 'Encryption failed',
            code: 'ENCRYPTION_FAILED',
        });

        expect(coreTelemetry.error).toHaveBeenCalledOnce();
        expect(coreTelemetry.error).toHaveBeenCalledWith(
            expect.objectContaining({
                errorCode: GoPayErrorCodes.CARD_FORM_ERROR,
            }),
        );
        expect(telemetry.unmount).not.toHaveBeenCalled();
    });
});
