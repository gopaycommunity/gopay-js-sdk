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
 * POST /payments/{id}/init-session. Nothing depends on it, so it must never
 * cost the checkout anything: the attach does not wait for it, and its failure
 * — a 409 is routine on a return page, the payment is past CREATED there —
 * neither rejects anything nor reaches the integrator's onError.
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
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    /** Let the unawaited init-session go out and settle. */
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

    it('does not hold up the attach', async () => {
        initSessionReply = () => new Promise<Response>(() => {});

        await sdk.attachPayment({ paymentId: 'pay-A', paymentSecret: 'sec' });
        await expect(sdk.getStatus()).resolves.toMatchObject({
            state: 'CREATED',
        });
        await settle();
        expect(initSessions).toHaveLength(1);
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
