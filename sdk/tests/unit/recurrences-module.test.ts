import { createHttpClient } from '@gopay-internal/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRecurrencesApi } from '../../src/modules/recurrences/recurrences.module.js';

const makeResponse = (data: unknown, status = 200, statusText = 'OK') =>
    new Response(JSON.stringify(data), {
        status,
        statusText,
        headers: { 'content-type': 'application/json' },
    });

const makeEmptyResponse = (status = 204) =>
    new Response(null, { status, statusText: 'No Content' });

const mockRecurrenceDetails = {
    id: 'rec_100000001',
    type: 'ON_DEMAND',
    state: 'NEW',
    payment: {
        amount: 1000,
        currency: 'CZK',
        order_number: 'ORDER-REC-001',
        customer: { email: 'customer@example.com' },
        callback: {
            notification_url: 'https://shop.example.com/notify',
            return_url: 'https://shop.example.com/return',
        },
    },
};

const mockPaymentDetails = {
    id: 'pay_300000001',
    order_number: 'ORDER-REC-001',
    state: 'CREATED',
    amount: 1000,
    currency: 'CZK',
};

const createParams = {
    type: 'ON_DEMAND' as const,
    payment: {
        amount: 1000,
        currency: 'CZK' as const,
        order_number: 'ORDER-REC-001',
        customer: { email: 'customer@example.com' },
        callback: {
            notification_url: 'https://shop.example.com/notify',
            return_url: 'https://shop.example.com/return',
        },
    },
};

const nextParams = {
    amount: 1000,
    order_number: 'ORDER-REC-002',
};

