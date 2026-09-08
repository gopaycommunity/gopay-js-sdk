import { beforeAll, describe, expect, it } from 'vitest';
import {
    GoPayErrorCodes,
    GoPayHTTPError,
    type GoPaySDK,
    GoPaySDKError,
    type RecurrenceCreateRequest,
} from '../../src/index.js';
import { createSandboxSdk, paymentBody } from './_helpers.js';

/**
 * Recurrences against the live gateway.
 *
 * The one thing not reachable from here is `STARTED`: it requires a customer to
 * actually pay the first payment at its `gw_url`, which leaves the API for the
 * hosted gateway. Everything up to that point is, and the states either side of
 * the gap are the ones worth pinning — `REQUESTED` after a start, and the `409`
 * that `createNextPayment` answers until somebody pays.
 *
 * Note the endpoints are **not on sandbox** as of 2026-09-08 (they answer 404
 * `RESTEASY003210` there, indistinguishable from a path that does not exist);
 * they are routed on alpha8/alpha9 and on production. Point
 * `GOPAY_PAYMENTS_V4_BASE_URL` at an alpha env.
 */
describe('recurrences — E2E', () => {
    let sdk: GoPaySDK;
    let goid: string;

    // Two years out. Recomputed per run rather than pinned: a hardcoded date
    // silently starts failing with 400 the day it goes by.
    const dateTo = (() => {
        const d = new Date();
        d.setFullYear(d.getFullYear() + 2);
        return d.toISOString().slice(0, 10);
    })();

    const onDemand = (): RecurrenceCreateRequest => ({
        type: 'ON_DEMAND',
        recurrence_date_to: dateTo,
        payment: paymentBody('e2e-recurrences'),
    });

    /** A recurrence in NEW, freshly created for one test to use. */
    const freshRecurrence = async () =>
        await sdk.createRecurrence(goid, onDemand());

    beforeAll(async () => {
        ({ sdk, goid } = await createSandboxSdk(
            'create recurrences and their payments',
        ));
    });

    describe('argument validation', () => {
        it('rejects an empty goid on createRecurrence', async () => {
            await expect(sdk.createRecurrence('', onDemand())).rejects.toThrow(
                GoPaySDKError,
            );
        });

        it('rejects an empty recId on getRecurrence', async () => {
            await expect(sdk.getRecurrence('')).rejects.toMatchObject({
                errorCode: GoPayErrorCodes.INVALID_ARGUMENT,
            });
        });

        it('rejects an empty recId on startRecurrence', async () => {
            await expect(sdk.startRecurrence('')).rejects.toMatchObject({
                errorCode: GoPayErrorCodes.INVALID_ARGUMENT,
            });
        });

        it('rejects an empty recId on createNextPayment', async () => {
            await expect(sdk.createNextPayment('')).rejects.toMatchObject({
                errorCode: GoPayErrorCodes.INVALID_ARGUMENT,
            });
        });

        it('rejects an empty recId on stopRecurrence', async () => {
            await expect(sdk.stopRecurrence('')).rejects.toMatchObject({
                errorCode: GoPayErrorCodes.INVALID_ARGUMENT,
            });
        });
    });

    describe('createRecurrence', () => {
        it('creates an ON_DEMAND recurrence in NEW, with no schedule', async () => {
            const rec = await sdk.createRecurrence(goid, onDemand());

            expect(rec.id).toBeTruthy();
            expect(rec.type).toBe('ON_DEMAND');
            expect(rec.state).toBe('NEW');
            expect(rec.schedule).toBeUndefined();
            expect(rec.recurrence_date_to).toBe(dateTo);
            // The template is stored, not charged — no payment exists yet.
            expect(rec.payment.id).toBeUndefined();
            expect(rec.payment.state).toBeUndefined();
            expect(rec.payment.amount).toBe(100);
        });

        it('creates an AUTO recurrence and echoes its schedule', async () => {
            const rec = await sdk.createRecurrence(goid, {
                type: 'AUTO',
                schedule: { period: 'MONTH', cycle: 1 },
                recurrence_date_to: dateTo,
                payment: paymentBody('e2e-recurrences-auto'),
            });

            expect(rec.type).toBe('AUTO');
            expect(rec.state).toBe('NEW');
            expect(rec.schedule).toEqual({ period: 'MONTH', cycle: 1 });
        });

        it('400s when recurrence_date_to carries a time component', async () => {
            // The field is a plain yyyy-MM-dd date. Cast because the SDK's type
            // says `string` and cannot express the format — the point is that
            // the gateway is the one drawing the line.
            const err = await sdk
                .createRecurrence(goid, {
                    ...onDemand(),
                    recurrence_date_to: `${dateTo}T10:00:00Z`,
                })
                .catch((e: unknown) => e);

            expect(err).toBeInstanceOf(GoPayHTTPError);
            expect((err as GoPayHTTPError).status).toBe(400);
        });

        it('400s on a schedule sent with an ON_DEMAND recurrence', async () => {
            // The union makes this a compile error, so it needs a cast to reach
            // the wire. Asserted anyway: the type is a convenience, the server
            // rule is the contract, and a backend that started accepting this
            // would mean the union is now wrong.
            const body = {
                ...onDemand(),
                schedule: { period: 'MONTH', cycle: 1 },
            } as unknown as RecurrenceCreateRequest;

            const err = await sdk
                .createRecurrence(goid, body)
                .catch((e: unknown) => e);

            expect(err).toBeInstanceOf(GoPayHTTPError);
            expect((err as GoPayHTTPError).status).toBe(400);
        });

        it('400s on an AUTO recurrence with no schedule', async () => {
            const body = {
                type: 'AUTO',
                recurrence_date_to: dateTo,
                payment: paymentBody('e2e-recurrences-auto-noschedule'),
            } as unknown as RecurrenceCreateRequest;

            const err = await sdk
                .createRecurrence(goid, body)
                .catch((e: unknown) => e);

            expect(err).toBeInstanceOf(GoPayHTTPError);
            expect((err as GoPayHTTPError).status).toBe(400);
        });
    });

    describe('getRecurrence', () => {
        it('reads back the recurrence and its stored template', async () => {
            const created = await freshRecurrence();

            const read = await sdk.getRecurrence(created.id);

            expect(read.id).toBe(created.id);
            expect(read.state).toBe('NEW');
            expect(read.stop_reason).toBeUndefined();
            expect(read.payment.order_number).toBe('e2e-recurrences');
        });

        it('404s on an unknown recurrence id', async () => {
            await expect(sdk.getRecurrence('9999999999')).rejects.toMatchObject(
                { name: 'GoPayHTTPError', status: 404 },
            );
        });
    });

    describe('startRecurrence', () => {
        it('creates the first payment with no request body at all', async () => {
            // The override is optional, so the SDK posts with no body and only
            // a Content-Type header. That exact shape is what broke the PHP SDK
            // (it sent no header either, and the gateway answered 415 before
            // reaching the endpoint), so it is pinned here rather than assumed.
            const rec = await freshRecurrence();

            const payment = await sdk.startRecurrence(rec.id);

            expect(payment.id).toBeTruthy();
            expect(payment.gw_url).toMatch(/^https:\/\//);
            // Asserted for presence only — never logged, never compared.
            expect(payment.payment_secret).toBeTruthy();

            await sdk.stopRecurrence(rec.id);
        });

        it('leaves the recurrence REQUESTED, not STARTED', async () => {
            // STARTED needs the customer to pay that first payment. Everything
            // that depends on it — createNextPayment above all — is gated on
            // this distinction, so it is worth asserting explicitly.
            const rec = await freshRecurrence();
            await sdk.startRecurrence(rec.id);

            const read = await sdk.getRecurrence(rec.id);
            expect(read.state).toBe('REQUESTED');
            expect(read.payment.id).toBeTruthy();

            await sdk.stopRecurrence(rec.id);
        });

        it('applies an amount override to the created payment', async () => {
            const rec = await freshRecurrence();

            const payment = await sdk.startRecurrence(rec.id, { amount: 250 });

            expect(payment.amount).toBe(250);

            await sdk.stopRecurrence(rec.id);
        });

        it('merges a customer override field by field', async () => {
            // The stored template carries only an email; overriding first_name
            // must not drop it.
            const rec = await freshRecurrence();

            const payment = await sdk.startRecurrence(rec.id, {
                customer: { first_name: 'Jane' },
            });

            expect(payment.customer.first_name).toBe('Jane');
            expect(payment.customer.email).toBe('john.doe@example.com');

            await sdk.stopRecurrence(rec.id);
        });

        it('400s on an unknown field in the override', async () => {
            const rec = await freshRecurrence();

            const err = await sdk
                .startRecurrence(rec.id, {
                    nope: 'unknown',
                } as unknown as Parameters<typeof sdk.startRecurrence>[1])
                .catch((e: unknown) => e);

            expect(err).toBeInstanceOf(GoPayHTTPError);
            expect((err as GoPayHTTPError).status).toBe(400);

            await sdk.stopRecurrence(rec.id);
        });

        it('409s when the recurrence was already started', async () => {
            const rec = await freshRecurrence();
            await sdk.startRecurrence(rec.id);

            const err = await sdk
                .startRecurrence(rec.id)
                .catch((e: unknown) => e);

            expect(err).toBeInstanceOf(GoPayHTTPError);
            expect((err as GoPayHTTPError).status).toBe(409);

            await sdk.stopRecurrence(rec.id);
        });

        it('404s on an unknown recurrence id', async () => {
            await expect(
                sdk.startRecurrence('9999999999'),
            ).rejects.toMatchObject({ name: 'GoPayHTTPError', status: 404 });
        });
    });

    describe('createNextPayment', () => {
        it('409s until the customer has paid the first payment', async () => {
            // The whole reason awaitRecurrenceState exists: REQUESTED is not
            // good enough, and retrying will not help.
            const rec = await freshRecurrence();
            await sdk.startRecurrence(rec.id);

            const err = await sdk
                .createNextPayment(rec.id)
                .catch((e: unknown) => e);

            expect(err).toBeInstanceOf(GoPayHTTPError);
            expect((err as GoPayHTTPError).status).toBe(409);

            await sdk.stopRecurrence(rec.id);
        });

        it('409s on a recurrence that was never started', async () => {
            const rec = await freshRecurrence();

            const err = await sdk
                .createNextPayment(rec.id)
                .catch((e: unknown) => e);

            expect(err).toBeInstanceOf(GoPayHTTPError);
            expect((err as GoPayHTTPError).status).toBe(409);
        });
    });

    describe('stopRecurrence', () => {
        it('stops the recurrence and leaves it readable as CANCELLED_VIA_API', async () => {
            const rec = await freshRecurrence();

            await expect(sdk.stopRecurrence(rec.id)).resolves.toBeUndefined();

            // Stopping is not a delete — it must still read back.
            const read = await sdk.getRecurrence(rec.id);
            expect(read.state).toBe('STOPPED');
            expect(read.stop_reason).toBe('CANCELLED_VIA_API');
        });

        it('409s when the recurrence is already stopped', async () => {
            const rec = await freshRecurrence();
            await sdk.stopRecurrence(rec.id);

            const err = await sdk
                .stopRecurrence(rec.id)
                .catch((e: unknown) => e);

            expect(err).toBeInstanceOf(GoPayHTTPError);
            expect((err as GoPayHTTPError).status).toBe(409);
        });

        it('409s on starting a recurrence that was stopped', async () => {
            const rec = await freshRecurrence();
            await sdk.stopRecurrence(rec.id);

            const err = await sdk
                .startRecurrence(rec.id)
                .catch((e: unknown) => e);

            expect(err).toBeInstanceOf(GoPayHTTPError);
            expect((err as GoPayHTTPError).status).toBe(409);
        });

        it('404s on an unknown recurrence id', async () => {
            await expect(
                sdk.stopRecurrence('9999999999'),
            ).rejects.toMatchObject({ name: 'GoPayHTTPError', status: 404 });
        });
    });

    describe('awaitRecurrenceState', () => {
        it('rejects on a real recurrence still in NEW rather than polling it', async () => {
            // Only startRecurrence moves a recurrence out of NEW, so the guard
            // has to fire against the live state, not just a mocked one.
            const rec = await freshRecurrence();

            const err = await sdk
                .awaitRecurrenceState(rec.id, { intervalMs: 500 })
                .catch((e: unknown) => e);

            expect(err).toBeInstanceOf(GoPaySDKError);
            expect((err as GoPaySDKError).errorCode).toBe(
                GoPayErrorCodes.INVALID_ARGUMENT,
            );

            await sdk.stopRecurrence(rec.id);
        });

        it('resolves immediately on a recurrence that is already STOPPED', async () => {
            const rec = await freshRecurrence();
            await sdk.stopRecurrence(rec.id);

            const settled = await sdk.awaitRecurrenceState(rec.id, {
                intervalMs: 500,
                timeoutMs: 15_000,
            });

            // STOPPED resolves rather than rejects — a real outcome to inspect.
            expect(settled.state).toBe('STOPPED');
            expect(settled.stop_reason).toBe('CANCELLED_VIA_API');
        });
    });
});
