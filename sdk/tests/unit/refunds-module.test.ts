import { createHttpClient } from '@gopay-internal/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoPayErrorCodes, GoPaySDKError } from '../../src/errors.js';
import { createRefundsApi } from '../../src/modules/refunds/refunds.module.js';

const makeResponse = (data: unknown, status = 200, statusText = 'OK') =>
    new Response(JSON.stringify(data), {
        status,
        statusText,
        headers: { 'content-type': 'application/json' },
    });

const mockRefundDetails = {
    id: 'ref_100000001',
    state: 'REQUESTED',
    amount: 500,
    currency: 'CZK',
    created_at: '2024-01-01T00:00:00Z',
};

describe('RefundsModule', () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    let client: ReturnType<typeof createHttpClient>;
    let refunds: ReturnType<typeof createRefundsApi>;

    beforeEach(() => {
        fetchMock = vi.fn().mockResolvedValue(makeResponse(mockRefundDetails));
        vi.stubGlobal('fetch', fetchMock);
        client = createHttpClient({ baseUrl: 'https://example.com' });
        client.setToken({
            access_token: 'test-token',
            refresh_token: '',
            expires_in: 3600,
            refresh_expires_in: 0,
            token_type: 'bearer',
        });
        refunds = createRefundsApi(client);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // -------------------------------------------------------------------------
    // refundPayment()
    // -------------------------------------------------------------------------

    describe('refundPayment()', () => {
        it('sends POST to /payments/{paymentId}/refunds', async () => {
            let capturedReq!: Request;
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                await req.text();
                return makeResponse(mockRefundDetails);
            });

            await refunds.refundPayment('pay_001', { amount: 500 });

            expect(capturedReq.method).toBe('POST');
            expect(capturedReq.url).toBe(
                'https://example.com/payments/pay_001/refunds',
            );
        });

        it('sends JSON body with refund params', async () => {
            let capturedBody = '';
            fetchMock.mockImplementation(async (req: Request) => {
                capturedBody = await req.text();
                return makeResponse(mockRefundDetails);
            });

            await refunds.refundPayment('pay_001', { amount: 750 });

            expect(JSON.parse(capturedBody)).toEqual({ amount: 750 });
        });

        it('sends Bearer token', async () => {
            let capturedReq!: Request;
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                await req.text();
                return makeResponse(mockRefundDetails);
            });

            await refunds.refundPayment('pay_001', { amount: 500 });

            expect(capturedReq.headers.get('Authorization')).toBe(
                'Bearer test-token',
            );
        });

        it('returns refund details', async () => {
            const result = await refunds.refundPayment('pay_001', {
                amount: 500,
            });
            expect(result).toEqual(mockRefundDetails);
        });

        it('throws INVALID_ARGUMENT when paymentId is empty', async () => {
            const err = await refunds
                .refundPayment('', { amount: 500 })
                .catch((e: unknown) => e);
            expect(err).toBeInstanceOf(GoPaySDKError);
            expect((err as GoPaySDKError).errorCode).toBe(
                GoPayErrorCodes.INVALID_ARGUMENT,
            );
        });
    });

    // -------------------------------------------------------------------------
    // listRefunds()
    // -------------------------------------------------------------------------

    describe('listRefunds()', () => {
        it('sends GET to /payments/{paymentId}/refunds', async () => {
            let capturedReq!: Request;
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                return makeResponse([mockRefundDetails]);
            });

            await refunds.listRefunds('pay_001');

            expect(capturedReq.method).toBe('GET');
            expect(capturedReq.url).toBe(
                'https://example.com/payments/pay_001/refunds',
            );
        });

        it('returns array of refund details', async () => {
            fetchMock.mockResolvedValue(
                makeResponse([
                    mockRefundDetails,
                    { ...mockRefundDetails, id: 'ref_100000002' },
                ]),
            );

            const result = await refunds.listRefunds('pay_001');

            expect(result).toHaveLength(2);
            expect(result[0].id).toBe('ref_100000001');
            expect(result[1].id).toBe('ref_100000002');
        });

        it('throws INVALID_ARGUMENT when paymentId is empty', async () => {
            const err = await refunds.listRefunds('').catch((e: unknown) => e);
            expect(err).toBeInstanceOf(GoPaySDKError);
            expect((err as GoPaySDKError).errorCode).toBe(
                GoPayErrorCodes.INVALID_ARGUMENT,
            );
        });
    });

    // -------------------------------------------------------------------------
    // getRefund()
    // -------------------------------------------------------------------------

    describe('getRefund()', () => {
        it('sends GET to /refunds/{refundId}', async () => {
            let capturedReq!: Request;
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                return makeResponse(mockRefundDetails);
            });

            await refunds.getRefund('ref_100000001');

            expect(capturedReq.method).toBe('GET');
            expect(capturedReq.url).toBe(
                'https://example.com/refunds/ref_100000001',
            );
        });

        it('interpolates refundId correctly into the URL', async () => {
            let capturedUrl = '';
            fetchMock.mockImplementation(async (req: Request) => {
                capturedUrl = req.url;
                return makeResponse(mockRefundDetails);
            });

            await refunds.getRefund('ref_xyz_999');

            expect(capturedUrl).toContain('/refunds/ref_xyz_999');
        });

        it('returns refund details', async () => {
            const result = await refunds.getRefund('ref_100000001');
            expect(result).toEqual(mockRefundDetails);
        });

        it('throws INVALID_ARGUMENT when refundId is empty', async () => {
            const err = await refunds.getRefund('').catch((e: unknown) => e);
            expect(err).toBeInstanceOf(GoPaySDKError);
            expect((err as GoPaySDKError).errorCode).toBe(
                GoPayErrorCodes.INVALID_ARGUMENT,
            );
        });
    });
});