describe('RecurrencesModule', () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    let client: ReturnType<typeof createHttpClient>;
    let recurrences: ReturnType<typeof createRecurrencesApi>;

    beforeEach(() => {
        fetchMock = vi
            .fn()
            .mockResolvedValue(makeResponse(mockRecurrenceDetails));
        vi.stubGlobal('fetch', fetchMock);
        client = createHttpClient({ baseUrl: 'https://example.com' });
        client.tokenStore.set({
            access_token: 'at-test',
            refresh_token: 'rt-test',
            expires_in: 900,
            refresh_expires_in: 86400,
            token_type: 'bearer',
        });
        recurrences = createRecurrencesApi(client);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('createRecurrence()', () => {
        it('sends POST to /eshops/{goid}/recurrences', async () => {
            let capturedReq!: Request;
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                await req.text();
                return makeResponse(mockRecurrenceDetails, 201);
            });

            await recurrences.createRecurrence('goid-123', createParams);

            expect(capturedReq.method).toBe('POST');
            expect(capturedReq.url).toBe(
                'https://example.com/eshops/goid-123/recurrences',
            );
        });

        it('sends JSON body with recurrence params', async () => {
            let capturedBody = '';
            fetchMock.mockImplementation(async (req: Request) => {
                capturedBody = await req.text();
                return makeResponse(mockRecurrenceDetails, 201);
            });

            await recurrences.createRecurrence('goid-123', createParams);

            expect(JSON.parse(capturedBody)).toEqual(createParams);
        });

        it('sends Bearer token', async () => {
            let capturedReq!: Request;
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                await req.text();
                return makeResponse(mockRecurrenceDetails, 201);
            });

            await recurrences.createRecurrence('goid-123', createParams);

            expect(capturedReq.headers.get('Authorization')).toBe(
                'Bearer at-test',
            );
        });

        it('returns recurrence details', async () => {
            fetchMock.mockResolvedValue(
                makeResponse(mockRecurrenceDetails, 201),
            );

            const result = await recurrences.createRecurrence(
                'goid-123',
                createParams,
            );

            expect(result).toEqual(mockRecurrenceDetails);
            expect(result.id).toBe('rec_100000001');
        });
    });

    describe('recurrenceStatus()', () => {
        it('throws when recId is empty', async () => {
            await expect(recurrences.recurrenceStatus('')).rejects.toThrow(
                'recId is required',
            );
        });

        it('sends GET to /recurrences/{rec_id}', async () => {
            let capturedReq!: Request;
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                return makeResponse(mockRecurrenceDetails);
            });

            await recurrences.recurrenceStatus('rec_100000001');

            expect(capturedReq.method).toBe('GET');
            expect(capturedReq.url).toBe(
                'https://example.com/recurrences/rec_100000001',
            );
        });

        it('returns recurrence details', async () => {
            const result = await recurrences.recurrenceStatus('rec_100000001');

            expect(result).toEqual(mockRecurrenceDetails);
        });
    });

    describe('stopRecurrence()', () => {
        it('throws when recId is empty', async () => {
            await expect(recurrences.stopRecurrence('')).rejects.toThrow(
                'recId is required',
            );
        });

        it('sends DELETE to /recurrences/{rec_id}', async () => {
            let capturedReq!: Request;
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                return makeEmptyResponse();
            });

            await recurrences.stopRecurrence('rec_100000001');

            expect(capturedReq.method).toBe('DELETE');
            expect(capturedReq.url).toBe(
                'https://example.com/recurrences/rec_100000001',
            );
        });

        it('resolves void', async () => {
            fetchMock.mockResolvedValue(makeEmptyResponse());

            const result = await recurrences.stopRecurrence('rec_100000001');

            expect(result).toBeUndefined();
        });
    });

    describe('startRecurrence()', () => {
        beforeEach(() => {
            fetchMock.mockResolvedValue(makeResponse(mockPaymentDetails, 201));
        });

        it('throws when recId is empty', async () => {
            await expect(recurrences.startRecurrence('')).rejects.toThrow(
                'recId is required',
            );
        });

        it('sends POST to /recurrences/{rec_id}/start', async () => {
            let capturedReq!: Request;
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                await req.text();
                return makeResponse(mockPaymentDetails, 201);
            });

            await recurrences.startRecurrence('rec_100000001');

            expect(capturedReq.method).toBe('POST');
            expect(capturedReq.url).toBe(
                'https://example.com/recurrences/rec_100000001/start',
            );
        });

        it('sends optional body when provided', async () => {
            let capturedBody = '';
            fetchMock.mockImplementation(async (req: Request) => {
                capturedBody = await req.text();
                return makeResponse(mockPaymentDetails, 201);
            });

            await recurrences.startRecurrence('rec_100000001', nextParams);

            expect(JSON.parse(capturedBody)).toEqual(nextParams);
        });

        it('returns payment details', async () => {
            const result = await recurrences.startRecurrence('rec_100000001');

            expect(result).toEqual(mockPaymentDetails);
        });
    });

    describe('recurrenceNext()', () => {
        beforeEach(() => {
            fetchMock.mockResolvedValue(makeResponse(mockPaymentDetails, 201));
        });

        it('throws when recId is empty', async () => {
            await expect(recurrences.recurrenceNext('')).rejects.toThrow(
                'recId is required',
            );
        });

        it('sends POST to /recurrences/{rec_id}/next', async () => {
            let capturedReq!: Request;
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                await req.text();
                return makeResponse(mockPaymentDetails, 201);
            });

            await recurrences.recurrenceNext('rec_100000001', nextParams);

            expect(capturedReq.method).toBe('POST');
            expect(capturedReq.url).toBe(
                'https://example.com/recurrences/rec_100000001/next',
            );
        });

        it('sends JSON body with next-payment overrides', async () => {
            let capturedBody = '';
            fetchMock.mockImplementation(async (req: Request) => {
                capturedBody = await req.text();
                return makeResponse(mockPaymentDetails, 201);
            });

            await recurrences.recurrenceNext('rec_100000001', nextParams);

            expect(JSON.parse(capturedBody)).toEqual(nextParams);
        });

        it('returns payment details', async () => {
            const result = await recurrences.recurrenceNext(
                'rec_100000001',
                nextParams,
            );

            expect(result).toEqual(mockPaymentDetails);
        });
    });
});
