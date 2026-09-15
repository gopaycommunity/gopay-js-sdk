import { createHttpClient, requirePathSegment } from '@gopay-internal/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPaymentsApi } from '../../src/modules/payments/payments.module.js';
import { makeEmptyResponse } from './helpers.js';

/**
 * Path segments are interpolated into request paths that `buildUrl` resolves with
 * `new URL(relative, base)`, which normalises `.` and `..`. Without encoding, an id
 * such as `../recurrences/123` would reach a different endpoint than the caller
 * named. This mirrors PathSegmentEscapingTest.php in the PHP SDK.
 */
describe('requirePathSegment', () => {
    it('percent-encodes a traversal attempt instead of letting it resolve', () => {
        expect(requirePathSegment('../recurrences/123', 'paymentId')).toBe(
            '..%2Frecurrences%2F123',
        );
    });

    it('encodes a bare slash', () => {
        expect(requirePathSegment('a/b', 'paymentId')).toBe('a%2Fb');
    });

    it('rejects "." and ".."', () => {
        expect(() => requirePathSegment('.', 'paymentId')).toThrow(
            '[GoPaySDK] paymentId must not be "." or ".."',
        );
        expect(() => requirePathSegment('..', 'paymentId')).toThrow(
            '[GoPaySDK] paymentId must not be "." or ".."',
        );
    });

    it('still rejects an empty value', () => {
        expect(() => requirePathSegment('', 'paymentId')).toThrow(
            '[GoPaySDK] paymentId is required',
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
    let payments: ReturnType<typeof createPaymentsApi>;

    beforeEach(() => {
        fetchMock = vi.fn().mockResolvedValue(makeEmptyResponse());
        vi.stubGlobal('fetch', fetchMock);
        const client = createHttpClient({ baseUrl: 'https://example.com' });
        client.setToken({
            access_token: 'at-test',
            expires_in: 900,
            token_type: 'bearer',
        });
        payments = createPaymentsApi(client);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('keeps a traversing paymentId under /payments/', async () => {
        let capturedUrl = '';
        fetchMock.mockImplementation(async (req: Request) => {
            capturedUrl = req.url;
            return makeEmptyResponse();
        });

        await payments.cancelPayment('../recurrences/123');

        expect(capturedUrl).toBe(
            'https://example.com/payments/..%2Frecurrences%2F123',
        );
        expect(capturedUrl).not.toContain('/recurrences/123');
    });
});
