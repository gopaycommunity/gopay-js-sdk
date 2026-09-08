import { createHttpClient } from '@gopay-internal/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoPayErrorCodes, GoPaySDKError } from '../../src/errors.js';
import { createRecurrencesApi } from '../../src/modules/recurrences/recurrences.module.js';
import { makeEmptyResponse, makeResponse } from './helpers.js';

const GOID = '8123456789';
const REC_ID = '8008013370';

// `as const` so `currency` keeps its literal type: inferred as `string` it does
// not satisfy the Currency union, which sdk/tsconfig.tests.json now checks.
const mockPayment = {
    amount: 1500,
    currency: 'CZK',
    order_number: '2025010199',
    order_description: 'Monthly subscription',
    customer: { email: 'john.doe@example.com' },
    callback: {
        notification_url: 'https://example.com/notify',
        return_url: 'https://example.com/return',
    },
} as const;

const mockRecurrenceDetails = {
    id: REC_ID,
    type: 'ON_DEMAND',
    state: 'NEW',
    recurrence_date_to: '2027-09-04',
    payment: {
        amount: 1500,
        currency: 'CZK',
        order_number: '2025010199',
        customer: { email: 'john.doe@example.com' },
    },
};

const mockPaymentDetails = {
    id: '7310142951',
    order_number: '2025010199',
    state: 'CREATED',
    amount: 1500,
    currency: 'CZK',
    customer: { email: 'john.doe@example.com' },
    gw_url: 'https://gate.gopay.com/gw/123456789',
    payment_secret: 'sec_abc123',
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
        client.setToken({
            access_token: 'test-token',
            expires_in: 3600,
            token_type: 'bearer',
        });
        recurrences = createRecurrencesApi(client);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    // -------------------------------------------------------------------------
    // createRecurrence()
    // -------------------------------------------------------------------------

    describe('createRecurrence()', () => {
        it('sends POST to /eshops/{goid}/recurrences', async () => {
            let capturedReq!: Request;
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                await req.text();
                return makeResponse(mockRecurrenceDetails, 201, 'Created');
            });

            await recurrences.createRecurrence(GOID, {
                type: 'ON_DEMAND',
                recurrence_date_to: '2027-09-04',
                payment: mockPayment,
            });

            expect(capturedReq.method).toBe('POST');
            expect(capturedReq.url).toBe(
                `https://example.com/eshops/${GOID}/recurrences`,
            );
        });

        it('sends an ON_DEMAND recurrence without a schedule', async () => {
            let capturedBody = '';
            fetchMock.mockImplementation(async (req: Request) => {
                capturedBody = await req.text();
                return makeResponse(mockRecurrenceDetails, 201, 'Created');
            });

            await recurrences.createRecurrence(GOID, {
                type: 'ON_DEMAND',
                recurrence_date_to: '2027-09-04',
                payment: mockPayment,
            });

            const body = JSON.parse(capturedBody);
            expect(body).not.toHaveProperty('schedule');
            expect(body.type).toBe('ON_DEMAND');
            expect(body.recurrence_date_to).toBe('2027-09-04');
        });

        it('sends an AUTO recurrence with its schedule', async () => {
            let capturedBody = '';
            fetchMock.mockImplementation(async (req: Request) => {
                capturedBody = await req.text();
                return makeResponse(mockRecurrenceDetails, 201, 'Created');
            });

            await recurrences.createRecurrence(GOID, {
                type: 'AUTO',
                schedule: { period: 'MONTH', cycle: 1 },
                recurrence_date_to: '2027-09-04',
                payment: mockPayment,
            });

            expect(JSON.parse(capturedBody)).toEqual({
                type: 'AUTO',
                schedule: { period: 'MONTH', cycle: 1 },
                recurrence_date_to: '2027-09-04',
                payment: mockPayment,
            });
        });

        it('sends Bearer token', async () => {
            let capturedReq!: Request;
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                await req.text();
                return makeResponse(mockRecurrenceDetails, 201, 'Created');
            });

            await recurrences.createRecurrence(GOID, {
                type: 'ON_DEMAND',
                recurrence_date_to: '2027-09-04',
                payment: mockPayment,
            });

            expect(capturedReq.headers.get('Authorization')).toBe(
                'Bearer test-token',
            );
        });

        it('returns the recurrence details', async () => {
            const result = await recurrences.createRecurrence(GOID, {
                type: 'ON_DEMAND',
                recurrence_date_to: '2027-09-04',
                payment: mockPayment,
            });
            expect(result).toEqual(mockRecurrenceDetails);
        });

        it('throws INVALID_ARGUMENT when goid is empty', async () => {
            const err = await recurrences
                .createRecurrence('', {
                    type: 'ON_DEMAND',
                    recurrence_date_to: '2027-09-04',
                    payment: mockPayment,
                })
                .catch((e: unknown) => e);
            expect(err).toBeInstanceOf(GoPaySDKError);
            expect((err as GoPaySDKError).errorCode).toBe(
                GoPayErrorCodes.INVALID_ARGUMENT,
            );
            expect(fetchMock).not.toHaveBeenCalled();
        });
    });

    // -------------------------------------------------------------------------
    // getRecurrence()
    // -------------------------------------------------------------------------

    describe('getRecurrence()', () => {
        it('sends GET to /recurrences/{recId}', async () => {
            let capturedReq!: Request;
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                return makeResponse(mockRecurrenceDetails);
            });

            await recurrences.getRecurrence(REC_ID);

            expect(capturedReq.method).toBe('GET');
            expect(capturedReq.url).toBe(
                `https://example.com/recurrences/${REC_ID}`,
            );
        });

        it('returns recurrence details', async () => {
            const result = await recurrences.getRecurrence(REC_ID);
            expect(result).toEqual(mockRecurrenceDetails);
        });

        it('reports a stopped recurrence with its stop_reason', async () => {
            fetchMock.mockResolvedValue(
                makeResponse({
                    ...mockRecurrenceDetails,
                    state: 'STOPPED',
                    stop_reason: 'CANCELLED_VIA_API',
                }),
            );

            const result = await recurrences.getRecurrence(REC_ID);

            expect(result.state).toBe('STOPPED');
            expect(result.stop_reason).toBe('CANCELLED_VIA_API');
        });

        it('throws INVALID_ARGUMENT when recId is empty', async () => {
            const err = await recurrences
                .getRecurrence('')
                .catch((e: unknown) => e);
            expect(err).toBeInstanceOf(GoPaySDKError);
            expect((err as GoPaySDKError).errorCode).toBe(
                GoPayErrorCodes.INVALID_ARGUMENT,
            );
            expect(fetchMock).not.toHaveBeenCalled();
        });
    });

    // -------------------------------------------------------------------------
    // startRecurrence()
    // -------------------------------------------------------------------------

    describe('startRecurrence()', () => {
        it('sends POST to /recurrences/{recId}/start', async () => {
            let capturedReq!: Request;
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                await req.text();
                return makeResponse(mockPaymentDetails, 201, 'Created');
            });

            await recurrences.startRecurrence(REC_ID);

            expect(capturedReq.method).toBe('POST');
            expect(capturedReq.url).toBe(
                `https://example.com/recurrences/${REC_ID}/start`,
            );
        });

        it('returns the created payment, with gw_url and payment_secret', async () => {
            fetchMock.mockResolvedValue(
                makeResponse(mockPaymentDetails, 201, 'Created'),
            );

            const result = await recurrences.startRecurrence(REC_ID);

            expect(result.gw_url).toBe('https://gate.gopay.com/gw/123456789');
            expect(result.payment_secret).toBe('sec_abc123');
        });

        it('sends the override as the JSON body when given', async () => {
            let capturedBody = '';
            fetchMock.mockImplementation(async (req: Request) => {
                capturedBody = await req.text();
                return makeResponse(mockPaymentDetails, 201, 'Created');
            });

            await recurrences.startRecurrence(REC_ID, {
                amount: 9900,
                customer: { first_name: 'Jane' },
            });

            expect(JSON.parse(capturedBody)).toEqual({
                amount: 9900,
                customer: { first_name: 'Jane' },
            });
        });

        it('throws INVALID_ARGUMENT when recId is empty', async () => {
            const err = await recurrences
                .startRecurrence('')
                .catch((e: unknown) => e);
            expect(err).toBeInstanceOf(GoPaySDKError);
            expect((err as GoPaySDKError).errorCode).toBe(
                GoPayErrorCodes.INVALID_ARGUMENT,
            );
            expect(fetchMock).not.toHaveBeenCalled();
        });
    });

    // -------------------------------------------------------------------------
    // createNextPayment()
    // -------------------------------------------------------------------------

    describe('createNextPayment()', () => {
        it('sends POST to /recurrences/{recId}/next', async () => {
            let capturedReq!: Request;
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                await req.text();
                return makeResponse(mockPaymentDetails, 201, 'Created');
            });

            await recurrences.createNextPayment(REC_ID);

            expect(capturedReq.method).toBe('POST');
            expect(capturedReq.url).toBe(
                `https://example.com/recurrences/${REC_ID}/next`,
            );
        });

        it('sends the override as the JSON body when given', async () => {
            let capturedBody = '';
            fetchMock.mockImplementation(async (req: Request) => {
                capturedBody = await req.text();
                return makeResponse(mockPaymentDetails, 201, 'Created');
            });

            await recurrences.createNextPayment(REC_ID, {
                amount: 2500,
                order_number: '2025010200',
            });

            expect(JSON.parse(capturedBody)).toEqual({
                amount: 2500,
                order_number: '2025010200',
            });
        });

        it('returns the created payment', async () => {
            fetchMock.mockResolvedValue(
                makeResponse(mockPaymentDetails, 201, 'Created'),
            );

            const result = await recurrences.createNextPayment(REC_ID);

            expect(result).toEqual(mockPaymentDetails);
        });

        it('throws INVALID_ARGUMENT when recId is empty', async () => {
            const err = await recurrences
                .createNextPayment('')
                .catch((e: unknown) => e);
            expect(err).toBeInstanceOf(GoPaySDKError);
            expect((err as GoPaySDKError).errorCode).toBe(
                GoPayErrorCodes.INVALID_ARGUMENT,
            );
            expect(fetchMock).not.toHaveBeenCalled();
        });
    });

    // -------------------------------------------------------------------------
    // stopRecurrence()
    // -------------------------------------------------------------------------

    describe('stopRecurrence()', () => {
        it('sends DELETE to /recurrences/{recId}', async () => {
            let capturedReq!: Request;
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                return makeEmptyResponse();
            });

            await recurrences.stopRecurrence(REC_ID);

            expect(capturedReq.method).toBe('DELETE');
            expect(capturedReq.url).toBe(
                `https://example.com/recurrences/${REC_ID}`,
            );
        });

        it('resolves with no value on 204', async () => {
            fetchMock.mockResolvedValue(makeEmptyResponse());

            await expect(
                recurrences.stopRecurrence(REC_ID),
            ).resolves.toBeUndefined();
        });

        it('throws INVALID_ARGUMENT when recId is empty', async () => {
            const err = await recurrences
                .stopRecurrence('')
                .catch((e: unknown) => e);
            expect(err).toBeInstanceOf(GoPaySDKError);
            expect((err as GoPaySDKError).errorCode).toBe(
                GoPayErrorCodes.INVALID_ARGUMENT,
            );
            expect(fetchMock).not.toHaveBeenCalled();
        });
    });

    // -------------------------------------------------------------------------
    // awaitRecurrenceState()
    // -------------------------------------------------------------------------

    describe('awaitRecurrenceState()', () => {
        it('throws synchronously when recId is empty', () => {
            // Consistent with awaitChargeState/awaitRefundState, which are not
            // async and so surface an invalid argument before any polling starts.
            expect(() => recurrences.awaitRecurrenceState('')).toThrow(
                'recId is required',
            );
        });

        it('resolves when the recurrence is already STARTED on the first poll', async () => {
            fetchMock.mockResolvedValue(
                makeResponse({ ...mockRecurrenceDetails, state: 'STARTED' }),
            );

            const result = await recurrences.awaitRecurrenceState(REC_ID, {
                intervalMs: 10,
            });

            expect(result.state).toBe('STARTED');
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        it('keeps polling while the recurrence is NEW or REQUESTED', async () => {
            // REQUESTED means the first payment exists but the customer has not
            // paid it yet — the whole reason this helper exists.
            fetchMock
                .mockResolvedValueOnce(
                    makeResponse({ ...mockRecurrenceDetails, state: 'NEW' }),
                )
                .mockResolvedValueOnce(
                    makeResponse({
                        ...mockRecurrenceDetails,
                        state: 'REQUESTED',
                    }),
                )
                .mockResolvedValueOnce(
                    makeResponse({
                        ...mockRecurrenceDetails,
                        state: 'STARTED',
                    }),
                );

            const result = await recurrences.awaitRecurrenceState(REC_ID, {
                intervalMs: 10,
            });

            expect(result.state).toBe('STARTED');
            expect(fetchMock).toHaveBeenCalledTimes(3);
        });

        it('resolves rather than rejects on STOPPED, since it is a real outcome', async () => {
            fetchMock.mockResolvedValue(
                makeResponse({
                    ...mockRecurrenceDetails,
                    state: 'STOPPED',
                    stop_reason: 'CANCELLED_VIA_API',
                }),
            );

            const result = await recurrences.awaitRecurrenceState(REC_ID, {
                intervalMs: 10,
            });

            expect(result.state).toBe('STOPPED');
            expect(result.stop_reason).toBe('CANCELLED_VIA_API');
        });

        it('does not treat payment states as terminal for a recurrence', async () => {
            // The shared poller defaults to payment states (PAID, REFUNDED, …);
            // a recurrence must only settle on STARTED or STOPPED. PAID here is
            // realistic: Recurrence-Payment carries the payment's own state.
            fetchMock
                .mockResolvedValueOnce(
                    makeResponse({ ...mockRecurrenceDetails, state: 'PAID' }),
                )
                .mockResolvedValueOnce(
                    makeResponse({
                        ...mockRecurrenceDetails,
                        state: 'STARTED',
                    }),
                );

            const result = await recurrences.awaitRecurrenceState(REC_ID, {
                intervalMs: 10,
            });

            expect(result.state).toBe('STARTED');
            expect(fetchMock).toHaveBeenCalledTimes(2);
        });

        it('reports every poll through onStateChange', async () => {
            fetchMock
                .mockResolvedValueOnce(
                    makeResponse({
                        ...mockRecurrenceDetails,
                        state: 'REQUESTED',
                    }),
                )
                .mockResolvedValueOnce(
                    makeResponse({
                        ...mockRecurrenceDetails,
                        state: 'STARTED',
                    }),
                );
            const seen: string[] = [];

            await recurrences.awaitRecurrenceState(REC_ID, {
                intervalMs: 10,
                onStateChange: (rec) => seen.push(rec.state as string),
            });

            expect(seen).toEqual(['REQUESTED', 'STARTED']);
        });

        it('rejects when the abort signal is already aborted', async () => {
            const controller = new AbortController();
            controller.abort();

            await expect(
                recurrences.awaitRecurrenceState(REC_ID, {
                    intervalMs: 10,
                    signal: controller.signal,
                }),
            ).rejects.toBeInstanceOf(GoPaySDKError);
        });

        it('honours a caller-supplied terminalStates override', async () => {
            fetchMock.mockResolvedValue(
                makeResponse({
                    ...mockRecurrenceDetails,
                    state: 'REQUESTED',
                }),
            );

            const result = await recurrences.awaitRecurrenceState(REC_ID, {
                intervalMs: 10,
                terminalStates: ['REQUESTED'],
            });

            expect(result.state).toBe('REQUESTED');
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });
    });
});
