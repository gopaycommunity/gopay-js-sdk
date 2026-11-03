import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    createGoPaySDK,
    GoPayErrorCodes,
    GoPayHTTPError,
    GoPaySDKError,
    SDK_VERSION,
} from '../../src/index.js';
import { makeResponse } from './helpers.js';

const BASE_URL = 'https://gw.example.com/gp-gw/api/4.0';
const UUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PAYMENT_ID = '3000000001';

const isToken = (req: Request) =>
    new URL(req.url).pathname.endsWith('/oauth2/token');
const tokenResponse = (expiresIn = 900) =>
    makeResponse({
        token_type: 'bearer',
        access_token: 'at-abc',
        expires_in: expiresIn,
    });

describe('User-Agent and correlation headers', () => {
    let requests: Request[];
    let fetchMock: ReturnType<typeof vi.fn>;
    let tokenExpiresIn: number;

    beforeEach(() => {
        requests = [];
        tokenExpiresIn = 900;
        fetchMock = vi.fn(async (req: Request) => {
            requests.push(req);
            return isToken(req)
                ? tokenResponse(tokenExpiresIn)
                : makeResponse({ id: PAYMENT_ID, state: 'CREATED' });
        });
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    async function authenticated(
        config: Parameters<typeof createGoPaySDK>[0] = {},
    ) {
        const sdk = createGoPaySDK({ baseUrl: BASE_URL, ...config });
        await sdk.authenticate({
            grant_type: 'client_credentials',
            client_id: 'client',
            client_secret: 'secret',
            scope: 'payment:read',
        });
        return sdk;
    }

    const header = (req: Request | undefined, name: string) =>
        req?.headers.get(name) ?? null;
    const apiRequests = () => requests.filter((req) => !isToken(req));

    describe('User-Agent', () => {
        it('names the SDK on the token call and on API calls', async () => {
            const sdk = await authenticated();
            await sdk.getPaymentStatus(PAYMENT_ID);

            expect(requests.map((req) => header(req, 'User-Agent'))).toEqual([
                `GoPay JS v4 ${SDK_VERSION}`,
                `GoPay JS v4 ${SDK_VERSION}`,
            ]);
        });

        it('appends the integration suffix after the SDK, never instead of it', async () => {
            const sdk = await authenticated({
                userAgentSuffix: '  my-shop/2.1 ',
            });
            await sdk.getPaymentStatus(PAYMENT_ID);

            expect(header(apiRequests()[0], 'User-Agent')).toBe(
                `GoPay JS v4 ${SDK_VERSION} my-shop/2.1`,
            );
        });

        it.each([
            ['empty', ''],
            ['a line break', 'shop\r\nX-Injected: 1'],
            ['non-ASCII', 'obchod-č'],
        ])('refuses a suffix that is %s', (_name, userAgentSuffix) => {
            expect(() =>
                createGoPaySDK({ baseUrl: BASE_URL, userAgentSuffix }),
            ).toThrow(
                expect.objectContaining({
                    errorCode: GoPayErrorCodes.INVALID_CONFIG,
                }),
            );
        });
    });

    it('sends none of them when the SDK runs in a page', async () => {
        vi.stubGlobal('document', {});
        const sdk = await authenticated({ userAgentSuffix: 'example' });
        await sdk.getPaymentStatus(PAYMENT_ID);

        for (const req of requests) {
            for (const name of [
                'X-GoPay-Trace-Id',
                'X-GoPay-Transaction-Id',
                'X-GoPay-Payment-Session-Id',
                'User-Agent',
            ]) {
                expect(header(req, name)).toBeNull();
            }
        }
    });

    describe('X-GoPay-Trace-Id', () => {
        it('is a fresh UUID on every request', async () => {
            const sdk = await authenticated();
            await sdk.getPaymentStatus(PAYMENT_ID);
            await sdk.getPaymentStatus(PAYMENT_ID);

            const ids = requests.map((req) => header(req, 'X-GoPay-Trace-Id'));
            expect(ids.every((id) => UUID.test(id ?? ''))).toBe(true);
            expect(new Set(ids).size).toBe(3);
        });

        it('stays the same on a retry of the same request', async () => {
            const sdk = await authenticated();
            fetchMock.mockImplementationOnce(async (req: Request) => {
                requests.push(req);
                return makeResponse({}, 503);
            });
            await sdk.getPaymentStatus(PAYMENT_ID);

            const [first, retry] = apiRequests();
            expect(retry).toBeDefined();
            expect(header(retry, 'X-GoPay-Trace-Id')).toBe(
                header(first, 'X-GoPay-Trace-Id'),
            );
        });
    });

    describe('X-GoPay-Transaction-Id', () => {
        it('is shared by an SDK call and the token refresh it makes, and new for the next call', async () => {
            tokenExpiresIn = 1; // expiring at once, so the next call refreshes first
            const sdk = await authenticated();
            await sdk.getPaymentStatus(PAYMENT_ID);

            const [authenticate, refresh, call] = requests;
            expect(refresh && isToken(refresh)).toBe(true);
            expect(header(refresh, 'X-GoPay-Transaction-Id')).toBe(
                header(call, 'X-GoPay-Transaction-Id'),
            );
            expect(header(authenticate, 'X-GoPay-Transaction-Id')).not.toBe(
                header(call, 'X-GoPay-Transaction-Id'),
            );
        });

        it('differs between calls running at the same time', async () => {
            const sdk = await authenticated();
            await Promise.all([
                sdk.getPaymentStatus(PAYMENT_ID),
                sdk.getPaymentStatus(PAYMENT_ID),
            ]);

            const [a, b] = apiRequests().map((req) =>
                header(req, 'X-GoPay-Transaction-Id'),
            );
            expect(a).not.toBe(b);
        });

        it('stays the same across the pages of iterateEvents', async () => {
            const sdk = await authenticated();
            fetchMock
                .mockImplementationOnce(async (req: Request) => {
                    requests.push(req);
                    return makeResponse({
                        items: [],
                        next_page_url: `${BASE_URL}/eshops/1/events?prev_item=e1`,
                    });
                })
                .mockImplementationOnce(async (req: Request) => {
                    requests.push(req);
                    return makeResponse({ items: [] });
                });

            for await (const _ of sdk.iterateEvents('1')) {
                // drain
            }

            const [page1, page2] = apiRequests().map((req) =>
                header(req, 'X-GoPay-Transaction-Id'),
            );
            expect(page2).toBeTruthy();
            expect(page2).toBe(page1);
        });

        it('is the caller’s own inside withTransactionId', async () => {
            const sdk = await authenticated();
            await sdk.withTransactionId('order-42.A_b', async () => {
                await sdk.getPaymentStatus(PAYMENT_ID);
                await sdk.getPaymentStatus(PAYMENT_ID);
            });

            expect(
                apiRequests().map((req) =>
                    header(req, 'X-GoPay-Transaction-Id'),
                ),
            ).toEqual(['order-42.A_b', 'order-42.A_b']);
        });

        it.each([
            ['empty', ''],
            ['with a space', 'order 42'],
            ['longer than 64', 'x'.repeat(65)],
        ])(
            'refuses a transaction id that is %s, sending nothing',
            async (_name, id) => {
                const sdk = await authenticated();
                const sent = requests.length;

                expect(() =>
                    sdk.withTransactionId(id, () =>
                        sdk.getPaymentStatus(PAYMENT_ID),
                    ),
                ).toThrow(
                    expect.objectContaining({
                        errorCode: GoPayErrorCodes.INVALID_ARGUMENT,
                    }),
                );
                expect(requests).toHaveLength(sent);
            },
        );
    });

    describe('X-GoPay-Payment-Session-Id', () => {
        it('names the payment of a payment-scoped request, and only there', async () => {
            const sdk = await authenticated();
            await sdk.getPaymentStatus(PAYMENT_ID);
            await sdk.createPayment('8123456789', {
                amount: 100,
                currency: 'CZK',
                order_number: 'o-1',
                customer: { email: 'a@example.com' },
                callback: { return_url: 'https://example.com/r' },
            });

            const [token, status, create] = requests;
            expect(header(status, 'X-GoPay-Payment-Session-Id')).toBe(
                PAYMENT_ID,
            );
            expect(header(create, 'X-GoPay-Payment-Session-Id')).toBeNull();
            expect(header(token, 'X-GoPay-Payment-Session-Id')).toBeNull();
        });
    });

    describe('ids on errors', () => {
        async function failingCall(response: () => Promise<Response>) {
            const onError = vi.fn((error: GoPaySDKError | GoPayHTTPError) => ({
                ...error,
            }));
            const sdk = await authenticated({
                onError,
                requestTimeoutMs: 1_000,
            });
            fetchMock.mockImplementation(async (req: Request) => {
                requests.push(req);
                return response();
            });
            const error = await sdk
                .getPaymentStatus(PAYMENT_ID)
                .catch((reason: unknown) => reason);
            const sent = apiRequests();
            const request = sent[sent.length - 1];
            return {
                error: error as GoPaySDKError | GoPayHTTPError,
                traceId: header(request, 'X-GoPay-Trace-Id'),
                transactionId: header(request, 'X-GoPay-Transaction-Id'),
                // What onError could read the moment it was called.
                reported: onError.mock.results[onError.mock.results.length - 1]
                    ?.value as {
                    traceId?: string;
                    transactionId?: string;
                },
            };
        }

        it('carries them on an HTTP error, already when onError sees it', async () => {
            const { error, traceId, transactionId, reported } =
                await failingCall(async () =>
                    makeResponse({ errors: [] }, 404),
                );

            expect(error).toBeInstanceOf(GoPayHTTPError);
            expect(error.traceId).toBe(traceId);
            expect(error.transactionId).toBe(transactionId);
            expect(reported).toMatchObject({ traceId, transactionId });
        });

        it('carries them on a timeout, where no response came back', async () => {
            const { error, traceId } = await failingCall(async () => {
                throw new DOMException(
                    'The operation timed out.',
                    'TimeoutError',
                );
            });

            expect(error).toMatchObject({
                errorCode: GoPayErrorCodes.NETWORK_TIMEOUT,
            });
            expect(error.traceId).toBe(traceId);
        });

        it('carries them on a network error', async () => {
            const { error, traceId, reported } = await failingCall(async () => {
                throw new TypeError('fetch failed');
            });

            expect(error).toMatchObject({
                errorCode: GoPayErrorCodes.NETWORK_ERROR,
            });
            expect(error.traceId).toBe(traceId);
            expect(reported.traceId).toBe(traceId);
        });

        it('has none when the call failed before any request', async () => {
            const sdk = await authenticated();
            const error = await sdk
                .getPaymentStatus('')
                .catch((reason: unknown) => reason);

            expect(error).toBeInstanceOf(GoPaySDKError);
            expect((error as GoPaySDKError).traceId).toBeUndefined();
        });
    });

    describe('scope of the ids', () => {
        it('puts none on an error raised before any request went out', async () => {
            const sdk = createGoPaySDK({ baseUrl: BASE_URL });
            const error = await sdk
                .getPaymentStatus(PAYMENT_ID)
                .catch((reason: unknown) => reason);

            expect(error).toMatchObject({
                errorCode: GoPayErrorCodes.AUTH_TOKEN_MISSING,
            });
            expect((error as GoPaySDKError).traceId).toBeUndefined();
            expect(requests).toHaveLength(0);
        });

        it('gives a failed token refresh the ids of the token request, not of the call that never went out', async () => {
            tokenExpiresIn = 1;
            const sdk = await authenticated();
            fetchMock.mockImplementation(async (req: Request) => {
                requests.push(req);
                return makeResponse({}, 500);
            });

            const error = await sdk
                .getPaymentStatus(PAYMENT_ID)
                .catch((reason: unknown) => reason);

            const refresh = requests[requests.length - 1];
            expect(refresh && isToken(refresh)).toBe(true);
            expect(error).toMatchObject({
                errorCode: GoPayErrorCodes.AUTH_REFRESH_FAILED,
            });
            expect((error as GoPaySDKError).traceId).toBe(
                header(refresh, 'X-GoPay-Trace-Id'),
            );
        });

        it('keeps the caller’s id across the pages of iterateEvents inside withTransactionId', async () => {
            const sdk = await authenticated();
            fetchMock
                .mockImplementationOnce(async (req: Request) => {
                    requests.push(req);
                    return makeResponse({
                        items: [],
                        next_page_url: `${BASE_URL}/eshops/1/events?prev_item=e1`,
                    });
                })
                .mockImplementationOnce(async (req: Request) => {
                    requests.push(req);
                    return makeResponse({ items: [] });
                });

            await sdk.withTransactionId('order-42', async () => {
                for await (const _ of sdk.iterateEvents('1')) {
                    // drain
                }
            });

            expect(
                apiRequests().map((req) =>
                    header(req, 'X-GoPay-Transaction-Id'),
                ),
            ).toEqual(['order-42', 'order-42']);
        });

        it('returns what withTransactionId was given to run, an async iterable included', async () => {
            const sdk = await authenticated();
            const cursor = {
                async *[Symbol.asyncIterator]() {},
                next: async () => ({ done: true, value: undefined }),
                toArray: async () => [],
            };

            expect(sdk.withTransactionId('order-42', () => cursor)).toBe(
                cursor,
            );
            // A real generator of the caller's own: only the SDK's methods bind theirs.
            const own = (async function* () {})();
            expect(sdk.withTransactionId('order-42', () => own)).toBe(own);
        });

        it('reports its own refusal to onError, but not what the caller’s fn throws', async () => {
            const onError = vi.fn();
            const sdk = await authenticated({ onError });

            expect(() =>
                sdk.withTransactionId('bad id', () => undefined),
            ).toThrow(GoPaySDKError);
            expect(onError).toHaveBeenCalledOnce();
            await expect(
                sdk.withTransactionId('order-42', async () => {
                    throw new Error('the shop’s own failure');
                }),
            ).rejects.toThrow('the shop’s own failure');
            expect(onError).toHaveBeenCalledOnce();
        });

        it('disposes iterateEvents through return(), on any Node version', async () => {
            const sdk = await authenticated();
            const events = sdk.iterateEvents('1');

            await expect(
                events[Symbol.asyncDispose](),
            ).resolves.toBeUndefined();
            await expect(events.next()).resolves.toEqual({
                done: true,
                value: undefined,
            });
        });
    });
});
