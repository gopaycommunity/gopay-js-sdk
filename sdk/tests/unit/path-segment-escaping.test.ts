import { createHttpClient, requirePathSegment } from '@gopay-internal/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoPayErrorCodes, GoPaySDKError } from '../../src/errors.js';
import { createCardsApi } from '../../src/modules/cards/cards.module.js';
import { createLinksApi } from '../../src/modules/links/links.module.js';
import { createPaymentsApi } from '../../src/modules/payments/payments.module.js';
import { createRecurrencesApi } from '../../src/modules/recurrences/recurrences.module.js';
import { createRefundsApi } from '../../src/modules/refunds/refunds.module.js';
import { makeEmptyResponse, makeResponse } from './helpers.js';

/**
 * Path segments are interpolated into request paths that `buildUrl` resolves with
 * `new URL(relative, base)`, which normalises `.` and `..`. Without encoding, an id
 * such as `../recurrences/123` would reach a different endpoint than the caller
 * named, and a `?`-bearing one would append a query string — both silently
 * addressing something the caller never asked for.
 *
 * Every module that puts an id in a path is covered here, because this is the kind
 * of guarantee that quietly regresses when a new endpoint is added by copying an
 * existing method: a call site that fell back to `requireNonEmptyString` neither
 * encodes nor rejects, so it fails both halves of every table below.
 *
 * This mirrors PathSegmentEscapingTest.php in the PHP SDK, case for case. The one
 * deliberate divergence is padding — see `leaves a padded id trimmed`.
 */

/**
 * A traversal attempt must stay inside its own segment, and the encoded form must
 * not reintroduce a separator. `.` is unreserved in RFC 3986, so a run of dots is
 * left alone: three of them is an ordinary segment and must survive as itself —
 * only the two dot segments proper are refused, see the rejection table.
 */
const HOSTILE_IDS: ReadonlyArray<readonly [string, string, string]> = [
    ['path traversal', '../../payments/pay-1', '..%2F..%2Fpayments%2Fpay-1'],
    ['query injection', '1?format=svg', '1%3Fformat%3Dsvg'],
    ['fragment', '1#frag', '1%23frag'],
    ['trailing slash', '1/', '1%2F'],
    ['three dots', '...', '...'],
    ['sub-delims', "pay(1)!'*", 'pay%281%29%21%27%2A'],
];

/**
 * Exactly `.` and `..` are dot segments. Percent-encoding returns them unchanged —
 * they are unreserved — so a bare `..` escapes its endpoint with no separator of
 * its own: anything normalising `/payments/..` resolves it to `/`. Encoding cannot
 * fix that, so they are refused outright.
 */
const DOT_SEGMENTS = ['.', '..'] as const;

const BASE = 'https://example.com';

const mockPayment = {
    amount: 1500,
    currency: 'CZK',
    order_number: '2025010199',
    customer: { email: 'john.doe@example.com' },
    callback: {
        notification_url: 'https://example.com/notify',
        return_url: 'https://example.com/return',
    },
} as const;

const mockJson = {
    id: '8008013370',
    type: 'ON_DEMAND',
    state: 'NEW',
    recurrence_date_to: '2027-09-04',
    payment: mockPayment,
};

describe('requirePathSegment', () => {
    it.each(HOSTILE_IDS)('encodes %s', (_name, raw, encoded) => {
        expect(requirePathSegment(raw, 'paymentId')).toBe(encoded);
    });

    it.each(DOT_SEGMENTS)('rejects "%s"', (raw) => {
        const err = (() => {
            try {
                return requirePathSegment(raw, 'paymentId');
            } catch (e: unknown) {
                return e;
            }
        })();

        expect(err).toBeInstanceOf(GoPaySDKError);
        expect((err as GoPaySDKError).message).toBe(
            '[GoPaySDK] paymentId must not be "." or ".."',
        );
        expect((err as GoPaySDKError).errorCode).toBe(
            GoPayErrorCodes.INVALID_ARGUMENT,
        );
    });

    /**
     * `requireNonEmptyString` trims to decide emptiness, so a whitespace-only id is
     * refused.
     */
    it('rejects a whitespace-only id', () => {
        const err = (() => {
            try {
                return requirePathSegment('  \t ', 'paymentId');
            } catch (e: unknown) {
                return e;
            }
        })();

        expect(err).toBeInstanceOf(GoPaySDKError);
        expect((err as GoPaySDKError).message).toBe(
            '[GoPaySDK] paymentId is required',
        );
        expect((err as GoPaySDKError).errorCode).toBe(
            GoPayErrorCodes.INVALID_ARGUMENT,
        );
    });

    it('rejects an empty id', () => {
        const err = (() => {
            try {
                return requirePathSegment('', 'paymentId');
            } catch (e: unknown) {
                return e;
            }
        })();

        expect(err).toBeInstanceOf(GoPaySDKError);
        expect((err as GoPaySDKError).errorCode).toBe(
            GoPayErrorCodes.INVALID_ARGUMENT,
        );
    });

    /**
     * The PHP SDK encodes a padded id rather than trimming it, so the same input
     * yields `/payments/%20300000001%20` there and `/payments/300000001` here.
     * `requireNonEmptyString` returns the trimmed value and every body field in the
     * SDK relies on that, so the divergence is pinned rather than papered over:
     * changing it is a change to the whole validator, not to this helper.
     */
    it('leaves a padded id trimmed, unlike the PHP SDK', () => {
        expect(requirePathSegment(' 300000001 ', 'paymentId')).toBe(
            '300000001',
        );
    });

    it('leaves an ordinary id untouched', () => {
        expect(requirePathSegment('pay_300000001', 'paymentId')).toBe(
            'pay_300000001',
        );
    });
});

