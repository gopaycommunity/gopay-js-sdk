import { createHttpClient } from '@gopay-internal/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoPayErrorCodes, GoPaySDKError } from '../../src/errors.js';
import { createPaymentsApi } from '../../src/modules/payments/payments.module.js';

/**
 * The browser SDK interpolates the attached payment id into twelve request
 * paths. `buildUrl` resolves a relative path with `new URL(relative, base)`,
 * which normalises `.` and `..` — so an unencoded id escapes the endpoint the
 * caller named. Demonstrated on PR #62 against the published package:
 *
 *     ../../oauth2/token  ->  /oauth2/token/charge
 *
 * GPOMA-2633 closed this across `sdk/`, which left the browser package — the one
 * that runs on a page where the id can come from the merchant's own markup — as
 * the only unguarded side.
 *
 * The encoding rules themselves are `requirePathSegment`'s and are covered in
 * sdk/tests/unit/path-segment-escaping.test.ts. What is asserted here is the
 * property that matters at this layer: whatever the id, the request stays inside
 * the endpoint the method names.
 */

const BASE = 'https://example.com';

const HOSTILE_IDS: ReadonlyArray<readonly [string, string, string]> = [
    // the escape demonstrated on #62
    ['path traversal', '../../oauth2/token', '..%2F..%2Foauth2%2Ftoken'],
    ['single traversal', '../recurrences/123', '..%2Frecurrences%2F123'],
    ['query injection', '1?format=svg', '1%3Fformat%3Dsvg'],
    ['fragment', '1#frag', '1%23frag'],
    ['trailing slash', '1/', '1%2F'],
    ['three dots', '...', '...'],
    ['sub-delims', "pay(1)!'*", 'pay%281%29%21%27%2A'],
];

const DOT_SEGMENTS = ['.', '..'] as const;

const makeResponse = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
    });

describe('payment id cannot escape its endpoint', () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    let capturedUrl: string;
    let client: ReturnType<typeof createHttpClient>;

    beforeEach(() => {
        capturedUrl = '';
        fetchMock = vi.fn().mockImplementation(async (req: Request) => {
            capturedUrl = req.url;
            return makeResponse({});
        });
        vi.stubGlobal('fetch', fetchMock);
        client = createHttpClient({ baseUrl: BASE });
        client.setToken({
            access_token: 'at-test',
            expires_in: 900,
            token_type: 'bearer',
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it.each(
        HOSTILE_IDS,
    )('keeps getStatus() inside /payments for %s', async (_name, raw, encoded) => {
        const api = createPaymentsApi(client, raw);

        await api.getStatus();

        expect(capturedUrl).toBe(`${BASE}/payments/${encoded}`);
    });

    it.each(
        HOSTILE_IDS,
    )('keeps getGooglePayInfo() inside /payments for %s', async (_name, raw, encoded) => {
        const api = createPaymentsApi(client, raw);

        await api.getGooglePayInfo();

        expect(capturedUrl).toBe(`${BASE}/payments/${encoded}/google-pay/info`);
    });

    /**
     * The query-string case is the one this endpoint can get wrong on its own:
     * it is the only path that appends a `?` of its own, so an id carrying one
     * would otherwise merge into it.
     */
    it('keeps the format query separate from an id that carries one', async () => {
        const api = createPaymentsApi(client, '1?format=svg');

        await api.getQRPaymentInfo('png');

        expect(capturedUrl).toBe(
            `${BASE}/payments/1%3Fformat%3Dsvg/qr-payment/info?format=png`,
        );
        expect(new URL(capturedUrl).searchParams.get('format')).toBe('png');
    });

    it.each(DOT_SEGMENTS)('refuses "%s" when the api is constructed', (raw) => {
        const err = (() => {
            try {
                return createPaymentsApi(client, raw);
            } catch (e: unknown) {
                return e;
            }
        })();

        expect(err).toBeInstanceOf(GoPaySDKError);
        expect((err as GoPaySDKError).errorCode).toBe(
            GoPayErrorCodes.INVALID_ARGUMENT,
        );
    });

    it('rejects an empty id rather than requesting /payments/', () => {
        expect(() => createPaymentsApi(client, '')).toThrow(GoPaySDKError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('leaves an ordinary id untouched', async () => {
        const api = createPaymentsApi(client, 'pay_300000001');

        await api.getStatus();

        expect(capturedUrl).toBe(`${BASE}/payments/pay_300000001`);
    });
});
