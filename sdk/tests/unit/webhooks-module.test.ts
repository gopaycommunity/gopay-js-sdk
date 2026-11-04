import { readFileSync } from 'node:fs';
import { createHttpClient } from '@gopay-internal/core';
import {
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import {
    GoPayErrorCodes,
    GoPayHTTPError,
    GoPaySDKError,
} from '../../src/errors.js';
import { createGoPaySDK } from '../../src/index.js';
import { createWebhooksApi } from '../../src/modules/webhooks/webhooks.module.js';
import { makeResponse } from './helpers.js';

// Captured from a GoPay test gateway as it was delivered, not built here: the one check
// that this verifier agrees with the gateway's signer, not merely with itself.
const captured = JSON.parse(
    readFileSync(
        new URL('./fixtures/webhook-payments-canceled.json', import.meta.url),
        'utf8',
    ),
) as {
    body_base64: string;
    x_gopay_signature: string;
    jwks: { keys: unknown[] };
};
const capturedBody = Buffer.from(captured.body_base64, 'base64');

const b64url = (value: string | Uint8Array) =>
    Buffer.from(value).toString('base64url');

/** A well-formed protected header, so a row fails for the part it is about and not for a missing kid. */
const WITH_KID = b64url(JSON.stringify({ alg: 'RS256', kid: 'test-a' }));

interface TestKey {
    kid: string;
    privateKey: CryptoKey;
    jwk: Record<string, string>;
}

async function makeKey(kid: string): Promise<TestKey> {
    const pair = await crypto.subtle.generateKey(
        {
            name: 'RSASSA-PKCS1-v1_5',
            modulusLength: 2048,
            publicExponent: new Uint8Array([1, 0, 1]),
            hash: 'SHA-256',
        },
        true,
        ['sign', 'verify'],
    );
    const { n = '', e = '' } = await crypto.subtle.exportKey(
        'jwk',
        pair.publicKey,
    );
    return {
        kid,
        privateKey: pair.privateKey,
        jwk: { kty: 'RSA', use: 'sig', alg: 'RS256', kid, n, e },
    };
}

async function sign(
    key: TestKey,
    body: string,
    header: object = { alg: 'RS256', kid: key.kid },
) {
    const protectedHeader = b64url(JSON.stringify(header));
    const signature = await crypto.subtle.sign(
        'RSASSA-PKCS1-v1_5',
        key.privateKey,
        new TextEncoder().encode(`${protectedHeader}.${b64url(body)}`),
    );
    return `${protectedHeader}..${b64url(new Uint8Array(signature))}`;
}

const event = (type = 'payments.paid') =>
    JSON.stringify({
        id: '01M5YWPW85D1XJMZ76N7AJHY49',
        type,
        occurred_at: '2026-10-27T14:37:27.167Z',
        data: { payment_id: '7639814693' },
    });

const jwksResponse = (...keys: unknown[]) => makeResponse({ keys });

async function expectCode(promise: Promise<unknown>, code: string) {
    const error = await promise.then(
        () => undefined,
        (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(GoPaySDKError);
    expect((error as GoPaySDKError).errorCode).toBe(code);
    return error as GoPaySDKError;
}

describe('WebhooksModule', () => {
    let keyA: TestKey;
    let keyB: TestKey;
    let fetchMock: ReturnType<typeof vi.fn>;
    let webhooks: ReturnType<typeof createWebhooksApi>;
    let now: number;

    beforeAll(async () => {
        [keyA, keyB] = await Promise.all([
            makeKey('test-a'),
            makeKey('test-b'),
        ]);
    });

    beforeEach(() => {
        fetchMock = vi
            .fn()
            .mockImplementation(async () =>
                jwksResponse(...captured.jwks.keys),
            );
        vi.stubGlobal('fetch', fetchMock);
        now = 1_000_000;
        vi.spyOn(Date, 'now').mockImplementation(() => now);
        const client = createHttpClient({
            baseUrl: 'https://example.com/gp-gw/api/4.0',
        });
        client.setToken({
            access_token: 'test-token',
            expires_in: 86_400, // outlives the hour the key-age tests skip
            token_type: 'bearer',
        });
        webhooks = createWebhooksApi(client);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    const keyFetches = () =>
        fetchMock.mock.calls.filter(([req]) =>
            new URL((req as Request).url).pathname.endsWith(
                '/webhooks/public-keys',
            ),
        ).length;

    describe('a webhook signed by the gateway', () => {
        it('verifies and returns its event', async () => {
            const result = await webhooks.verifyWebhook(
                capturedBody,
                captured.x_gopay_signature,
            );

            expect(result).toEqual(JSON.parse(capturedBody.toString('utf8')));
            expect(result.type).toBe('payments.canceled');
        });

        it('fetches the keys with the bearer token, once', async () => {
            await webhooks.verifyWebhook(
                capturedBody,
                captured.x_gopay_signature,
            );
            await webhooks.verifyWebhook(
                capturedBody,
                captured.x_gopay_signature,
            );

            expect(keyFetches()).toBe(1);
            const req = fetchMock.mock.calls[0]?.[0] as Request;
            expect(req.url).toBe(
                'https://example.com/gp-gw/api/4.0/webhooks/public-keys',
            );
            expect(req.headers.get('Authorization')).toBe('Bearer test-token');
        });

        it('accepts the body as a string, a Uint8Array and an ArrayBuffer', async () => {
            const text = capturedBody.toString('utf8');
            const bytes = new Uint8Array(capturedBody);

            await expect(
                webhooks.verifyWebhook(text, captured.x_gopay_signature),
            ).resolves.toBeDefined();
            await expect(
                webhooks.verifyWebhook(bytes, captured.x_gopay_signature),
            ).resolves.toBeDefined();
            await expect(
                webhooks.verifyWebhook(
                    bytes.buffer,
                    captured.x_gopay_signature,
                ),
            ).resolves.toBeDefined();
        });

        it('accepts the header as Node types it, an array of one', async () => {
            await expect(
                webhooks.verifyWebhook(capturedBody, [
                    captured.x_gopay_signature,
                ]),
            ).resolves.toBeDefined();
        });

        it('refuses the body with one byte changed', async () => {
            const tampered = Buffer.from(
                capturedBody
                    .toString('utf8')
                    .replace('7639814693', '7639814694'),
            );

            await expectCode(
                webhooks.verifyWebhook(tampered, captured.x_gopay_signature),
                GoPayErrorCodes.WEBHOOK_INVALID,
            );
        });

        it('refuses the same body re-serialised, because the signature covers bytes', async () => {
            const reformatted = JSON.stringify(
                JSON.parse(capturedBody.toString('utf8')),
                null,
                2,
            );

            await expectCode(
                webhooks.verifyWebhook(reformatted, captured.x_gopay_signature),
                GoPayErrorCodes.WEBHOOK_INVALID,
            );
        });
    });

    describe('the signature header', () => {
        const refused = async (header: string | string[] | undefined) =>
            expectCode(
                webhooks.verifyWebhook(event(), header),
                GoPayErrorCodes.WEBHOOK_INVALID,
            );

        it.each([
            ['missing', undefined, 'exactly one X-GoPay-Signature'],
            ['empty', '', 'exactly one X-GoPay-Signature'],
            [
                'two headers',
                [`${WITH_KID}..c2ln`, `${WITH_KID}..c2ln`],
                'exactly one X-GoPay-Signature',
            ],
            ['not a JWS', 'abc', 'not a detached JWS'],
            [
                'an attached payload',
                `${WITH_KID}.e30.c2ln`,
                'not a detached JWS',
            ],
            ['four parts', `${WITH_KID}..c2ln.c2ln`, 'not a detached JWS'],
            ['padded base64', `${WITH_KID}..c2ln==`, 'not base64url'],
            ['standard base64', `${WITH_KID}..c2/n+A`, 'not base64url'],
            [
                'a header that is not JSON',
                `${b64url('not json')}..c2ln`,
                'not JSON',
            ],
        ])(
            'refuses %s, before fetching any key',
            async (_name, header, reason) => {
                const error = await refused(header);
                expect(error.message).toContain(reason);
                expect(fetchMock).not.toHaveBeenCalled();
            },
        );

        it.each([
            ['another alg', { alg: 'HS256', kid: 'test-a' }],
            ['alg none', { alg: 'none', kid: 'test-a' }],
            ['no kid', { alg: 'RS256' }],
            ['an empty kid', { alg: 'RS256', kid: '' }],
            ['crit', { alg: 'RS256', kid: 'test-a', crit: ['exp'] }],
            ['b64', { alg: 'RS256', kid: 'test-a', b64: false }],
        ])(
            'refuses a header with %s, before fetching any key',
            async (_name, header) => {
                await refused(await sign(keyA, event(), header));
                expect(fetchMock).not.toHaveBeenCalled();
            },
        );

        it('says nothing in the message that the request supplied', async () => {
            const error = await refused(
                await sign(keyA, event(), {
                    alg: 'RS256',
                    kid: 'kid-<script>',
                }),
            );
            expect(error.message).not.toContain('kid-<script>');
        });
    });

    describe('keys', () => {
        it('refetches once for an unknown kid, so a rotated-in key verifies', async () => {
            fetchMock
                .mockResolvedValueOnce(jwksResponse(keyA.jwk))
                .mockResolvedValueOnce(jwksResponse(keyA.jwk, keyB.jwk));
            await webhooks.verifyWebhook(event(), await sign(keyA, event()));
            now += 60_000;

            await expect(
                webhooks.verifyWebhook(event(), await sign(keyB, event())),
            ).resolves.toBeDefined();
            expect(keyFetches()).toBe(2);
        });

        // A real webhook signed with a key rotated in meanwhile must get a 5xx GoPay retries,
        // not a 4xx that drops it.
        it('reports an unknown kid within ten seconds of the last fetch as not checked, without refetching', async () => {
            fetchMock.mockResolvedValue(jwksResponse(keyA.jwk));
            await webhooks.verifyWebhook(event(), await sign(keyA, event()));
            now += 9_999;

            await expectCode(
                webhooks.verifyWebhook(event(), await sign(keyB, event())),
                GoPayErrorCodes.WEBHOOK_KEYS_UNAVAILABLE,
            );
            expect(keyFetches()).toBe(1);
        });

        it('stops trusting a key GoPay no longer publishes', async () => {
            fetchMock
                .mockImplementationOnce(async () => jwksResponse(keyA.jwk))
                .mockImplementation(async () => jwksResponse(keyB.jwk));
            await webhooks.verifyWebhook(event(), await sign(keyA, event()));
            now += 10_000;
            await webhooks.verifyWebhook(event(), await sign(keyB, event()));
            now += 10_000;

            await expectCode(
                webhooks.verifyWebhook(event(), await sign(keyA, event())),
                GoPayErrorCodes.WEBHOOK_INVALID,
            );
        });

        it('refetches keys older than an hour, so a withdrawn key stops verifying even when cached', async () => {
            fetchMock
                .mockImplementationOnce(async () => jwksResponse(keyA.jwk))
                .mockImplementation(async () => jwksResponse(keyB.jwk));
            await webhooks.verifyWebhook(event(), await sign(keyA, event()));
            now += 60 * 60_000 - 1;
            await webhooks.verifyWebhook(event(), await sign(keyA, event()));
            expect(keyFetches()).toBe(1);
            now += 1;

            await expectCode(
                webhooks.verifyWebhook(event(), await sign(keyA, event())),
                GoPayErrorCodes.WEBHOOK_INVALID,
            );
            expect(keyFetches()).toBe(2);
        });

        it('keeps verifying with the last keys when the hourly refetch fails', async () => {
            fetchMock
                .mockImplementationOnce(async () => jwksResponse(keyA.jwk))
                .mockImplementation(async () => makeResponse({}, 500));
            await webhooks.verifyWebhook(event(), await sign(keyA, event()));
            now += 60 * 60_000;

            await expect(
                webhooks.verifyWebhook(event(), await sign(keyA, event())),
            ).resolves.toBeDefined();
        });

        it('retries a failed refresh after ten seconds, not after another hour', async () => {
            fetchMock.mockImplementation(async () => jwksResponse(keyA.jwk));
            await webhooks.verifyWebhook(event(), await sign(keyA, event()));
            now += 60 * 60_000;
            fetchMock.mockImplementation(async () => makeResponse({}, 500));
            await webhooks.verifyWebhook(event(), await sign(keyA, event()));
            const afterFailure = keyFetches();
            now += 9_999;
            await webhooks.verifyWebhook(event(), await sign(keyA, event()));
            expect(keyFetches()).toBe(afterFailure);
            now += 1;
            fetchMock.mockImplementation(async () => jwksResponse(keyB.jwk));

            // Refreshed at last: keyA was withdrawn meanwhile and stops verifying.
            await expectCode(
                webhooks.verifyWebhook(event(), await sign(keyA, event())),
                GoPayErrorCodes.WEBHOOK_INVALID,
            );
        });

        it('refuses a signature made with another key under a published kid', async () => {
            fetchMock.mockResolvedValue(jwksResponse(keyA.jwk));

            await expectCode(
                webhooks.verifyWebhook(
                    event(),
                    await sign(keyB, event(), { alg: 'RS256', kid: 'test-a' }),
                ),
                GoPayErrorCodes.WEBHOOK_INVALID,
            );
        });

        // keyA's own material each time, so only the marking can be what refuses it.
        it.each([
            ['marked for encryption', { use: 'enc' }],
            ['for another algorithm', { alg: 'RS512' }],
            ['of another key type', { kty: 'EC' }],
        ])('ignores a key %s', async (_name, change) => {
            fetchMock.mockResolvedValue(
                jwksResponse({ ...keyA.jwk, ...change }),
            );

            await expectCode(
                webhooks.verifyWebhook(event(), await sign(keyA, event())),
                GoPayErrorCodes.WEBHOOK_INVALID,
            );
        });

        it('skips a key that does not import, and keeps the rest', async () => {
            fetchMock.mockResolvedValue(
                jwksResponse({ ...keyA.jwk, n: '!' }, keyB.jwk),
            );

            await expect(
                webhooks.verifyWebhook(event(), await sign(keyB, event())),
            ).resolves.toBeDefined();
        });

        it('shares one fetch between webhooks arriving together', async () => {
            fetchMock.mockResolvedValue(jwksResponse(keyA.jwk));
            const header = await sign(keyA, event());

            await Promise.all(
                [1, 2, 3].map(() => webhooks.verifyWebhook(event(), header)),
            );
            expect(keyFetches()).toBe(1);
        });

        it('reports keys that cannot be loaded as unavailable, not as a forged webhook', async () => {
            fetchMock.mockImplementation(async () =>
                makeResponse(
                    { errors: [{ message: 'signing keys are not available' }] },
                    500,
                ),
            );

            const error = await expectCode(
                webhooks.verifyWebhook(event(), await sign(keyA, event())),
                GoPayErrorCodes.WEBHOOK_KEYS_UNAVAILABLE,
            );
            expect(error.cause).toBeInstanceOf(GoPayHTTPError);
            expect((error.cause as GoPayHTTPError).status).toBe(500);
        });

        // The HTTP client retries a 500 by itself, so one load can be several fetches.
        it('keeps reporting them unavailable within ten seconds, without calling GoPay again', async () => {
            fetchMock.mockImplementation(async () => makeResponse({}, 500));
            await expectCode(
                webhooks.verifyWebhook(event(), await sign(keyA, event())),
                GoPayErrorCodes.WEBHOOK_KEYS_UNAVAILABLE,
            );
            const afterFirst = keyFetches();
            now += 5_000;

            await expectCode(
                webhooks.verifyWebhook(event(), await sign(keyA, event())),
                GoPayErrorCodes.WEBHOOK_KEYS_UNAVAILABLE,
            );
            expect(keyFetches()).toBe(afterFirst);
        });

        it('recovers once the keys load again', async () => {
            fetchMock.mockImplementation(async () => makeResponse({}, 500));
            await expectCode(
                webhooks.verifyWebhook(event(), await sign(keyA, event())),
                GoPayErrorCodes.WEBHOOK_KEYS_UNAVAILABLE,
            );
            fetchMock.mockImplementation(async () => jwksResponse(keyA.jwk));
            now += 60_000;

            await expect(
                webhooks.verifyWebhook(event(), await sign(keyA, event())),
            ).resolves.toBeDefined();
        });

        it('names the missing scope when the token may not read the keys', async () => {
            fetchMock.mockImplementation(async () => makeResponse({}, 403));

            const error = await expectCode(
                webhooks.verifyWebhook(event(), await sign(keyA, event())),
                GoPayErrorCodes.WEBHOOK_KEYS_UNAVAILABLE,
            );
            expect(error.message).toContain('shared:read');
        });
    });

    describe('the body', () => {
        beforeEach(() => {
            fetchMock.mockResolvedValue(jwksResponse(keyA.jwk));
        });

        it('returns an event type the SDK does not know yet, unchanged', async () => {
            const body = event('payments.something_new');

            await expect(
                webhooks.verifyWebhook(body, await sign(keyA, body)),
            ).resolves.toEqual(JSON.parse(body));
        });

        it.each([
            ['not JSON', 'not json'],
            ['an array', '[]'],
            [
                'missing data',
                JSON.stringify({
                    id: 'e',
                    type: 'payments.paid',
                    occurred_at: 't',
                }),
            ],
            [
                'a numeric id',
                JSON.stringify({
                    id: 1,
                    type: 'payments.paid',
                    occurred_at: 't',
                    data: {},
                }),
            ],
        ])('refuses a signed body that is %s', async (_name, body) => {
            await expectCode(
                webhooks.verifyWebhook(body, await sign(keyA, body)),
                GoPayErrorCodes.WEBHOOK_INVALID,
            );
        });

        it('refuses a parsed body with INVALID_ARGUMENT, before fetching any key', async () => {
            const parsed = JSON.parse(event()) as unknown as string;

            await expectCode(
                webhooks.verifyWebhook(parsed, await sign(keyA, event())),
                GoPayErrorCodes.INVALID_ARGUMENT,
            );
            expect(fetchMock).not.toHaveBeenCalled();
        });
    });

    describe('getWebhookPublicKeys()', () => {
        it('returns the JWK Set from GET /webhooks/public-keys', async () => {
            await expect(webhooks.getWebhookPublicKeys()).resolves.toEqual(
                captured.jwks,
            );
            expect(
                (fetchMock.mock.calls[0]?.[0] as Request | undefined)?.url,
            ).toBe('https://example.com/gp-gw/api/4.0/webhooks/public-keys');
        });
    });

    describe('onError', () => {
        it('does not hear of WEBHOOK_INVALID, which anyone can cause', async () => {
            const onError = vi.fn();
            const sdk = createGoPaySDK({
                baseUrl: 'https://example.com/gp-gw/api/4.0',
                onError,
            });

            await expectCode(
                sdk.verifyWebhook(event(), 'abc'),
                GoPayErrorCodes.WEBHOOK_INVALID,
            );
            expect(onError).not.toHaveBeenCalled();
        });

        function reportingApi() {
            const onError = vi.fn();
            const client = createHttpClient({
                baseUrl: 'https://example.com/gp-gw/api/4.0',
                onError,
            });
            client.setToken({
                access_token: 'test-token',
                expires_in: 86_400,
                token_type: 'bearer',
            });
            return { onError, api: createWebhooksApi(client) };
        }

        const reported = (onError: ReturnType<typeof vi.fn>) =>
            onError.mock.calls.map(
                ([error]) => error as GoPaySDKError | GoPayHTTPError,
            );

        // Anyone can name a kid that does not exist; the first such webhook refetches the keys,
        // the rest meet the throttle and are "not checked yet" (a 5xx), which is not an outage.
        it('does not hear of forged webhooks naming an unknown kid, throttled or not', async () => {
            const { onError, api } = reportingApi();
            fetchMock.mockImplementation(async () => jwksResponse(keyA.jwk));
            const forged = await sign(keyB, event());

            const codes: unknown[] = [];
            for (let i = 0; i < 5; i++) {
                const error = await api
                    .verifyWebhook(event(), forged)
                    .catch((reason: unknown) => reason);
                codes.push((error as GoPaySDKError).errorCode);
            }

            expect(codes).toContain(GoPayErrorCodes.WEBHOOK_INVALID);
            expect(codes).toContain(GoPayErrorCodes.WEBHOOK_KEYS_UNAVAILABLE);
            expect(onError).not.toHaveBeenCalled();
        });

        it('hears of a key load that failed once per attempt, not once per webhook', async () => {
            const { onError, api } = reportingApi();
            fetchMock.mockImplementation(async () => makeResponse({}, 500));
            const header = await sign(keyA, event());

            for (let i = 0; i < 4; i++) {
                await expectCode(
                    api.verifyWebhook(event(), header),
                    GoPayErrorCodes.WEBHOOK_KEYS_UNAVAILABLE,
                );
            }
            // The HTTP client's report of the failed fetch, once, not one per webhook.
            expect(reported(onError)).toHaveLength(1);
            expect(reported(onError)[0]).toBeInstanceOf(GoPayHTTPError);

            now += 10_000;
            await expectCode(
                api.verifyWebhook(event(), header),
                GoPayErrorCodes.WEBHOOK_KEYS_UNAVAILABLE,
            );
            expect(reported(onError)).toHaveLength(2);
        });

        it('hears of a parsed body and of keys that cannot be loaded', async () => {
            const onError = vi.fn();
            const client = createHttpClient({
                baseUrl: 'https://example.com/gp-gw/api/4.0',
                onError,
            });
            client.setToken({
                access_token: 'test-token',
                expires_in: 86_400,
                token_type: 'bearer',
            });
            const api = createWebhooksApi(client);
            const parsed = JSON.parse(event()) as unknown as string;

            await expectCode(
                api.verifyWebhook(parsed, await sign(keyA, event())),
                GoPayErrorCodes.INVALID_ARGUMENT,
            );
            fetchMock.mockImplementation(async () => makeResponse({}, 403));
            await expectCode(
                api.verifyWebhook(event(), await sign(keyA, event())),
                GoPayErrorCodes.WEBHOOK_KEYS_UNAVAILABLE,
            );

            const heard = reported(onError);
            expect(
                heard.some(
                    (error) =>
                        error instanceof GoPaySDKError &&
                        error.errorCode === GoPayErrorCodes.INVALID_ARGUMENT,
                ),
            ).toBe(true);
            // The key fetch's own 403, reported by the HTTP client; no WEBHOOK_* error besides.
            expect(
                heard.some(
                    (error) =>
                        error instanceof GoPayHTTPError && error.status === 403,
                ),
            ).toBe(true);
            expect(
                heard.some(
                    (error) =>
                        error instanceof GoPaySDKError &&
                        error.errorCode ===
                            GoPayErrorCodes.WEBHOOK_KEYS_UNAVAILABLE,
                ),
            ).toBe(false);
        });
    });
});
