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
 * The payment-scoped token lives fifteen minutes and the grant issues no
 * refresh token, so the SDK keeps the attached payment's credentials and
 * exchanges them again. These go through the public SDK rather than the auth
 * handler alone: what broke was the handover between attachPayment() and the
 * client's refresh, which neither half shows on its own.
 */

const T0 = new Date('2026-10-07T10:00:00Z');
const JUST_BEFORE_EXPIRY = new Date('2026-10-07T10:14:45Z');

const makeResponse = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
    });

type Seen = { url: string; auth: string | null; body: string };

const last = (calls: Seen[]): Seen | undefined => calls[calls.length - 1];

const basic = (id: string, secret: string) =>
    `Basic ${btoa(`${id}:${secret}`)}`;

describe('payment token re-acquisition', () => {
    let seen: Seen[];
    let tokenResponses: Array<() => Response | Promise<Response>>;
    let paymentStatus: number[];
    let paymentHolds: Array<Promise<void>>;
    let rejected: Set<string>;
    // Which payment each issued token belongs to. The gateway rejects a token
    // used for another payment, which is what turns a request sent with the
    // wrong payment's token into a 401 instead of a silent success.
    let tokenOwner: Map<string, string>;
    let issued: number;
    let onError: Mock<(error: unknown) => void>;
    let sdk: ReturnType<typeof createGoPayBrowserSDK>;

    const tokenCalls = () =>
        seen.filter((r) => r.url.includes('/oauth2/token'));
    const paymentCalls = () => seen.filter((r) => r.url.includes('/payments/'));

    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(T0);
        seen = [];
        tokenResponses = [];
        paymentStatus = [];
        paymentHolds = [];
        rejected = new Set();
        tokenOwner = new Map();
        issued = 0;
        vi.stubGlobal(
            'fetch',
            vi.fn(async (req: Request) => {
                // Recorded before the first await, so the order of `seen` is
                // the order the SDK issued the requests in.
                const entry: Seen = {
                    url: req.url,
                    auth: req.headers.get('Authorization'),
                    body: '',
                };
                seen.push(entry);
                entry.body = await req.clone().text();
                if (req.url.includes('/oauth2/token')) {
                    const owner = atob(
                        (entry.auth ?? '').replace('Basic ', ''),
                    ).split(':')[0];
                    const next = tokenResponses.shift();
                    let res: Response;
                    if (next) {
                        res = await next();
                    } else {
                        issued += 1;
                        res = makeResponse({
                            access_token: `jwt-${issued}`,
                            expires_in: 900,
                            token_type: 'bearer',
                        });
                    }
                    const body = (await res
                        .clone()
                        .json()
                        .catch(() => ({}))) as { access_token?: string };
                    if (body.access_token) {
                        tokenOwner.set(body.access_token, owner);
                    }
                    return res;
                }
                if (req.url.includes('/payments/')) {
                    const hold = paymentHolds.shift();
                    if (hold) {
                        await hold;
                    }
                    const auth = req.headers.get('Authorization') ?? '';
                    const owner = tokenOwner.get(auth.replace('Bearer ', ''));
                    const status =
                        rejected.has(auth) ||
                        auth.startsWith('Basic ') ||
                        (owner !== undefined &&
                            !req.url.includes(`/payments/${owner}`))
                            ? 401
                            : (paymentStatus.shift() ?? 200);
                    return status === 200
                        ? makeResponse({ id: 'pay-A', state: 'CREATED' })
                        : makeResponse({ error: 'unauthorized' }, status);
                }
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

    it('exchanges the payment credentials again when the token is about to expire', async () => {
        await sdk.attachPayment({ paymentId: 'pay-A', paymentSecret: 'sec-A' });
        vi.setSystemTime(JUST_BEFORE_EXPIRY);

        await expect(sdk.getStatus()).resolves.toMatchObject({ id: 'pay-A' });

        expect(tokenCalls()).toHaveLength(2);
        const again = tokenCalls()[1];
        expect(again.auth).toBe(basic('pay-A', 'sec-A'));
        const form = new URLSearchParams(again.body);
        expect(form.get('grant_type')).toBe('payment_credentials');
        expect(form.get('scope')).toBe('payment:read payment:charge');
        expect(last(paymentCalls())?.auth).toBe('Bearer jwt-2');
        expect(sdk.isAuthenticated()).toBe(true);
        expect(onError).not.toHaveBeenCalled();
    });

    it('stays authenticated across several token lifetimes', async () => {
        await sdk.attachPayment({ paymentId: 'pay-A', paymentSecret: 'sec-A' });

        for (let minute = 15; minute <= 60; minute += 15) {
            vi.setSystemTime(new Date(T0.getTime() + minute * 60_000));
            await sdk.getStatus();
        }

        expect(tokenCalls()).toHaveLength(5);
        expect(last(paymentCalls())?.auth).toBe('Bearer jwt-5');
        expect(onError).not.toHaveBeenCalled();
    });

    it('shares one exchange between calls that find the token expired together', async () => {
        await sdk.attachPayment({ paymentId: 'pay-A', paymentSecret: 'sec-A' });
        vi.setSystemTime(JUST_BEFORE_EXPIRY);

        await Promise.all([sdk.getStatus(), sdk.getStatus(), sdk.getStatus()]);

        expect(tokenCalls()).toHaveLength(2);
        expect(
            paymentCalls().every(
                (r, i) => i === 0 || r.auth === 'Bearer jwt-2',
            ),
        ).toBe(true);
    });

    it('re-exchanges once and retries when a token is rejected before it expires', async () => {
        await sdk.attachPayment({ paymentId: 'pay-A', paymentSecret: 'sec-A' });
        paymentStatus.push(401);

        await expect(sdk.getStatus()).resolves.toMatchObject({ id: 'pay-A' });

        expect(tokenCalls()).toHaveLength(2);
        expect(tokenCalls()[1].auth).toBe(basic('pay-A', 'sec-A'));
        expect(paymentCalls().map((r) => r.auth)).toEqual([
            'Bearer jwt-1',
            'Bearer jwt-2',
        ]);
    });

    it('gives up with AUTH_UNAUTHORIZED when the fresh token is rejected too', async () => {
        await sdk.attachPayment({ paymentId: 'pay-A', paymentSecret: 'sec-A' });
        paymentStatus.push(401, 401);

        await expect(sdk.getStatus()).rejects.toMatchObject({
            errorCode: GoPayErrorCodes.AUTH_UNAUTHORIZED,
        });
        expect(tokenCalls()).toHaveLength(2);

        // Giving up costs the token, not the client id or the payment.
        await sdk.getBrowserData().catch(() => {});
        expect(
            seen.find((r) => r.url.includes('/cards/browser-data'))?.auth,
        ).toBe(basic('cid_test', 'pk_test'));
        await expect(sdk.getStatus()).resolves.toMatchObject({ id: 'pay-A' });
        expect(last(tokenCalls())?.auth).toBe(basic('pay-A', 'sec-A'));
    });

    it('leaves nothing of the previous payment behind when attaching another one fails', async () => {
        await sdk.attachPayment({ paymentId: 'pay-A', paymentSecret: 'sec-A' });
        tokenResponses.push(() => makeResponse({ error: 'unauthorized' }, 401));

        await expect(
            sdk.attachPayment({ paymentId: 'pay-B', paymentSecret: 'wrong' }),
        ).rejects.toBeDefined();

        expect(sdk.isAuthenticated()).toBe(false);
        await expect(sdk.getStatus()).rejects.toMatchObject({
            errorCode: GoPayErrorCodes.PAYMENT_NOT_ATTACHED,
        });
        await sdk.getBrowserData().catch(() => {});
        expect(
            seen.find((r) => r.url.includes('/cards/browser-data'))?.auth,
        ).toBe(basic('cid_test', 'pk_test'));
        expect(tokenCalls()).toHaveLength(2);
    });

    it('keeps the client id when a re-exchange fails, and retries on the next call', async () => {
        await sdk.attachPayment({ paymentId: 'pay-A', paymentSecret: 'sec-A' });
        vi.setSystemTime(JUST_BEFORE_EXPIRY);
        tokenResponses.push(() => makeResponse({ error: 'unavailable' }, 503));

        await expect(sdk.getStatus()).rejects.toMatchObject({
            errorCode: GoPayErrorCodes.AUTH_REFRESH_FAILED,
        });
        // Still attached: the next call obtains another token on its own, so
        // an integrator acting on isAuthenticated() must not re-attach.
        expect(sdk.isAuthenticated()).toBe(true);

        // The shareable-key calls still identify the merchant…
        await sdk.getBrowserData().catch(() => {});
        expect(
            seen.find((r) => r.url.includes('/cards/browser-data'))?.auth,
        ).toBe(basic('cid_test', 'pk_test'));

        // …and the payment recovers without a fresh attachPayment().
        await expect(sdk.getStatus()).resolves.toMatchObject({ id: 'pay-A' });
        expect(last(paymentCalls())?.auth).toBe('Bearer jwt-2');
        expect(sdk.isAuthenticated()).toBe(true);
    });

    it('does not let a re-exchange for the previous payment overwrite the token of the one attached since', async () => {
        await sdk.attachPayment({ paymentId: 'pay-A', paymentSecret: 'sec-A' });
        vi.setSystemTime(JUST_BEFORE_EXPIRY);

        let releaseStale!: () => void;
        tokenResponses.push(
            () =>
                new Promise<Response>((resolve) => {
                    releaseStale = () =>
                        resolve(
                            makeResponse({
                                access_token: 'jwt-stale-A',
                                expires_in: 900,
                                token_type: 'bearer',
                            }),
                        );
                }),
        );
        const staleCall = sdk.getStatus().catch(() => {});
        await vi.waitFor(() => expect(tokenCalls()).toHaveLength(2));

        await sdk.attachPayment({ paymentId: 'pay-B', paymentSecret: 'sec-B' });
        releaseStale();
        await staleCall;

        await sdk.getStatus();
        const latest = last(paymentCalls());
        expect(latest?.url).toContain('/payments/pay-B');
        expect(latest?.auth).toBe('Bearer jwt-2');
        expect(last(tokenCalls())?.auth).toBe(basic('pay-B', 'sec-B'));
    });

    it('re-exchanges the newly attached payment, not the previous one', async () => {
        await sdk.attachPayment({ paymentId: 'pay-A', paymentSecret: 'sec-A' });
        await sdk.attachPayment({ paymentId: 'pay-B', paymentSecret: 'sec-B' });
        vi.setSystemTime(JUST_BEFORE_EXPIRY);

        await sdk.getStatus();

        expect(last(tokenCalls())?.auth).toBe(basic('pay-B', 'sec-B'));
    });

    it('lets the attach called last win when an earlier one answers after it', async () => {
        let releaseA!: () => void;
        tokenResponses.push(
            () =>
                new Promise<Response>((resolve) => {
                    releaseA = () =>
                        resolve(
                            makeResponse({
                                access_token: 'jwt-late-A',
                                expires_in: 900,
                                token_type: 'bearer',
                            }),
                        );
                }),
        );
        const attachA = sdk.attachPayment({
            paymentId: 'pay-A',
            paymentSecret: 'sec-A',
        });
        await vi.waitFor(() => expect(tokenCalls()).toHaveLength(1));
        await sdk.attachPayment({ paymentId: 'pay-B', paymentSecret: 'sec-B' });
        releaseA();
        // Not a success: the caller would go on to charge a payment it did
        // not attach.
        await expect(attachA).rejects.toMatchObject({
            errorCode: GoPayErrorCodes.PAYMENT_NOT_ATTACHED,
        });

        await sdk.getStatus();
        const latest = last(paymentCalls());
        expect(latest?.url).toContain('/payments/pay-B');
        expect(latest?.auth).toBe('Bearer jwt-1');

        vi.setSystemTime(JUST_BEFORE_EXPIRY);
        await sdk.getStatus();
        expect(last(tokenCalls())?.auth).toBe(basic('pay-B', 'sec-B'));
    });

    it('keeps the later attach when the one it overtook fails afterwards', async () => {
        let failA!: () => void;
        tokenResponses.push(
            () =>
                new Promise<Response>((resolve) => {
                    failA = () =>
                        resolve(makeResponse({ error: 'unauthorized' }, 401));
                }),
        );
        const attachA = sdk
            .attachPayment({ paymentId: 'pay-A', paymentSecret: 'wrong' })
            .then(
                () => 'resolved',
                () => 'rejected',
            );
        await vi.waitFor(() => expect(tokenCalls()).toHaveLength(1));
        await sdk.attachPayment({ paymentId: 'pay-B', paymentSecret: 'sec-B' });
        failA();
        expect(await attachA).toBe('rejected');

        await sdk.getStatus();
        expect(sdk.isAuthenticated()).toBe(true);
        expect(last(paymentCalls())?.url).toContain('/payments/pay-B');
        // The status call's event still carries B's session.
        await vi.waitFor(() => {
            const statusEvent = last(
                seen.filter(
                    (r) =>
                        r.url.endsWith('/events') &&
                        r.body.includes('"target":"/payments/'),
                ),
            );
            expect(statusEvent?.body).toContain('"payment_session_id":"pay-B"');
        });
    });

    it("refreshes the newly attached payment on its own while the previous payment's refresh is pending", async () => {
        await sdk.attachPayment({ paymentId: 'pay-A', paymentSecret: 'sec-A' });
        vi.setSystemTime(JUST_BEFORE_EXPIRY);
        let releaseA!: () => void;
        tokenResponses.push(
            () =>
                new Promise<Response>((resolve) => {
                    releaseA = () =>
                        resolve(
                            makeResponse({
                                access_token: 'jwt-stale-A',
                                expires_in: 900,
                                token_type: 'bearer',
                            }),
                        );
                }),
        );
        const staleCall = sdk.getStatus().catch(() => {});
        await vi.waitFor(() => expect(tokenCalls()).toHaveLength(2));
        await sdk.attachPayment({ paymentId: 'pay-B', paymentSecret: 'sec-B' });

        // B's token gets rejected while A's refresh is still out.
        rejected.add('Bearer jwt-2');
        const callB = sdk.getStatus();
        await vi.waitFor(() =>
            expect(
                paymentCalls().some((r) => r.url.includes('/payments/pay-B')),
            ).toBe(true),
        );
        releaseA();
        await staleCall;

        await expect(callB).resolves.toBeDefined();
        const callsB = paymentCalls().filter((r) =>
            r.url.includes('/payments/pay-B'),
        );
        expect(last(callsB)?.auth).toBe('Bearer jwt-3');
        expect(
            tokenCalls().filter((r) => r.auth === basic('pay-B', 'sec-B')),
        ).toHaveLength(2);
    });

    it('forgets the credentials on logout()', async () => {
        await sdk.attachPayment({ paymentId: 'pay-A', paymentSecret: 'sec-A' });
        sdk.logout();
        vi.setSystemTime(JUST_BEFORE_EXPIRY);

        await expect(sdk.getStatus()).rejects.toMatchObject({
            errorCode: GoPayErrorCodes.PAYMENT_NOT_ATTACHED,
        });

        expect(tokenCalls()).toHaveLength(1);
        expect(sdk.isAuthenticated()).toBe(false);
    });

    it('does not let an attach pending across logout() restore the session', async () => {
        let releaseA!: () => void;
        tokenResponses.push(
            () =>
                new Promise<Response>((resolve) => {
                    releaseA = () =>
                        resolve(
                            makeResponse({
                                access_token: 'jwt-late-A',
                                expires_in: 900,
                                token_type: 'bearer',
                            }),
                        );
                }),
        );
        const attachA = sdk.attachPayment({
            paymentId: 'pay-A',
            paymentSecret: 'sec-A',
        });
        await vi.waitFor(() => expect(tokenCalls()).toHaveLength(1));
        sdk.logout();
        releaseA();

        await expect(attachA).rejects.toMatchObject({
            errorCode: GoPayErrorCodes.PAYMENT_NOT_ATTACHED,
        });
        expect(sdk.isAuthenticated()).toBe(false);
        await expect(sdk.getStatus()).rejects.toMatchObject({
            errorCode: GoPayErrorCodes.PAYMENT_NOT_ATTACHED,
        });
        vi.setSystemTime(JUST_BEFORE_EXPIRY);
        await sdk.getStatus().catch(() => {});
        expect(tokenCalls()).toHaveLength(1);
    });

    it('rejects a request whose refresh a later attach discarded, instead of sending it with the new token', async () => {
        await sdk.attachPayment({ paymentId: 'pay-A', paymentSecret: 'sec-A' });
        vi.setSystemTime(JUST_BEFORE_EXPIRY);
        let releaseA!: () => void;
        tokenResponses.push(
            () =>
                new Promise<Response>((resolve) => {
                    releaseA = () =>
                        resolve(
                            makeResponse({
                                access_token: 'jwt-stale-A',
                                expires_in: 900,
                                token_type: 'bearer',
                            }),
                        );
                }),
        );
        const callA = sdk.getStatus();
        await vi.waitFor(() => expect(tokenCalls()).toHaveLength(2));
        await sdk.attachPayment({ paymentId: 'pay-B', paymentSecret: 'sec-B' });
        releaseA();

        await expect(callA).rejects.toMatchObject({
            errorCode: GoPayErrorCodes.PAYMENT_NOT_ATTACHED,
        });
        // A's request never went out on B's token, so B keeps it.
        expect(
            paymentCalls().filter((r) => r.auth === 'Bearer jwt-2'),
        ).toHaveLength(0);
        expect(sdk.isAuthenticated()).toBe(true);
        await expect(sdk.getStatus()).resolves.toBeDefined();
        expect(last(paymentCalls())?.url).toContain('/payments/pay-B');
        expect(last(paymentCalls())?.auth).toBe('Bearer jwt-2');
        expect(tokenCalls()).toHaveLength(3);
        const codes = onError.mock.calls.map(
            ([e]) => (e as { errorCode?: string }).errorCode,
        );
        expect(codes).not.toContain(GoPayErrorCodes.AUTH_UNAUTHORIZED);
    });

    it('keeps the later payment when the discarded re-exchange fails, and does not report it as a failed refresh', async () => {
        await sdk.attachPayment({ paymentId: 'pay-A', paymentSecret: 'sec-A' });
        vi.setSystemTime(JUST_BEFORE_EXPIRY);
        let failA!: () => void;
        tokenResponses.push(
            () =>
                new Promise<Response>((resolve) => {
                    failA = () =>
                        resolve(makeResponse({ error: 'unavailable' }, 503));
                }),
        );
        const callA = sdk.getStatus();
        await vi.waitFor(() => expect(tokenCalls()).toHaveLength(2));
        await sdk.attachPayment({ paymentId: 'pay-B', paymentSecret: 'sec-B' });
        failA();

        await expect(callA).rejects.toMatchObject({
            errorCode: GoPayErrorCodes.PAYMENT_NOT_ATTACHED,
        });
        expect(sdk.isAuthenticated()).toBe(true);
        await expect(sdk.getStatus()).resolves.toBeDefined();
        expect(last(paymentCalls())?.auth).toBe('Bearer jwt-2');
        expect(tokenCalls()).toHaveLength(3);
        const codes = onError.mock.calls.map(
            ([e]) => (e as { errorCode?: string }).errorCode,
        );
        expect(codes).not.toContain(GoPayErrorCodes.AUTH_REFRESH_FAILED);
    });

    it('does not refresh the later payment for a 401 on a request sent before it was attached', async () => {
        await sdk.attachPayment({ paymentId: 'pay-A', paymentSecret: 'sec-A' });
        let releaseA!: () => void;
        paymentHolds.push(
            new Promise<void>((resolve) => {
                releaseA = resolve;
            }),
        );
        paymentStatus.push(401);
        const callA = sdk.getStatus();
        await vi.waitFor(() => expect(paymentCalls()).toHaveLength(1));
        await sdk.attachPayment({ paymentId: 'pay-B', paymentSecret: 'sec-B' });
        releaseA();

        await expect(callA).rejects.toMatchObject({
            errorCode: GoPayErrorCodes.PAYMENT_NOT_ATTACHED,
        });
        expect(tokenCalls()).toHaveLength(2);
        expect(paymentCalls()).toHaveLength(1);
        await expect(sdk.getStatus()).resolves.toBeDefined();
        expect(last(paymentCalls())?.auth).toBe('Bearer jwt-2');
    });

    it('does not cost the later payment its token when the retry for the previous one is rejected', async () => {
        await sdk.attachPayment({ paymentId: 'pay-A', paymentSecret: 'sec-A' });
        let releaseRetry!: () => void;
        paymentHolds.push(
            Promise.resolve(),
            new Promise<void>((resolve) => {
                releaseRetry = resolve;
            }),
        );
        paymentStatus.push(401, 401);
        const callA = sdk.getStatus();
        await vi.waitFor(() => expect(paymentCalls()).toHaveLength(2));
        await sdk.attachPayment({ paymentId: 'pay-B', paymentSecret: 'sec-B' });
        releaseRetry();

        await expect(callA).rejects.toMatchObject({
            errorCode: GoPayErrorCodes.PAYMENT_NOT_ATTACHED,
        });
        expect(sdk.isAuthenticated()).toBe(true);
        await expect(sdk.getStatus()).resolves.toBeDefined();
        expect(last(paymentCalls())?.url).toContain('/payments/pay-B');
        expect(last(paymentCalls())?.auth).toBe('Bearer jwt-3');
        const codes = onError.mock.calls.map(
            ([e]) => (e as { errorCode?: string }).errorCode,
        );
        expect(codes).not.toContain(GoPayErrorCodes.AUTH_UNAUTHORIZED);
    });

    it('forgets payment credentials the token endpoint refuses for good, instead of resending them with every call', async () => {
        await sdk.attachPayment({ paymentId: 'pay-A', paymentSecret: 'sec-A' });
        vi.setSystemTime(JUST_BEFORE_EXPIRY);
        tokenResponses.push(() =>
            makeResponse(
                { error: 'Invalid payment_id or payment_secret' },
                401,
            ),
        );

        await expect(sdk.getStatus()).rejects.toMatchObject({
            errorCode: GoPayErrorCodes.AUTH_REFRESH_FAILED,
        });
        expect(sdk.isAuthenticated()).toBe(false);

        await sdk.getStatus().catch(() => {});
        await sdk.getStatus().catch(() => {});
        expect(tokenCalls()).toHaveLength(2);
        const refreshFailures = onError.mock.calls.filter(
            ([e]) =>
                (e as { errorCode?: string }).errorCode ===
                GoPayErrorCodes.AUTH_REFRESH_FAILED,
        );
        expect(refreshFailures).toHaveLength(1);
    });

    it('treats a rate-limited re-exchange as temporary and retries with the same credentials', async () => {
        await sdk.attachPayment({ paymentId: 'pay-A', paymentSecret: 'sec-A' });
        vi.setSystemTime(JUST_BEFORE_EXPIRY);
        tokenResponses.push(() => makeResponse({ error: 'slow down' }, 429));

        await expect(sdk.getStatus()).rejects.toMatchObject({
            errorCode: GoPayErrorCodes.AUTH_REFRESH_FAILED,
        });
        expect(sdk.isAuthenticated()).toBe(true);
        await expect(sdk.getStatus()).resolves.toBeDefined();
        expect(last(tokenCalls())?.auth).toBe(basic('pay-A', 'sec-A'));
    });

    it('never puts the payment secret anywhere but the token request', async () => {
        await sdk.attachPayment({ paymentId: 'pay-A', paymentSecret: 'sec-A' });
        vi.setSystemTime(JUST_BEFORE_EXPIRY);
        tokenResponses.push(() => makeResponse({ error: 'unavailable' }, 503));
        await sdk.getStatus().catch(() => {});
        await sdk.getStatus();

        const encoded = btoa('pay-A:sec-A');
        const elsewhere = seen.filter((r) => !r.url.includes('/oauth2/token'));
        expect(elsewhere.length).toBeGreaterThan(0);
        for (const r of elsewhere) {
            expect(`${r.url} ${r.auth} ${r.body}`).not.toContain('sec-A');
            expect(`${r.url} ${r.auth} ${r.body}`).not.toContain(encoded);
        }
        for (const [error] of onError.mock.calls) {
            expect(JSON.stringify(error)).not.toContain('sec-A');
            expect(String((error as Error).message)).not.toContain('sec-A');
        }
    });
});