describe('modules do not let a path segment escape its endpoint', () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    let capturedUrl: string;
    let client: ReturnType<typeof createHttpClient>;

    beforeEach(() => {
        capturedUrl = '';
        fetchMock = vi.fn().mockImplementation(async (req: Request) => {
            capturedUrl = req.url;
            return req.method === 'DELETE'
                ? makeEmptyResponse()
                : makeResponse(mockJson);
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

    /**
     * One row per module that puts an id in a path, plus one per shape of path the
     * id can sit in: last segment, mid-path before an action, and first segment.
     * `start` and `next` are the shape a traversal actually exploits — unescaped,
     * a `../..` there addresses another endpoint's action, not merely another
     * resource.
     */
    const CALLS: ReadonlyArray<
        readonly [string, (raw: string) => Promise<unknown>, string]
    > = [
        [
            'payments.getPaymentStatus',
            (raw) => createPaymentsApi(client).getPaymentStatus(raw),
            '/payments/{id}',
        ],
        [
            'payments.cancelPayment',
            (raw) => createPaymentsApi(client).cancelPayment(raw),
            '/payments/{id}',
        ],
        [
            'payments.getChargeState',
            (raw) => createPaymentsApi(client).getChargeState(raw),
            '/payments/{id}/charge',
        ],
        [
            'refunds.getRefund',
            (raw) => createRefundsApi(client).getRefund(raw),
            '/refunds/{id}',
        ],
        [
            'cards.deleteCard',
            (raw) => createCardsApi(client).deleteCard(raw),
            '/cards/tokens/{id}',
        ],
        [
            'cards.getCardDetails',
            (raw) => createCardsApi(client).getCardDetails(raw),
            '/cards/tokens/{id}',
        ],
        [
            'links.disablePaymentLink',
            (raw) => createLinksApi(client).disablePaymentLink(raw, raw),
            '/eshops/{id}/links/{id}',
        ],
        [
            'recurrences.stopRecurrence',
            (raw) => createRecurrencesApi(client).stopRecurrence(raw),
            '/recurrences/{id}',
        ],
        [
            'recurrences.getRecurrence',
            (raw) => createRecurrencesApi(client).getRecurrence(raw),
            '/recurrences/{id}',
        ],
        [
            'recurrences.startRecurrence',
            (raw) => createRecurrencesApi(client).startRecurrence(raw),
            '/recurrences/{id}/start',
        ],
        [
            'recurrences.createNextPayment',
            (raw) => createRecurrencesApi(client).createNextPayment(raw),
            '/recurrences/{id}/next',
        ],
        [
            'recurrences.createRecurrence',
            (raw) =>
                createRecurrencesApi(client).createRecurrence(raw, {
                    type: 'ON_DEMAND',
                    recurrence_date_to: '2027-09-04',
                    payment: mockPayment,
                }),
            '/eshops/{id}/recurrences',
        ],
    ];

    for (const [label, call, template] of CALLS) {
        describe(label, () => {
            it.each(
                HOSTILE_IDS,
            )(`keeps ${template} intact against %s`, async (_name, raw, encoded) => {
                await call(raw);

                expect(capturedUrl).toBe(
                    BASE + template.replace(/\{id\}/g, encoded),
                );
            });

            it.each(
                DOT_SEGMENTS,
            )('rejects "%s" and sends nothing', async (raw) => {
                const err = await call(raw).catch((e: unknown) => e);

                expect(err).toBeInstanceOf(GoPaySDKError);
                expect((err as GoPaySDKError).errorCode).toBe(
                    GoPayErrorCodes.INVALID_ARGUMENT,
                );
                expect(fetchMock).not.toHaveBeenCalled();
            });
        });
    }
});
