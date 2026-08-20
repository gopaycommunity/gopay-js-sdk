import { createHttpClient } from '@gopay-internal/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoPayErrorCodes, GoPaySDKError } from '../../src/errors.js';
import { createRefundsApi } from '../../src/modules/refunds/refunds.module.js';
import { makeResponse } from './helpers.js';

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
            expires_in: 3600,
            token_type: 'bearer',
        });
        refunds = createRefundsApi(client);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
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

    // -------------------------------------------------------------------------
    // awaitRefundState()
    // -------------------------------------------------------------------------
    describe('awaitRefundState()', () => {
        it('throws synchronously when refundId is empty', () => {
            // Consistent with awaitChargeState/awaitPaymentStatus, which are not
            // async and so surface an invalid argument before any polling starts.
            expect(() => refunds.awaitRefundState('')).toThrow(
                'refundId is required',
            );
        });

        it('resolves when the refund is already SUCCESS on the first poll', async () => {
            fetchMock.mockResolvedValue(
                makeResponse({ ...mockRefundDetails, state: 'SUCCESS' }),
            );

            const result = await refunds.awaitRefundState('ref_100000001', {
                intervalMs: 10,
            });

            expect(result.state).toBe('SUCCESS');
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        it('keeps polling while the refund is REQUESTED', async () => {
            fetchMock
                .mockResolvedValueOnce(
                    makeResponse({ ...mockRefundDetails, state: 'REQUESTED' }),
                )
                .mockResolvedValueOnce(
                    makeResponse({ ...mockRefundDetails, state: 'REQUESTED' }),
                )
                .mockResolvedValueOnce(
                    makeResponse({ ...mockRefundDetails, state: 'SUCCESS' }),
                );

            const result = await refunds.awaitRefundState('ref_100000001', {
                intervalMs: 10,
            });

            expect(result.state).toBe('SUCCESS');
            expect(fetchMock).toHaveBeenCalledTimes(3);
        });

        it('resolves rather than rejects on FAILED, since it is a real outcome', async () => {
            fetchMock.mockResolvedValue(
                makeResponse({ ...mockRefundDetails, state: 'FAILED' }),
            );

            const result = await refunds.awaitRefundState('ref_100000001', {
                intervalMs: 10,
            });

            expect(result.state).toBe('FAILED');
        });

        it('does not treat payment states as terminal for a refund', async () => {
            // The shared poller defaults to payment states (PAID, REFUNDED, …);
            // a refund must only settle on SUCCESS or FAILED.
            fetchMock
                .mockResolvedValueOnce(
                    makeResponse({ ...mockRefundDetails, state: 'REFUNDED' }),
                )
                .mockResolvedValueOnce(
                    makeResponse({ ...mockRefundDetails, state: 'SUCCESS' }),
                );

            const result = await refunds.awaitRefundState('ref_100000001', {
                intervalMs: 10,
            });

            expect(result.state).toBe('SUCCESS');
            expect(fetchMock).toHaveBeenCalledTimes(2);
        });

        it('reports every poll through onStateChange', async () => {
            fetchMock
                .mockResolvedValueOnce(
                    makeResponse({ ...mockRefundDetails, state: 'REQUESTED' }),
                )
                .mockResolvedValueOnce(
                    makeResponse({ ...mockRefundDetails, state: 'SUCCESS' }),
                );
            const seen: string[] = [];

            await refunds.awaitRefundState('ref_100000001', {
                intervalMs: 10,
                onStateChange: (refund) => seen.push(refund.state as string),
            });

            expect(seen).toEqual(['REQUESTED', 'SUCCESS']);
        });

        it('rejects when the abort signal is already aborted', async () => {
            const controller = new AbortController();
            controller.abort();

            await expect(
                refunds.awaitRefundState('ref_100000001', {
                    intervalMs: 10,
                    signal: controller.signal,
                }),
            ).rejects.toBeInstanceOf(GoPaySDKError);
        });

        it('honours a caller-supplied terminalStates override', async () => {
            fetchMock.mockResolvedValue(
                makeResponse({ ...mockRefundDetails, state: 'REQUESTED' }),
            );

            const result = await refunds.awaitRefundState('ref_100000001', {
                intervalMs: 10,
                terminalStates: ['REQUESTED'],
            });

            expect(result.state).toBe('REQUESTED');
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });
    });
});
