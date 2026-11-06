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
            // Second argument is the optional callbacks object, not a URL — the
            // validation URL has not been a parameter here for some time.
            expect(() => sdk.startApplePaySession(session)).toThrow(
                expect.objectContaining({
                    errorCode: GoPayErrorCodes.PAYMENT_NOT_ATTACHED,
                }),
            );
        });
    });

    // -------------------------------------------------------------------------
    // isAuthenticated() / logout()
    // -------------------------------------------------------------------------

    describe('getBrowserData()', () => {
        it('works before attachPayment, using only the shareable key', async () => {
            const detected = {
                ip: '192.0.2.42',
                user_agent: 'Real/1.0',
                accept_header: '{"accept":"application/json"}',
            };
            // The call is now timed, so a telemetry POST follows it and would
            // be the last request seen — pick the one under test by URL.
            const seen: Request[] = [];
            fetchMock.mockImplementation(async (req: Request) => {
                seen.push(req);
                return makeResponse(detected);
            });

            const data = await sdk.getBrowserData();

            const capturedReq = seen.find((r) =>
                r.url.includes('/cards/browser-data'),
            ) as Request;
            expect(capturedReq).toBeDefined();
            expect(capturedReq.url).toBe(
                'https://example.com/cards/browser-data',
            );
            expect(capturedReq.headers.get('Authorization')).toBe(
                `Basic ${globalThis.btoa('cid_test:pk_test')}`,
            );
            expect(data.ip).toBe(detected.ip);
            expect(data.javascript_enabled).toBe(true);
        });
    });

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
                // Match the token request specifically: the SDK also posts
                // operational data to the gw-logger ingest, and capturing
                // whichever call happened to be last would assert on that.
                if (req.url.includes('/oauth2/token')) {
                    capturedReq = req;
                    capturedBody = await req.clone().text();
                }
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
                // Only the payments call: the SDK also posts operational data
                // to the gw-logger ingest, which would otherwise be the last
                // url seen and overwrite this.
                if (req.url.includes('/payments/')) {
                    capturedUrl = req.url;
                }
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

    // -------------------------------------------------------------------------
    // Correlation headers — the ids gw-logger events carry, on API v4 requests
    // -------------------------------------------------------------------------

    describe('correlation headers', () => {
        const API = 'https://example.com/';
        const apiRequests = (seen: Request[]) =>
            seen.filter((req) => req.url.startsWith(API));
        const header = (req: Request | undefined, name: string) =>
            req?.headers.get(name) ?? null;
        /** The gw-logger events posted so far, parsed. */
        const loggedEvents = async (seen: Request[]) =>
            Promise.all(
                seen
                    .filter((req) => !req.url.startsWith(API))
                    .map(async (req) => {
                        const { event } = (await req.clone().json()) as {
                            event: Record<string, unknown>;
                        };
                        return event;
                    }),
            );

        let seen: Request[];

        beforeEach(() => {
            seen = [];
        });

        const answer = (
            route: (req: Request) => Response | undefined = () => undefined,
        ) =>
            fetchMock.mockImplementation(async (req: Request) => {
                seen.push(req);
                const routed = route(req);
                if (routed) {
                    return routed;
                }
                if (!req.url.startsWith(API)) {
                    return new Response(null, { status: 204 });
                }
                return makeResponse(
                    req.url.includes('/oauth2/token')
                        ? validTokenPair
                        : { id: 'pay_001', state: 'REQUESTED' },
                );
            });

        it('puts the page’s transaction id, a trace id per request and the payment on every API call, and no User-Agent', async () => {
            answer();

            await sdk.attachPayment({
                paymentId: 'pay_001',
                paymentSecret: 'secret',
            });
            await sdk.getChargeState();

            const api = apiRequests(seen);
            expect(api.map((req) => new URL(req.url).pathname)).toEqual([
                '/oauth2/token',
                '/payments/pay_001/charge',
            ]);
            const [token, charge] = api;
            const transactionId = header(token, 'X-GoPay-Transaction-Id');
            expect(transactionId).toMatch(/\S/u);
            expect(header(charge, 'X-GoPay-Transaction-Id')).toBe(
                transactionId,
            );
            // The token exchange names no payment in its path; the attached
            // one goes on it all the same.
            expect(header(token, 'X-GoPay-Payment-Session-Id')).toBe('pay_001');
            expect(header(charge, 'X-GoPay-Payment-Session-Id')).toBe(
                'pay_001',
            );
            expect(header(token, 'X-GoPay-Trace-Id')).toMatch(/\S/u);
            expect(header(charge, 'X-GoPay-Trace-Id')).not.toBe(
                header(token, 'X-GoPay-Trace-Id'),
            );
            for (const req of api) {
                // Not settable from a page, and would fail the preflight.
                expect(header(req, 'User-Agent')).toBeNull();
            }

            // Same page, same transaction as the events gw-logger received.
            const events = await loggedEvents(seen);
            expect(events.length).toBeGreaterThan(0);
            for (const event of events) {
                expect(event.transaction_id).toBe(transactionId);
            }
        });

        it('gives the api_call event the trace id its request went out with', async () => {
            answer();

            // Numeric, as real ids are: the event's target is the template.
            await sdk.attachPayment({
                paymentId: '3000000001',
                paymentSecret: 'secret',
            });
            await sdk.getChargeState();

            const [token, charge] = apiRequests(seen);
            const apiCalls = (await loggedEvents(seen)).filter(
                (event) => event.event_type === 'api_call',
            );
            expect(
                apiCalls.map((event) => [event.target, event.trace_id]),
            ).toEqual([
                ['/oauth2/token', header(token, 'X-GoPay-Trace-Id')],
                ['/payments/{id}/charge', header(charge, 'X-GoPay-Trace-Id')],
            ]);
        });

        it('keeps the trace id across the retry after a 401, and gives the re-grant its own', async () => {
            let charges = 0;
            answer((req) => {
                if (req.url.includes('/charge') && charges++ === 0) {
                    return makeResponse({}, 401);
                }
                return undefined;
            });

            await sdk.attachPayment({
                paymentId: 'pay_001',
                paymentSecret: 'secret',
            });
            await sdk.getChargeState();

            const api = apiRequests(seen);
            expect(api.map((req) => new URL(req.url).pathname)).toEqual([
                '/oauth2/token',
                '/payments/pay_001/charge',
                '/oauth2/token',
                '/payments/pay_001/charge',
            ]);
            const [token, first, regrant, retry] = api;
            expect(header(retry, 'X-GoPay-Trace-Id')).toBe(
                header(first, 'X-GoPay-Trace-Id'),
            );
            // The re-grant is a request of its own, and its api_call event says so.
            const tokenCalls = (await loggedEvents(seen)).filter(
                (event) =>
                    event.event_type === 'api_call' &&
                    event.target === '/oauth2/token',
            );
            expect(tokenCalls.map((event) => event.trace_id)).toEqual([
                header(token, 'X-GoPay-Trace-Id'),
                header(regrant, 'X-GoPay-Trace-Id'),
            ]);
            expect(header(regrant, 'X-GoPay-Trace-Id')).not.toBe(
                header(first, 'X-GoPay-Trace-Id'),
            );
            expect(header(regrant, 'X-GoPay-Payment-Session-Id')).toBe(
                'pay_001',
            );
        });

        it('sets them on the browser-data request, the payment only once one is attached', async () => {
            answer((req) =>
                req.url.includes('/cards/browser-data')
                    ? makeResponse({
                          ip: '203.0.113.7',
                          user_agent: 'jsdom',
                          accept_header: 'text/html',
                      })
                    : undefined,
            );

            await sdk.getBrowserData();
            await sdk.attachPayment({
                paymentId: 'pay_001',
                paymentSecret: 'secret',
            });
            await sdk.getBrowserData();

            const [before, , after] = apiRequests(seen);
            expect(new URL(before?.url ?? '').pathname).toBe(
                '/cards/browser-data',
            );
            expect(header(before, 'X-GoPay-Trace-Id')).toMatch(/\S/u);
            expect(header(before, 'X-GoPay-Transaction-Id')).toMatch(/\S/u);
            expect(header(before, 'X-GoPay-Payment-Session-Id')).toBeNull();
            expect(header(after, 'X-GoPay-Payment-Session-Id')).toBe('pay_001');

            const apiCall = (await loggedEvents(seen)).find(
                (event) =>
                    event.event_type === 'api_call' &&
                    event.target === '/cards/browser-data',
            );
            expect(apiCall?.trace_id).toBe(header(before, 'X-GoPay-Trace-Id'));
        });

        it('puts the ids of the failed request on the error', async () => {
            answer((req) =>
                req.url.includes('/charge')
                    ? makeResponse({ errors: [] }, 500)
                    : undefined,
            );
            await sdk.attachPayment({
                paymentId: 'pay_001',
                paymentSecret: 'secret',
            });

            const error = await sdk.getChargeState().catch((e: unknown) => e);

            const api = apiRequests(seen);
            const charge = api[api.length - 1];
            expect(error).toMatchObject({
                status: 500,
                traceId: header(charge, 'X-GoPay-Trace-Id'),
                transactionId: header(charge, 'X-GoPay-Transaction-Id'),
            });
        });

        // http:// pages, some WebViews and older browsers have Web Crypto without randomUUID:
        // a trace id from it alone failed every request there before it went out.
        it('still sends every request where the page has no crypto.randomUUID', async () => {
            const real = globalThis.crypto;
            vi.stubGlobal('crypto', {
                getRandomValues: real.getRandomValues.bind(real),
                subtle: real.subtle,
            });
            answer();

            await sdk.attachPayment({
                paymentId: 'pay_001',
                paymentSecret: 'secret',
            });
            await sdk.getChargeState();

            const [token, charge] = apiRequests(seen);
            expect(header(token, 'X-GoPay-Trace-Id')).toMatch(/\S/u);
            expect(header(charge, 'X-GoPay-Trace-Id')).toMatch(/\S/u);
            expect(header(charge, 'X-GoPay-Trace-Id')).not.toBe(
                header(token, 'X-GoPay-Trace-Id'),
            );
        });

        const timeoutError = () =>
            Object.assign(new Error('timed out'), { name: 'TimeoutError' });
        const stalledBody = () => {
            const response = makeResponse({});
            Object.defineProperty(response, 'json', {
                value: async () => {
                    throw timeoutError();
                },
            });
            return response;
        };

        // Every way the request can fail ends as an SDK error carrying the ids it went out with,
        // reading the body included: that is where a stalled response times out.
        it.each([
            [
                'fails in the network',
                (): Response => {
                    throw new TypeError('Failed to fetch');
                },
                { errorCode: GoPayErrorCodes.NETWORK_ERROR },
            ],
            [
                'times out',
                (): Response => {
                    throw timeoutError();
                },
                { errorCode: GoPayErrorCodes.NETWORK_TIMEOUT },
            ],
            [
                'stalls its body until it times out',
                stalledBody,
                { errorCode: GoPayErrorCodes.NETWORK_TIMEOUT },
            ],
            [
                'answers 200 with a body that is not JSON',
                () => new Response('<html></html>', { status: 200 }),
                { errorCode: GoPayErrorCodes.NETWORK_ERROR },
            ],
            [
                'answers 200 with a body of another shape',
                () => makeResponse({}),
                { errorCode: GoPayErrorCodes.NETWORK_ERROR },
            ],
            [
                'answers 500',
                () => makeResponse({ errors: [] }, 500),
                { status: 500 },
            ],
        ])(
            'puts the ids on a browser-data request that %s',
            async (_name, respond, expected) => {
                answer((req) =>
                    req.url.includes('/cards/browser-data')
                        ? respond()
                        : undefined,
                );

                const error = await sdk
                    .getBrowserData()
                    .catch((e: unknown) => e);

                const [request] = apiRequests(seen);
                expect(error).toMatchObject({
                    ...expected,
                    traceId: header(request, 'X-GoPay-Trace-Id'),
                    transactionId: header(request, 'X-GoPay-Transaction-Id'),
                });
            },
        );

        it('leaves the caller’s own abort of the browser-data request as it is', async () => {
            const controller = new AbortController();
            controller.abort();
            const aborted = Object.assign(new Error('aborted'), {
                name: 'AbortError',
            });
            answer((req) => {
                if (req.url.includes('/cards/browser-data')) {
                    throw aborted;
                }
                return undefined;
            });

            const error = await sdk
                .getBrowserData({ signal: controller.signal })
                .catch((e: unknown) => e);

            expect(error).toBe(aborted);
        });

        it('keeps them off the requests to gw-logger', async () => {
            answer();

            await sdk.attachPayment({
                paymentId: 'pay_001',
                paymentSecret: 'secret',
            });

            const logger = seen.filter((req) => !req.url.startsWith(API));
            expect(logger.length).toBeGreaterThan(0);
            for (const req of logger) {
                for (const name of [
                    'X-GoPay-Trace-Id',
                    'X-GoPay-Transaction-Id',
                    'X-GoPay-Payment-Session-Id',
                ]) {
                    expect(header(req, name)).toBeNull();
                }
            }
        });
    });
});
