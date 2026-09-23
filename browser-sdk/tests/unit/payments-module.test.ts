import { createHttpClient } from '@gopay-internal/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoPayErrorCodes, GoPaySDKError } from '../../src/errors.js';
import { createPaymentsApi } from '../../src/modules/payments/payments.module.js';

const makeResponse = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
    });

const PAYMENT_ID = 'pay_browser_001';

/**
 * The browser data endpoint's response is shape-checked, so a mock that answers
 * every path with an empty object would fail the charge. This keeps that one
 * path valid and leaves the rest as the test wrote them.
 */
const respond = (req: Request, body: unknown = {}) =>
    new URL(req.url).pathname === '/cards/browser-data'
        ? makeResponse(DETECTED_BROWSER_DATA)
        : makeResponse(body);

const DETECTED_BROWSER_DATA = {
    ip: '192.0.2.42',
    user_agent: 'Real/1.0 (as seen by the API)',
    accept_header: '{"accept":"application/json"}',
};

const storedToken = {
    access_token: 'at-test',
    expires_in: 900,
    token_type: 'bearer' as const,
};

describe('createPaymentsApi() — browser SDK', () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    let client: ReturnType<typeof createHttpClient>;
    let api: ReturnType<typeof createPaymentsApi>;

    beforeEach(() => {
        // The browser data endpoint's response is shape-checked, so the
        // default mock has to answer it with a valid body; every other path
        // keeps the empty default.
        fetchMock = vi
            .fn()
            .mockImplementation(async (req: Request) =>
                new URL(req.url).pathname === '/cards/browser-data'
                    ? makeResponse(DETECTED_BROWSER_DATA)
                    : makeResponse({}),
            );
        vi.stubGlobal('fetch', fetchMock);
        // createGoPayBrowserSDK always supplies these — the browser data
        // endpoint is authenticated by the shareable key alone.
        client = createHttpClient({
            baseUrl: 'https://example.com',
            shareableKey: 'pk_test',
        });
        client.setClientId('cid_test');
        client.setToken(storedToken);
        api = createPaymentsApi(client, PAYMENT_ID);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    // -------------------------------------------------------------------------
    // getStatus()
    // -------------------------------------------------------------------------

    describe('getStatus()', () => {
        it('sends GET to /payments/{paymentId}', async () => {
            let capturedReq!: Request;
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                return respond(req);
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
                return respond(req);
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
                return respond(req);
            });

            await api.chargePayment({
                payment_instrument: {
                    payment_instrument: 'PAYMENT_CARD',
                    input: {
                        input_type: 'ENCRYPTED_CARD',
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

        it('takes ip, user_agent and accept_header from /cards/browser-data', async () => {
            const detected = {
                ip: '192.0.2.42',
                user_agent: 'Real/1.0 (as seen by the API)',
                accept_header: '{"accept":"application/json"}',
            };
            const calls: string[] = [];
            let capturedBody = '';
            fetchMock.mockImplementation(async (req: Request) => {
                calls.push(`${req.method} ${new URL(req.url).pathname}`);
                if (new URL(req.url).pathname === '/cards/browser-data') {
                    return makeResponse(detected);
                }
                capturedBody = await req.text();
                return respond(req);
            });

            await api.chargePayment({
                payment_instrument: {
                    payment_instrument: 'PAYMENT_CARD',
                    input: {
                        input_type: 'ENCRYPTED_CARD',
                        payload: 'enc_payload',
                    },
                },
            });

            // fetched immediately before the charge, never cached
            expect(calls).toEqual([
                'GET /cards/browser-data',
                `POST /payments/${PAYMENT_ID}/charge`,
            ]);
            const browserData =
                JSON.parse(capturedBody).payment_instrument.browser_data;
            expect(browserData.ip).toBe(detected.ip);
            expect(browserData.user_agent).toBe(detected.user_agent);
            expect(browserData.accept_header).toBe(detected.accept_header);
        });

        it('lets the caller override fields the endpoint returned', async () => {
            let capturedBody = '';
            fetchMock.mockImplementation(async (req: Request) => {
                if (new URL(req.url).pathname === '/cards/browser-data') {
                    return makeResponse({
                        ip: '192.0.2.42',
                        user_agent: 'Real/1.0',
                        accept_header: '{}',
                    });
                }
                capturedBody = await req.text();
                return respond(req);
            });

            await api.chargePayment({
                payment_instrument: {
                    payment_instrument: 'PAYMENT_CARD',
                    input: {
                        input_type: 'ENCRYPTED_CARD',
                        payload: 'enc_payload',
                    },
                    browser_data: { ip: '203.0.113.9', language: 'en-US' },
                },
            });

            const browserData =
                JSON.parse(capturedBody).payment_instrument.browser_data;
            expect(browserData.ip).toBe('203.0.113.9');
            expect(browserData.language).toBe('en-US');
            expect(browserData.user_agent).toBe('Real/1.0');
        });

        it('does not call the browser data endpoint without a card instrument', async () => {
            await api.chargePayment({});
            expect(fetchMock).toHaveBeenCalledOnce();
        });

        it('still charges when the browser data endpoint is unavailable', async () => {
            // The endpoint is not deployed on every environment yet — a 404
            // must not take the whole charge down with it.
            let capturedBody = '';
            fetchMock.mockImplementation(async (req: Request) => {
                if (new URL(req.url).pathname === '/cards/browser-data') {
                    return makeResponse({ error: 'not found' }, 404);
                }
                capturedBody = await req.text();
                return respond(req);
            });

            await api.chargePayment({
                payment_instrument: {
                    payment_instrument: 'PAYMENT_CARD',
                    input: {
                        input_type: 'ENCRYPTED_CARD',
                        payload: 'enc_payload',
                    },
                },
            });

            const browserData =
                JSON.parse(capturedBody).payment_instrument.browser_data;
            expect(browserData.javascript_enabled).toBe(true);
            // ip is simply absent, as it was before the endpoint existed
            expect(browserData.ip).toBeUndefined();
        });

        it('a 401 from the browser data endpoint keeps the payment session intact', async () => {
            // The endpoint is authenticated by shareable_key alone. Routing it
            // through the client's 401 handling would call refresh(), find no
            // client secret and clear the token store — including the client id —
            // breaking the very charge that was about to be sent.
            const paths: string[] = [];
            fetchMock.mockImplementation(async (req: Request) => {
                paths.push(new URL(req.url).pathname);
                if (new URL(req.url).pathname === '/cards/browser-data') {
                    return makeResponse({ error: 'unauthorized' }, 401);
                }
                return respond(req);
            });

            const err = await api
                .chargePayment({
                    payment_instrument: {
                        payment_instrument: 'PAYMENT_CARD',
                        input: {
                            input_type: 'ENCRYPTED_CARD',
                            payload: 'enc_payload',
                        },
                    },
                })
                .catch((e: unknown) => e);

            expect(err).toBeDefined();
            // no token refresh was attempted, and nothing was cleared
            expect(paths).not.toContain('/oauth2/token');
            expect(client.tokenStore.hasAccessToken()).toBe(true);
            expect(client.getClientId()).toBe('cid_test');
        });

        it('propagates a 5xx from the browser data endpoint instead of charging without ip', async () => {
            // A transient failure must not be converted into a charge missing the
            // now-required ip, which the API rejects with the real cause lost.
            const paths: string[] = [];
            fetchMock.mockImplementation(async (req: Request) => {
                paths.push(new URL(req.url).pathname);
                if (new URL(req.url).pathname === '/cards/browser-data') {
                    return makeResponse({ error: 'boom' }, 500);
                }
                return respond(req);
            });

            const err = await api
                .chargePayment({
                    payment_instrument: {
                        payment_instrument: 'PAYMENT_CARD',
                        input: {
                            input_type: 'ENCRYPTED_CARD',
                            payload: 'enc_payload',
                        },
                    },
                })
                .catch((e: unknown) => e);

            expect(err).toBeDefined();
            expect(paths).not.toContain(`/payments/${PAYMENT_ID}/charge`);
        });

        it('does not charge when the browser data fetch is aborted', async () => {
            const controller = new AbortController();
            controller.abort();
            const paths: string[] = [];
            fetchMock.mockImplementation(async (req: Request) => {
                paths.push(new URL(req.url).pathname);
                if (new URL(req.url).pathname === '/cards/browser-data') {
                    throw new DOMException('Aborted', 'AbortError');
                }
                return respond(req);
            });

            const err = await api
                .chargePayment(
                    {
                        payment_instrument: {
                            payment_instrument: 'PAYMENT_CARD',
                            input: {
                                input_type: 'ENCRYPTED_CARD',
                                payload: 'enc_payload',
                            },
                        },
                    },
                    { signal: controller.signal },
                )
                .catch((e: unknown) => e);

            expect(err).toBeDefined();
            // the charge POST must never be sent after a teardown
            expect(paths).not.toContain(`/payments/${PAYMENT_ID}/charge`);
        });

        it('covers the browser data fetch with the caller signal', async () => {
            // GPOMA-2512: unmount() aborts the whole sequence, so the fetch that
            // precedes the charge has to observe the same signal.
            const controller = new AbortController();
            const signals: AbortSignal[] = [];
            fetchMock.mockImplementation(async (req: Request) => {
                signals.push(req.signal);
                return respond(req);
            });

            await api.chargePayment(
                {
                    payment_instrument: {
                        payment_instrument: 'PAYMENT_CARD',
                        input: {
                            input_type: 'ENCRYPTED_CARD',
                            payload: 'enc_payload',
                        },
                    },
                },
                { signal: controller.signal },
            );

            expect(signals).toHaveLength(2);
            controller.abort();
            expect(signals.every((s) => s.aborted)).toBe(true);
        });

        it('ships the accept_header the endpoint returned, not a local guess', async () => {
            // Since GPOMA-2556 accept_header comes from /cards/browser-data —
            // the local approximation and its q-values are covered against
            // collectBrowserData() in browser-data.test.ts, not through a charge.
            let capturedBody = '';
            let capturedAccept = '';
            fetchMock.mockImplementation(async (req: Request) => {
                capturedAccept = req.headers.get('accept') ?? '';
                capturedBody = await req.text();
                return respond(req);
            });

            await api.chargePayment({
                payment_instrument: {
                    payment_instrument: 'PAYMENT_CARD',
                    input: {
                        input_type: 'ENCRYPTED_CARD',
                        payload: 'enc_payload',
                    },
                },
            });

            const browserData =
                JSON.parse(capturedBody).payment_instrument.browser_data;
            expect(browserData.accept_header).toBe(
                DETECTED_BROWSER_DATA.accept_header,
            );
            // the SDK still sets its own Accept header on the wire
            expect(capturedAccept).not.toBe('');
        });

        it('caller-supplied browser_data fields override collected values', async () => {
            let capturedBody = '';
            fetchMock.mockImplementation(async (req: Request) => {
                capturedBody = await req.text();
                return respond(req);
            });

            await api.chargePayment({
                payment_instrument: {
                    payment_instrument: 'PAYMENT_CARD',
                    input: {
                        input_type: 'ENCRYPTED_CARD',
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
                return respond(req);
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
                return respond(req);
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
                return respond(req);
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
                return respond(req);
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
                return respond(req);
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
                return respond(req);
            });

            await api.getQRPaymentInfo();
            expect(capturedUrl).not.toContain('format=');
        });

        it('appends ?format=png when requested', async () => {
            let capturedUrl = '';
            fetchMock.mockImplementation(async (req: Request) => {
                capturedUrl = req.url;
                return respond(req);
            });

            await api.getQRPaymentInfo('png');
            expect(capturedUrl).toContain('format=png');
        });

        it('appends ?format=svg when requested', async () => {
            let capturedUrl = '';
            fetchMock.mockImplementation(async (req: Request) => {
                capturedUrl = req.url;
                return respond(req);
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
            api.startApplePaySession(session);
            expect(session.begin).toHaveBeenCalledOnce();
        });

        it('wires onvalidatemerchant to call completeMerchantValidation on success', async () => {
            const merchantSession = { key: 'ms_token' };
            let capturedBody = '';
            fetchMock.mockImplementation(async (req: Request) => {
                capturedBody = await req.text();
                return makeResponse(merchantSession);
            });

            const session = makeMockSession();
            api.startApplePaySession(session);

            session.onvalidatemerchant?.({
                validationURL: 'https://apple.com/validate',
            });
            await new Promise((r) => setTimeout(r, 0));

            expect(JSON.parse(capturedBody)).toEqual({
                validationUrl: 'https://apple.com/validate',
            });
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
            api.startApplePaySession(session);

            session.onvalidatemerchant?.({});
            await new Promise((r) => setTimeout(r, 10));

            expect(session.abort).toHaveBeenCalledOnce();
        });

        it('fires the oncancel callback when the session is cancelled', () => {
            const session = makeMockSession();
            const oncancel = vi.fn();
            api.startApplePaySession(session, {
                oncancel,
            });

            session.oncancel?.({ type: 'cancel' });
            expect(oncancel).toHaveBeenCalledWith({ type: 'cancel' });
        });
    });

    // -------------------------------------------------------------------------
    // awaitChargeState()
    // -------------------------------------------------------------------------

    describe('awaitChargeState()', () => {
        it('resolves with SUCCEEDED state (manual mode)', async () => {
            fetchMock.mockResolvedValue(
                makeResponse({ state: 'SUCCEEDED', id: 'pay_001' }),
            );

            const result = await api.awaitChargeState({
                threeDS: { mode: 'manual' },
                intervalMs: 5,
                initialTimeoutMs: 5000,
            });
            expect(result).toMatchObject({ state: 'SUCCEEDED' });
        });

        it('rejects with CHARGE_FAILED when state is FAILED', async () => {
            fetchMock.mockResolvedValue(makeResponse({ state: 'FAILED' }));

            const err = await api
                .awaitChargeState({
                    threeDS: { mode: 'manual' },
                    intervalMs: 5,
                    initialTimeoutMs: 5000,
                })
                .catch((e: unknown) => e);
            expect(err).toBeInstanceOf(GoPaySDKError);
            expect((err as GoPaySDKError).errorCode).toBe(
                GoPayErrorCodes.CHARGE_FAILED,
            );
        });

        it('navigates the top page on ACTION_REQUIRED (default redirect mode)', async () => {
            const location = { href: '' };
            vi.stubGlobal('location', location);

            fetchMock
                .mockResolvedValueOnce(
                    makeResponse({
                        state: 'ACTION_REQUIRED',
                        action: { redirect_url: 'https://3ds.example.com' },
                    }),
                )
                .mockResolvedValue(makeResponse({ state: 'SUCCEEDED' }));

            const onActionRequired = vi.fn();
            await api.awaitChargeState({
                intervalMs: 5,
                initialTimeoutMs: 5000,
                onActionRequired,
            });

            expect(location.href).toBe('https://3ds.example.com');
            expect(onActionRequired).toHaveBeenCalledWith(
                'https://3ds.example.com',
            );
        });

        it('fires onActionRequired before navigating (redirect mode)', async () => {
            const location = { href: '' };
            vi.stubGlobal('location', location);

            fetchMock
                .mockResolvedValueOnce(
                    makeResponse({
                        state: 'ACTION_REQUIRED',
                        action: { redirect_url: 'https://3ds.example.com' },
                    }),
                )
                .mockResolvedValue(makeResponse({ state: 'SUCCEEDED' }));

            const callOrder: string[] = [];
            await api.awaitChargeState({
                intervalMs: 5,
                initialTimeoutMs: 5000,
                onActionRequired: () => {
                    callOrder.push(`callback:${location.href}`);
                },
            });

            // callback fires before location.href is set
            expect(callOrder).toEqual(['callback:']);
            expect(location.href).toBe('https://3ds.example.com');
        });

        it('rejects with CHARGE_FAILED when redirect URL is not https (redirect mode)', async () => {
            fetchMock.mockResolvedValueOnce(
                makeResponse({
                    state: 'ACTION_REQUIRED',
                    action: { redirect_url: 'http://insecure.example.com' },
                }),
            );

            const err = await api
                .awaitChargeState({ intervalMs: 5, initialTimeoutMs: 5000 })
                .catch((e: unknown) => e);
            expect(err).toBeInstanceOf(GoPaySDKError);
            expect((err as GoPaySDKError).errorCode).toBe(
                GoPayErrorCodes.CHARGE_FAILED,
            );
        });

        it('does not mount an iframe in manual mode', async () => {
            fetchMock
                .mockResolvedValueOnce(
                    makeResponse({
                        state: 'ACTION_REQUIRED',
                        action: { redirect_url: 'https://3ds.example.com' },
                    }),
                )
                .mockResolvedValue(makeResponse({ state: 'SUCCEEDED' }));

            const onActionRequired = vi.fn();
            await api.awaitChargeState({
                threeDS: { mode: 'manual' },
                intervalMs: 5,
                initialTimeoutMs: 5000,
                onActionRequired,
            });

            expect(onActionRequired).toHaveBeenCalledWith(
                'https://3ds.example.com',
            );
            expect(document.querySelector('iframe')).toBeNull();
        });

        // --- init-level defaultThreeDS ---

        it('uses init threeDS (manual) when no per-call threeDS is given', async () => {
            const apiManual = createPaymentsApi(client, PAYMENT_ID, {
                mode: 'manual',
            });
            const location = { href: '' };
            vi.stubGlobal('location', location);

            fetchMock
                .mockResolvedValueOnce(
                    makeResponse({
                        state: 'ACTION_REQUIRED',
                        action: { redirect_url: 'https://3ds.example.com' },
                    }),
                )
                .mockResolvedValue(makeResponse({ state: 'SUCCEEDED' }));

            const onActionRequired = vi.fn();
            await apiManual.awaitChargeState({
                intervalMs: 5,
                initialTimeoutMs: 5000,
                onActionRequired,
            });

            // manual mode: callback fires but page is NOT navigated
            expect(onActionRequired).toHaveBeenCalledWith(
                'https://3ds.example.com',
            );
            expect(location.href).toBe('');
            expect(document.querySelector('iframe')).toBeNull();
        });

        it('per-call threeDS overrides init threeDS', async () => {
            const apiManual = createPaymentsApi(client, PAYMENT_ID, {
                mode: 'manual',
            });

            const location = { href: '' };
            vi.stubGlobal('location', location);

            fetchMock
                .mockResolvedValueOnce(
                    makeResponse({
                        state: 'ACTION_REQUIRED',
                        action: { redirect_url: 'https://3ds.example.com' },
                    }),
                )
                .mockResolvedValue(makeResponse({ state: 'SUCCEEDED' }));

            // per-call 'redirect' overrides the init 'manual' → should navigate
            await apiManual.awaitChargeState({
                threeDS: { mode: 'redirect' },
                intervalMs: 5,
                initialTimeoutMs: 5000,
            });

            expect(location.href).toBe('https://3ds.example.com');
        });

        const stall3ds = () =>
            fetchMock.mockImplementation(async (req: Request) =>
                respond(req, {
                    state: 'ACTION_REQUIRED',
                    action: { redirect_url: 'https://3ds.example.com' },
                }),
            );

        it('leaves the watchdog off in manual mode, where the page is meant to stay', async () => {
            // Mutating `redirects` to a constant true left this file 34/34
            // green. It matters: in manual mode the integrator was handed the
            // URL and the page staying is the whole point, so a watchdog would
            // hand a working integration a CHARGE_TIMEOUT after 30 s.
            vi.useFakeTimers();
            try {
                vi.stubGlobal('location', { href: '' });
                stall3ds();

                let outcome: unknown = 'pending';
                api.awaitChargeState({
                    intervalMs: 2_000,
                    threeDS: { mode: 'manual' },
                }).then(
                    (value) => {
                        outcome = value;
                    },
                    (error: unknown) => {
                        outcome = error;
                    },
                );

                await vi.advanceTimersByTimeAsync(100);
                // Manual mode does not navigate; that is the caller's job.
                expect(location.href).toBe('');

                await vi.advanceTimersByTimeAsync(31_000);
                expect(outcome).toBe('pending');
            } finally {
                vi.useRealTimers();
            }
        });

        it('cancels the watchdog once the page is actually leaving', async () => {
            // pagehide is the signal that the navigation did happen. Nothing
            // dispatched it, so the cancellation was never exercised — and it
            // is what keeps a page frozen into the back/forward cache from
            // waking up with an expired timer and reporting a stall for a
            // redirect that worked.
            vi.useFakeTimers();
            try {
                vi.stubGlobal('location', { href: '' });
                stall3ds();

                let outcome: unknown = 'pending';
                api.awaitChargeState({ intervalMs: 2_000 }).then(
                    (value) => {
                        outcome = value;
                    },
                    (error: unknown) => {
                        outcome = error;
                    },
                );

                await vi.advanceTimersByTimeAsync(100);
                expect(location.href).toBe('https://3ds.example.com');

                window.dispatchEvent(new Event('pagehide'));
                await vi.advanceTimersByTimeAsync(60_000);

                expect(outcome).toBe('pending');
            } finally {
                vi.useRealTimers();
            }
        });

        it('reports a 3DS redirect that never left the page instead of waiting forever', async () => {
            // GPOMA-2668 §3. In a webview a top-level navigation can be
            // blocked or swallowed, and then nothing happens: the promise is
            // documented to stay pending "as the page unloads", the page never
            // unloads, and CHARGE_TIMEOUT stops counting at ACTION_REQUIRED.
            // Seen 22.09. as "3DS started, never finished, no message".
            vi.useFakeTimers();
            try {
                // A location that ignores the assignment — what a webview
                // that swallows the navigation looks like from inside.
                vi.stubGlobal('location', { href: '' });
                fetchMock.mockImplementation(async (req: Request) =>
                    respond(req, {
                        state: 'ACTION_REQUIRED',
                        action: { redirect_url: 'https://3ds.example.com' },
                    }),
                );

                let outcome: unknown = 'pending';
                api.awaitChargeState({ intervalMs: 2_000 }).then(
                    (value) => {
                        outcome = value;
                    },
                    (error: unknown) => {
                        outcome = error;
                    },
                );

                // The redirect is issued on the first poll; the watchdog
                // starts counting from there.
                await vi.advanceTimersByTimeAsync(100);
                expect(location.href).toBe('https://3ds.example.com');

                // Just short of the deadline, and still waiting: a redirect
                // that is merely slow must not be reported as one that never
                // happened. Asserting this is what pins the 30 s — a bound
                // that drifted down would start failing real payments.
                await vi.advanceTimersByTimeAsync(29_000);
                expect(outcome).toBe('pending');

                await vi.advanceTimersByTimeAsync(2_000);
                expect(outcome).toBeInstanceOf(GoPaySDKError);
                expect((outcome as GoPaySDKError).errorCode).toBe(
                    GoPayErrorCodes.CHARGE_TIMEOUT,
                );

                // And the poll it gave up on actually stopped. Promise.race
                // settles the caller's promise but cancels nothing, so without
                // an abort this would go on requesting the charge every two
                // seconds for as long as the page stayed open — after the SDK
                // had announced it had given up.
                const polls = () =>
                    fetchMock.mock.calls.filter((c: unknown[]) =>
                        String((c[0] as Request).url).endsWith('/charge'),
                    ).length;
                const settledAt = polls();
                await vi.advanceTimersByTimeAsync(60_000);
                expect(polls()).toBe(settledAt);
            } finally {
                vi.useRealTimers();
            }
        });
    });
});
