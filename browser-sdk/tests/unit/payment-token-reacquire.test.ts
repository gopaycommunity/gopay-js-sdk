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
    let rejected: Set<string>;
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
        rejected = new Set();
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
                    const next = tokenResponses.shift();
                    if (next) {
                        return next();
                    }
                    issued += 1;
                    return makeResponse({
                        access_token: `jwt-${issued}`,
                        expires_in: 900,
                        token_type: 'bearer',
                    });
                }
                if (req.url.includes('/payments/')) {
                    const auth = req.headers.get('Authorization') ?? '';
                    const status = rejected.has(auth)
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
        expect(sdk.isAuthenticated()).toBe(false);

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
        await attachA;

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

        await sdk.getStatus().catch(() => {});

        expect(tokenCalls()).toHaveLength(1);
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
