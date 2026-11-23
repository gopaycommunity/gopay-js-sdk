import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    type Mock,
    vi,
} from 'vitest';
import { GoPayErrorCodes } from '../../src/errors.js';
import { createGoPayBrowserSDK } from '../../src/gopay-browser-sdk.js';

/**
 * attachPayment() tells GoPay which client SDK works with the payment through
 * POST /payments/{id}/init-session, and waits for the answer: GoPay does not
 * cope with init-session overlapping another call on a fresh payment, so it
 * has to be answered before the page can make one. Nothing depends on what
 * the answer is, though, so it must never cost the checkout the payment: the
 * wait is capped, and a failure — a 409 is routine on a return page, the
 * payment is past CREATED there — neither rejects anything nor reaches the
 * integrator's onError.
 */

const makeResponse = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
    });

const tokenFor = (paymentId: string) => ({
    access_token: `jwt-${paymentId}`,
    expires_in: 900,
    token_type: 'bearer',
});

type InitSessionReply = () => Response | Promise<Response>;

describe('init-session on attachPayment()', () => {
    let initSessions: Request[];
    let logged: Request[];
    let initSessionReply: InitSessionReply;
    let tokenHolds: Map<string, Promise<void>>;
    let tokenExchanges: number;
    let onError: Mock<(error: unknown) => void>;
    let lastPaymentPath: string;
    let sdk: ReturnType<typeof createGoPayBrowserSDK>;

    const ownerOf = (req: Request) =>
        atob(
            (req.headers.get('Authorization') ?? '').replace('Basic ', ''),
        ).split(':')[0];

    beforeEach(() => {
        initSessions = [];
        logged = [];
        initSessionReply = () => new Response(null, { status: 204 });
        tokenHolds = new Map();
        tokenExchanges = 0;
        vi.stubGlobal(
            'fetch',
            vi.fn(async (req: Request) => {
                if (req.url.includes('/oauth2/token')) {
                    const owner = ownerOf(req);
                    tokenExchanges += 1;
                    await tokenHolds.get(owner);
                    return makeResponse(tokenFor(owner));
                }
                if (req.url.endsWith('/init-session')) {
                    initSessions.push(req);
                    return initSessionReply();
                }
                if (req.url.includes('/payments/')) {
                    lastPaymentPath = new URL(req.url).pathname;
                    return makeResponse({ id: 'pay-A', state: 'CREATED' });
                }
                // gw-logger ingest
                logged.push(req);
                return new Response(null, { status: 204 });
            }),
        );
        onError = vi.fn<(error: unknown) => void>();
        sdk = createGoPayBrowserSDK({
            baseUrl: 'https://example.com',
            shareableKey: 'pk_test',
            clientId: 'cid_test',
            onError,
        });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    /** Let everything already under way run as far as it can. */
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

    it('sends the browser SDK and its version, with the payment token', async () => {
        await sdk.attachPayment({ paymentId: 'pay-A', paymentSecret: 'sec' });
        await settle();

        expect(initSessions).toHaveLength(1);
        const [req] = initSessions;
        expect(req.method).toBe('POST');
        expect(new URL(req.url).pathname).toBe('/payments/pay-A/init-session');
        expect(req.headers.get('Authorization')).toBe('Bearer jwt-pay-A');
        expect(req.headers.get('Content-Type')).toMatch('application/json');
        expect(await req.clone().json()).toEqual({
            client_type: 'SDK_BROWSER',
            client_version: sdk.version,
        });
        expect(onError).not.toHaveBeenCalled();
    });

    // The payment's language follows Accept-Language. The browser sets it from
    // the customer's own preferences; anything the SDK put there would replace
    // them.
    it('leaves Accept-Language to the browser', async () => {
        await sdk.attachPayment({ paymentId: 'pay-A', paymentSecret: 'sec' });
        await settle();

        expect(initSessions[0].headers.get('Accept-Language')).toBeNull();
    });

    // The point of waiting: no call of the page's can reach the payment
    // while init-session is under way.
    it('holds the attach, and the payment’s methods, until it has answered', async () => {
        let answer!: () => void;
        const answered = new Promise<void>((resolve) => {
            answer = resolve;
        });
        initSessionReply = async () => {
            await answered;
            return new Response(null, { status: 204 });
        };
        let attached = false;

        const attach = sdk
            .attachPayment({ paymentId: 'pay-A', paymentSecret: 'sec' })
            .then(() => {
                attached = true;
            });
        await settle();
        expect(initSessions).toHaveLength(1);
        expect(attached).toBe(false);
        await expect(sdk.getStatus()).rejects.toMatchObject({
            errorCode: GoPayErrorCodes.PAYMENT_NOT_ATTACHED,
        });
        // The token is already held, but a page that unlocks its pay button
        // on isAuthenticated() must not be told yes for methods that throw.
        expect(sdk.isAuthenticated()).toBe(false);

        answer();
        await attach;
        expect(sdk.isAuthenticated()).toBe(true);
        await expect(sdk.getStatus()).resolves.toMatchObject({
            state: 'CREATED',
        });
    });

    it('stops waiting after 2 seconds for one that never answers', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        initSessionReply = () => new Promise<Response>(() => {});
        let attached = false;

        const attach = sdk
            .attachPayment({ paymentId: 'pay-A', paymentSecret: 'sec' })
            .then(() => {
                attached = true;
            });
        await vi.advanceTimersByTimeAsync(1_999);
        expect(initSessions).toHaveLength(1);
        expect(attached).toBe(false);

        await vi.advanceTimersByTimeAsync(1);
        await attach;
        await expect(sdk.getStatus()).resolves.toMatchObject({
            state: 'CREATED',
        });
        expect(onError).not.toHaveBeenCalled();
    });

    it('leaves no timer behind once it has answered', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

        await sdk.attachPayment({ paymentId: 'pay-A', paymentSecret: 'sec' });

        expect(vi.getTimerCount()).toBe(0);
    });

    // A double click, or an effect React runs twice: two init-sessions under
    // way for one fresh payment is the very overlap the wait is there against.
    it('sends one init-session for a payment attached again while it waits', async () => {
        let answer!: () => void;
        const answered = new Promise<void>((resolve) => {
            answer = resolve;
        });
        initSessionReply = async () => {
            await answered;
            return new Response(null, { status: 204 });
        };
        let secondAttached = false;

        const first = sdk.attachPayment({
            paymentId: 'pay-A',
            paymentSecret: 'sec',
        });
        first.catch(() => {});
        await settle();
        const second = sdk
            .attachPayment({ paymentId: 'pay-A', paymentSecret: 'sec' })
            .then(() => {
                secondAttached = true;
            });
        await settle();

        expect(initSessions).toHaveLength(1);
        expect(secondAttached).toBe(false);

        answer();
        await second;
        await expect(first).rejects.toMatchObject({
            errorCode: GoPayErrorCodes.PAYMENT_NOT_ATTACHED,
        });
        expect(initSessions).toHaveLength(1);
        expect(sdk.isAuthenticated()).toBe(true);
    });

    // Past the 2 seconds the first attach has resolved, but its request is
    // still out there: a second one would overlap it just the same.
    it('sends no second init-session while one that outlived the wait is still under way', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        initSessionReply = () => new Promise<Response>(() => {});

        const first = sdk.attachPayment({
            paymentId: 'pay-A',
            paymentSecret: 'sec',
        });
        await vi.advanceTimersByTimeAsync(2_000);
        await first;

        let secondAttached = false;
        const second = sdk
            .attachPayment({ paymentId: 'pay-A', paymentSecret: 'sec' })
            .then(() => {
                secondAttached = true;
            });
        // The second attach gets a full wait of its own.
        await vi.advanceTimersByTimeAsync(1_999);
        expect(secondAttached).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await second;

        expect(initSessions).toHaveLength(1);
    });

    it('sends it again for a payment attached once the first has answered', async () => {
        await sdk.attachPayment({ paymentId: 'pay-A', paymentSecret: 'sec' });
        await sdk.attachPayment({ paymentId: 'pay-A', paymentSecret: 'sec' });

        expect(initSessions).toHaveLength(2);
    });

    // An id that cannot be a path segment fails the attach as it always did:
    // at once, with nothing sent to the payment.
    it('sends nothing for a payment id the attach rejects', async () => {
        await expect(
            sdk.attachPayment({ paymentId: '..', paymentSecret: 'sec' }),
        ).rejects.toMatchObject({
            errorCode: GoPayErrorCodes.INVALID_ARGUMENT,
        });
        await settle();

        expect(initSessions).toHaveLength(0);
        expect(sdk.isAuthenticated()).toBe(false);
    });

    // The wait is long enough for the page to attach another payment in.
    it('rejects an attach that a later one overtook while it waited', async () => {
        let answerA!: () => void;
        const answeredA = new Promise<void>((resolve) => {
            answerA = resolve;
        });
        initSessionReply = async () => {
            if (initSessions.length === 1) {
                await answeredA;
            }
            return new Response(null, { status: 204 });
        };

        const first = sdk.attachPayment({
            paymentId: 'pay-A',
            paymentSecret: 'sec',
        });
        await settle();
        await sdk.attachPayment({ paymentId: 'pay-B', paymentSecret: 'sec' });
        answerA();

        await expect(first).rejects.toMatchObject({
            errorCode: GoPayErrorCodes.PAYMENT_NOT_ATTACHED,
        });
        // pay-B stays the attached payment.
        await sdk.getChargeState();
        expect(lastPaymentPath).toBe('/payments/pay-B/charge');
    });

    it.each([
        ['409, payment past CREATED', () => makeResponse({ errors: [] }, 409)],
        ['500', () => makeResponse({ errors: [] }, 500)],
        [
            'network error',
            () => Promise.reject(new TypeError('Failed to fetch')),
        ],
    ] as Array<[string, InitSessionReply]>)(
        'keeps a failure (%s) away from the attach and from onError',
        async (_name, reply) => {
            initSessionReply = reply;

            await expect(
                sdk.attachPayment({ paymentId: 'pay-A', paymentSecret: 'sec' }),
            ).resolves.toBeUndefined();
            await settle();
            await expect(sdk.getStatus()).resolves.toMatchObject({
                state: 'CREATED',
            });

            expect(initSessions).toHaveLength(1);
            expect(onError).not.toHaveBeenCalled();
        },
    );

    // A 401 recovered the usual way would exchange the credentials again and,
    // on a second 401, drop the payment's token — the checkout's own calls
    // would then pay for a request they never needed.
    it('leaves the payment token alone when init-session answers 401', async () => {
        initSessionReply = () => makeResponse({ errors: [] }, 401);

        await sdk.attachPayment({ paymentId: 'pay-A', paymentSecret: 'sec' });
        await settle();
        await expect(sdk.getStatus()).resolves.toMatchObject({
            state: 'CREATED',
        });

        expect(initSessions).toHaveLength(1);
        expect(tokenExchanges).toBe(1);
        expect(sdk.isAuthenticated()).toBe(true);
        expect(onError).not.toHaveBeenCalled();
    });

    // What init-session.ts promises in place of onError: the failure is not
    // reported to the integrator, but GoPay's own operational data still has it.
    it.each([409, 500])(
        'records a failed init-session (%i) in telemetry with its status',
        async (status) => {
            initSessionReply = () => makeResponse({ errors: [] }, status);

            // Numeric, as real ids are: the event's target is the template.
            await sdk.attachPayment({
                paymentId: '3000000001',
                paymentSecret: 'sec',
            });
            await settle();

            const events = await Promise.all(
                logged.map(
                    async (req) =>
                        (
                            (await req.clone().json()) as {
                                event: Record<string, unknown>;
                            }
                        ).event,
                ),
            );
            const initSessionCalls = events.filter(
                (event) =>
                    event.event_type === 'api_call' &&
                    event.target === '/payments/{id}/init-session',
            );
            expect(initSessionCalls).toHaveLength(1);
            expect(initSessionCalls[0].status_code).toBe(status);
            expect(onError).not.toHaveBeenCalled();
        },
    );

    it('opens a session for each payment attached', async () => {
        await sdk.attachPayment({ paymentId: 'pay-A', paymentSecret: 'sec' });
        await sdk.attachPayment({ paymentId: 'pay-B', paymentSecret: 'sec' });
        await settle();

        expect(initSessions.map((r) => new URL(r.url).pathname)).toEqual([
            '/payments/pay-A/init-session',
            '/payments/pay-B/init-session',
        ]);
    });

    it('sends nothing for an attach a later one overtook', async () => {
        let releaseA!: () => void;
        tokenHolds.set(
            'pay-A',
            new Promise<void>((resolve) => {
                releaseA = resolve;
            }),
        );

        const first = sdk.attachPayment({
            paymentId: 'pay-A',
            paymentSecret: 'sec',
        });
        await sdk.attachPayment({ paymentId: 'pay-B', paymentSecret: 'sec' });
        releaseA();
        await expect(first).rejects.toMatchObject({
            errorCode: GoPayErrorCodes.PAYMENT_NOT_ATTACHED,
        });
        await settle();

        expect(initSessions.map((r) => new URL(r.url).pathname)).toEqual([
            '/payments/pay-B/init-session',
        ]);
    });
});
