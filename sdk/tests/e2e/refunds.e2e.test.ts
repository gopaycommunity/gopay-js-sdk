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
describe('refunds — E2E', () => {
    let sdk: GoPaySDK;
    let goid: string;

    beforeAll(async () => {
        const baseUrl = process.env.GOPAY_PAYMENTS_V4_BASE_URL;
        const environment = process.env.GOPAY_PAYMENTS_V4_ENVIRONMENT as
            | 'sandbox'
            | 'production'
            | undefined;
        const clientId = process.env.GOPAY_PAYMENTS_V4_CLIENT_ID ?? '';
        const clientSecret = process.env.GOPAY_PAYMENTS_V4_CLIENT_SECRET ?? '';
        goid = process.env.GOPAY_PAYMENTS_V4_GOID ?? '';

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
        return payment.id as string;
    }

    describe('argument validation (no network)', () => {
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

            expect(err).toBeInstanceOf(GoPayHTTPError);
            expect((err as GoPayHTTPError).status).toBe(400);
            expect(
                ((err as GoPayHTTPError).body as { message?: string }).message,
            ).toMatch(/must be positive/i);
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

        it('still records the rejected attempt as a FAILED refund', async () => {
            const paymentId = await createUnpaidPayment();
            await sdk
                .refundPayment(paymentId, { amount: 100 })
                .catch(() => undefined);

            // The gateway answers 409 to the caller but persists the attempt,
            // so the payment ends up owning a FAILED refund it never asked for.
            const refunds = await sdk.listRefunds(paymentId);
            expect(refunds).toHaveLength(1);
            expect(refunds[0]?.state).toBe('FAILED');
            expect(refunds[0]?.amount).toBe(100);
        });
    });
});
