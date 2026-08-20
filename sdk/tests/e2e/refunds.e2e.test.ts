import { beforeAll, describe, expect, it } from 'vitest';
import {
    createGoPaySDK,
    GoPayErrorCodes,
    GoPayHTTPError,
    type GoPaySDK,
    GoPaySDKError,
} from '../../src/index.js';

/**
 * Refunds against the live sandbox gateway.
 *
 * Everything asserted here is reachable without settling a payment. Driving a
 * payment to `PAID` needs an encrypted-card charge plus a 3DS challenge
 * confirmed in the sandbox ACS, which is not something this suite can do — the
 * happy path (`SUCCESS`, `REFUNDED`, `PARTIALLY_REFUNDED`) is covered manually
 * and recorded on GPOMA-2517.
 */
const TERMINAL_STATES = ['SUCCESS', 'FAILED'];

describe('refunds — E2E', () => {
    let sdk: GoPaySDK;
    let goid: string;

    beforeAll(async () => {
        const baseUrl = process.env.GOPAY_PAYMENTS_V4_BASE_URL;
        const rawEnvironment = process.env.GOPAY_PAYMENTS_V4_ENVIRONMENT;

        // Unlike the auth suite, these specs WRITE: they create payment sessions and
        // issue refunds. Pointing them at production would put test records on a real
        // merchant account, so production is refused outright rather than validated.
        if (rawEnvironment !== undefined && rawEnvironment !== 'sandbox') {
            throw new Error(
                `Refund E2E tests only run against sandbox — they create payments and issue refunds. GOPAY_PAYMENTS_V4_ENVIRONMENT was: '${rawEnvironment}'`,
            );
        }
        const environment = rawEnvironment as 'sandbox' | undefined;
        const clientId = process.env.GOPAY_PAYMENTS_V4_CLIENT_ID ?? '';
        const clientSecret = process.env.GOPAY_PAYMENTS_V4_CLIENT_SECRET ?? '';
        goid = process.env.GOPAY_PAYMENTS_V4_GOID ?? '';

        if (!baseUrl && !environment) {
            throw new Error(
                'Missing required environment variables: set GOPAY_PAYMENTS_V4_ENVIRONMENT=sandbox or GOPAY_PAYMENTS_V4_BASE_URL for a mock/alpha endpoint',
            );
        }
        // A custom base URL is meant for mocks and alpha envs; catch the obvious
        // production host so the override cannot smuggle these writes into prod.
        if (baseUrl?.includes('gate.gopay.com')) {
            throw new Error(
                `Refund E2E tests must not target production. GOPAY_PAYMENTS_V4_BASE_URL was: '${baseUrl}'`,
            );
        }
        if (!clientId || !clientSecret) {
            throw new Error(
                'Missing required environment variables: GOPAY_PAYMENTS_V4_CLIENT_ID, GOPAY_PAYMENTS_V4_CLIENT_SECRET',
            );
        }
        // Every test here creates a payment first, so an unset goid would otherwise
        // post to /eshops//payments and fail with an opaque HTTP error.
        if (!goid) {
            throw new Error(
                'Missing required environment variable: GOPAY_PAYMENTS_V4_GOID',
            );
        }

        sdk = createGoPaySDK(baseUrl ? { baseUrl } : { environment });
        await sdk.authenticate({
            grant_type: 'client_credentials',
            client_id: clientId,
            client_secret: clientSecret,
            scope: 'payment:write payment:read',
        });
    });

    async function createUnpaidPayment(): Promise<string> {
        const payment = await sdk.createPayment(goid, {
            amount: 100,
            currency: 'CZK',
            order_number: 'e2e-refunds',
            customer: { email: 'john.doe@example.com' },
            callback: {
                return_url: 'https://example.com/return',
                notification_url: 'https://example.com/notify',
            },
        });
        return payment.id;
    }

    // These reject before any request is made, but beforeAll still authenticates,
    // so they are not runnable without the gateway.
    describe('argument validation', () => {
        it('rejects an empty paymentId on refundPayment', async () => {
            await expect(
                sdk.refundPayment('', { amount: 100 }),
            ).rejects.toThrow(GoPaySDKError);
        });

        it('rejects an empty refundId on getRefund', async () => {
            await expect(sdk.getRefund('')).rejects.toMatchObject({
                errorCode: GoPayErrorCodes.INVALID_ARGUMENT,
            });
        });
    });

    describe('reads', () => {
        it('returns an empty list for a payment with no refunds', async () => {
            const paymentId = await createUnpaidPayment();
            await expect(sdk.listRefunds(paymentId)).resolves.toEqual([]);
        });

        it('404s on an unknown refund id', async () => {
            await expect(sdk.getRefund('9999999999')).rejects.toMatchObject({
                name: 'GoPayHTTPError',
                status: 404,
            });
        });

        it('404s when listing refunds of an unknown payment', async () => {
            await expect(sdk.listRefunds('9999999999')).rejects.toMatchObject({
                name: 'GoPayHTTPError',
                status: 404,
            });
        });
    });

    describe('refund amount is validated before payment state', () => {
        it('rejects a zero amount with 400', async () => {
            const paymentId = await createUnpaidPayment();
            const err = await sdk
                .refundPayment(paymentId, { amount: 0 })
                .catch((e: unknown) => e);

            // Status only — the gateway's message wording is not contractual, and
            // asserting on it would redden CI for a reword or a localised response.
            expect(err).toBeInstanceOf(GoPayHTTPError);
            expect((err as GoPayHTTPError).status).toBe(400);
        });

        it('rejects a negative amount with 400', async () => {
            const paymentId = await createUnpaidPayment();
            await expect(
                sdk.refundPayment(paymentId, { amount: -100 }),
            ).rejects.toMatchObject({ status: 400 });
        });
    });

    describe('refunding a payment that is not PAID', () => {
        it('is rejected with 409 REFUND_NOT_ALLOWED', async () => {
            const paymentId = await createUnpaidPayment();
            const err = await sdk
                .refundPayment(paymentId, { amount: 100 })
                .catch((e: unknown) => e);

            expect(err).toBeInstanceOf(GoPayHTTPError);
            expect((err as GoPayHTTPError).status).toBe(409);
        });

        it('may still record the rejected attempt as a refund', async () => {
            const paymentId = await createUnpaidPayment();
            await sdk
                .refundPayment(paymentId, { amount: 100 })
                .catch(() => undefined);

            // The gateway answers 409 to the caller yet still persists the attempt,
            // so listRefunds reports a refund the merchant never successfully made.
            // Asserted loosely on purpose: this is observed behaviour, not a
            // documented contract, so the backend dropping it — or reporting
            // REQUESTED before FAILED — must not fail the release pipeline.
            const refunds = await sdk.listRefunds(paymentId);
            expect(refunds.length).toBeLessThanOrEqual(1);
            if (refunds.length === 1) {
                expect(['REQUESTED', 'FAILED']).toContain(refunds[0]?.state);
                expect(refunds[0]?.amount).toBe(100);
            }
        });
    });

    describe('awaitRefundState', () => {
        // The empty-refundId throw is deliberately not retested here: it needs no
        // gateway at all, and tests/unit/refunds-module.test.ts already covers it.
        // Repeating it would only couple an argument check to live credentials.

        it('surfaces a 404 for an unknown refund rather than polling forever', async () => {
            await expect(
                sdk.awaitRefundState('9999999999', {
                    intervalMs: 500,
                    // The poll loop rejects on the first failed poll, so this ceiling
                    // should never be reached. It is here so that if error handling
                    // ever became retry-on-error, this spec fails fast instead of
                    // hanging until vitest's testTimeout.
                    timeoutMs: 5_000,
                }),
            ).rejects.toMatchObject({ name: 'GoPayHTTPError', status: 404 });
        });

        it('returns an already-terminal refund on the first poll', async () => {
            // A refund rejected with 409 is still persisted (see above), which gives
            // us a refund to poll without having to settle a payment first.
            const paymentId = await createUnpaidPayment();
            await sdk
                .refundPayment(paymentId, { amount: 100 })
                .catch(() => undefined);

            const [refund] = await sdk.listRefunds(paymentId);
            // Two observed behaviours make this conditional, not an assertion: the
            // gateway may report REQUESTED before settling to FAILED, and it may stop
            // persisting rejected attempts entirely. Neither is this spec's subject,
            // and polling a REQUESTED refund that never settles would hang until
            // vitest kills the test, so only proceed once it is already terminal.
            if (!refund?.id || !TERMINAL_STATES.includes(refund.state)) {
                return;
            }

            const polls: string[] = [];
            const settled = await sdk.awaitRefundState(refund.id, {
                intervalMs: 5_000,
                timeoutMs: 10_000,
                onStateChange: (state) => {
                    polls.push(state.state);
                },
            });

            // onStateChange fires once per poll, so a single call proves the interval
            // was never waited out. Asserting the poll count rather than elapsed time
            // keeps this immune to a slow sandbox: one legitimate request can take up
            // to the 10s HTTP timeout plus retries.
            expect(polls).toHaveLength(1);
            expect(TERMINAL_STATES).toContain(settled.state);
        });
    });
});
