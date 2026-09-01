import { beforeAll, describe, expect, it } from 'vitest';
import {
    GoPayErrorCodes,
    GoPayHTTPError,
    type GoPaySDK,
    GoPaySDKError,
} from '../../src/index.js';
import { createSandboxSdk } from './_helpers.js';

/**
 * Payment links against the live gateway.
 *
 * The full lifecycle is reachable here without settling anything: a link is
 * only stored payment data, so create → read → disable → read needs no charge
 * and no 3DS. The one path left out is `stop_reason: 'USED'`, which requires a
 * customer to actually open the link's `url` in a browser — that hop leaves the
 * API and lands on the hosted gateway, so it is covered manually.
 */
describe('payment links — E2E', () => {
    let sdk: GoPaySDK;
    let goid: string;

    const linkPayment = {
        amount: 15000,
        currency: 'CZK' as const,
        order_number: 'e2e-links',
        customer: { email: 'john.doe@example.com' },
        callback: {
            return_url: 'https://example.com/return',
            notification_url: 'https://example.com/notify',
        },
    };

    beforeAll(async () => {
        ({ sdk, goid } = await createSandboxSdk('create payable links'));
    });

    // These reject before any request is made, but beforeAll still
    // authenticates, so they are not runnable without the gateway.
    describe('argument validation', () => {
        it('rejects an empty goid on createPaymentLink', async () => {
            await expect(
                sdk.createPaymentLink('', { payment: linkPayment }),
            ).rejects.toThrow(GoPaySDKError);
        });

        it('rejects an empty linkId on getPaymentLink', async () => {
            await expect(sdk.getPaymentLink(goid, '')).rejects.toMatchObject({
                errorCode: GoPayErrorCodes.INVALID_ARGUMENT,
            });
        });

        it('rejects an empty linkId on disablePaymentLink', async () => {
            await expect(
                sdk.disablePaymentLink(goid, ''),
            ).rejects.toMatchObject({
                errorCode: GoPayErrorCodes.INVALID_ARGUMENT,
            });
        });
    });

    describe('createPaymentLink', () => {
        it('returns an active link with an id and a shareable url', async () => {
            const link = await sdk.createPaymentLink(goid, {
                payment: linkPayment,
            });

            expect(link.id).toBeTruthy();
            expect(link.url).toMatch(/^https:\/\//);
            expect(link.active).toBe(true);
            // The URL code and the id are separate identifiers; neither is
            // derivable from the other, so a caller that only kept the URL
            // cannot manage the link. Asserted so a backend change that starts
            // embedding the id in the URL is noticed rather than assumed.
            expect(link.url).not.toContain(link.id);
        });

        it('defaults to a reusable link when reusable is omitted', async () => {
            // The SDK widens `reusable` back to optional; this checks the
            // gateway's own default still comes back as documented.
            const link = await sdk.createPaymentLink(goid, {
                payment: linkPayment,
            });
            expect(link.reusable).toBe(true);
        });

        it('honours reusable: false', async () => {
            const link = await sdk.createPaymentLink(goid, {
                payment: linkPayment,
                reusable: false,
            });
            expect(link.reusable).toBe(false);
        });

        it('computes expires_at from expires_in', async () => {
            const before = Date.now();
            const link = await sdk.createPaymentLink(goid, {
                payment: linkPayment,
                expires_in: 3600,
            });

            expect(link.expires_at).toBeTruthy();
            const expiresAt = new Date(link.expires_at as string).getTime();
            // Bounded loosely on purpose: the gateway's clock, the request
            // round-trip and any rounding it applies all move this by seconds.
            expect(expiresAt).toBeGreaterThan(before);
            expect(expiresAt).toBeLessThan(before + 2 * 3600 * 1000);
        });

        it('never expires when expires_in is omitted', async () => {
            const link = await sdk.createPaymentLink(goid, {
                payment: linkPayment,
            });
            expect(link.expires_at).toBeUndefined();
        });

        it('rejects an expires_in below the documented minimum with 400', async () => {
            // The spec puts a minimum of 1 on expires_in, so 0 is the one
            // out-of-range value that does not depend on this eshop's setup —
            // unlike an unsupported currency, which varies per merchant.
            const err = await sdk
                .createPaymentLink(goid, {
                    payment: linkPayment,
                    expires_in: 0,
                })
                .catch((e: unknown) => e);

            // Status only — the gateway's message wording is not contractual.
            expect(err).toBeInstanceOf(GoPayHTTPError);
            expect((err as GoPayHTTPError).status).toBe(400);
        });
    });

    describe('getPaymentLink', () => {
        it('reads back the link and the payment data it carries', async () => {
            const created = await sdk.createPaymentLink(goid, {
                payment: linkPayment,
            });

            const read = await sdk.getPaymentLink(goid, created.id);

            expect(read.id).toBe(created.id);
            expect(read.url).toBe(created.url);
            expect(read.active).toBe(true);
            expect(read.stop_reason).toBeUndefined();
            expect(read.payment?.amount).toBe(linkPayment.amount);
            expect(read.payment?.order_number).toBe(linkPayment.order_number);
        });

        it('404s on an unknown link id', async () => {
            await expect(
                sdk.getPaymentLink(goid, '9999999999'),
            ).rejects.toMatchObject({ name: 'GoPayHTTPError', status: 404 });
        });

        it('400s on a non-numeric link id', async () => {
            // The spec constrains link_id to ^[0-9]+$. The SDK deliberately does
            // not enforce that itself — it only rejects an empty id — so this
            // asserts the gateway is the one drawing the line.
            await expect(
                sdk.getPaymentLink(goid, 'not-a-number'),
            ).rejects.toMatchObject({ name: 'GoPayHTTPError', status: 400 });
        });

        it('reports an expired link as inactive without needing a write', async () => {
            // expires_in has a minimum of 1s, so this is the shortest link the
            // API will make; expiry is evaluated on read, so no state has to be
            // written for the verdict to flip.
            const created = await sdk.createPaymentLink(goid, {
                payment: linkPayment,
                expires_in: 1,
            });
            await new Promise((resolve) => setTimeout(resolve, 2_000));

            const read = await sdk.getPaymentLink(goid, created.id);

            expect(read.active).toBe(false);
            expect(read.stop_reason).toBe('EXPIRED');
        });
    });

    describe('disablePaymentLink', () => {
        it('deactivates the link and leaves it readable as FROM_API', async () => {
            const created = await sdk.createPaymentLink(goid, {
                payment: linkPayment,
            });

            await expect(
                sdk.disablePaymentLink(goid, created.id),
            ).resolves.toBeUndefined();

            // Disabling is not a delete — the link must still read back.
            const read = await sdk.getPaymentLink(goid, created.id);
            expect(read.active).toBe(false);
            expect(read.stop_reason).toBe('FROM_API');
        });

        it('409s when the link is already inactive', async () => {
            const created = await sdk.createPaymentLink(goid, {
                payment: linkPayment,
            });
            await sdk.disablePaymentLink(goid, created.id);

            const err = await sdk
                .disablePaymentLink(goid, created.id)
                .catch((e: unknown) => e);

            expect(err).toBeInstanceOf(GoPayHTTPError);
            expect((err as GoPayHTTPError).status).toBe(409);
        });

        it('404s on an unknown link id', async () => {
            await expect(
                sdk.disablePaymentLink(goid, '9999999999'),
            ).rejects.toMatchObject({ name: 'GoPayHTTPError', status: 404 });
        });
    });
});
