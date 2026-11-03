import { beforeAll, describe, expect, it } from 'vitest';
import {
    type GoPayEvent,
    GoPayHTTPError,
    type GoPaySDK,
} from '../../src/index.js';
import { createSandboxSdk, paymentBody } from './_helpers.js';
import { expectMatchesSpec } from './spec.js';

/**
 * Events and webhooks against a live gateway (alpha9 in CI). Delivery, retries, policies and
 * every event type are OLAF's to cover; this checks that the SDK reads what the gateway writes.
 */
const SCOPE = 'payment:write payment:read event:read shared:read';

/** demo-site's receiver (GPOMA-2797), e.g. https://demo.alpha9.dev.gopay.com/api/v1/test/webhooks */
const INSPECTION_URL = process.env.GOPAY_E2E_WEBHOOK_INSPECTION_URL;

async function waitFor<T>(
    what: string,
    probe: () => Promise<T | undefined>,
    timeoutMs: number,
): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const found = await probe();
        if (found !== undefined) {
            return found;
        }
        if (Date.now() > deadline) {
            throw new Error(
                `${what} did not appear within ${timeoutMs / 1000} s`,
            );
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
}

describe('events and webhooks — E2E', () => {
    let sdk: GoPaySDK;
    let goid: string;
    let paymentId: string;
    let canceled: GoPayEvent;

    beforeAll(async () => {
        ({ sdk, goid } = await createSandboxSdk(
            'create and cancel payments to read their events',
            SCOPE,
        ));
        const payment = await sdk.createPayment(
            goid,
            paymentBody('e2e-events'),
        );
        paymentId = payment.id;
        await sdk.cancelPayment(paymentId);
        // The event is recorded asynchronously, about a second after the cancel.
        canceled = await waitFor(
            'payments.canceled in listEvents',
            async () =>
                (
                    await sdk.listEvents(goid, {
                        related_type: 'payments',
                        related_id: paymentId,
                    })
                ).items.find((event) => event.type === 'payments.canceled'),
            15_000,
        );
    }, 60_000);

    it('loads the webhook signing keys', async () => {
        const keys = await sdk.getWebhookPublicKeys();

        expectMatchesSpec('JWK-Set', keys);
        expect(keys.keys.length).toBeGreaterThan(0);
    });

    it('lists the cancel of a payment as payments.canceled', async () => {
        const page = await sdk.listEvents(goid, {
            related_type: 'payments',
            related_id: paymentId,
        });

        expectMatchesSpec('Event-List', page);
        expect(
            canceled.type === 'payments.canceled' && canceled.data.payment_id,
        ).toBe(paymentId);
    });

    it('returns the same event from getEvent as from the list', async () => {
        const event = await sdk.getEvent(goid, canceled.id);

        expectMatchesSpec('Event', event);
        expect(event).toEqual(canceled);
    });

    it('pages across a page boundary, newest first, without repeating an event', async () => {
        const first = await sdk.listEvents(goid, { max_items: 2 });
        expect(first.next_page_url).toBeTruthy();

        const seen: GoPayEvent[] = [];
        for await (const event of sdk.iterateEvents(goid, { max_items: 2 })) {
            seen.push(event);
            if (seen.length === 5) {
                break;
            }
        }

        expect(new Set(seen.map((event) => event.id)).size).toBe(5);
        const times = seen.map((event) => Date.parse(event.occurred_at));
        expect(times).toEqual([...times].sort((a, b) => b - a));
    });

    it('surfaces a 400 as GoPayHTTPError', async () => {
        const error = await sdk
            .listEvents(goid, { max_items: 0 })
            .catch((reason: unknown) => reason);

        expect(error).toBeInstanceOf(GoPayHTTPError);
        expect((error as GoPayHTTPError).status).toBe(400);
    });

    it('surfaces an unknown event as a 404 GoPayHTTPError', async () => {
        const error = await sdk
            .getEvent(goid, '01AAAAAAAAAAAAAAAAAAAAAAAA')
            .catch((reason: unknown) => reason);

        expect(error).toBeInstanceOf(GoPayHTTPError);
        expect((error as GoPayHTTPError).status).toBe(404);
    });

    // Declared only where a receiver is reachable: absent, it would read as a delivery that
    // was checked and proved nothing.
    if (INSPECTION_URL) {
        it('delivers the event signed, and verifyWebhook accepts it against the live keys', async () => {
            const stored = await waitFor(
                'the payments.canceled webhook at the receiver',
                async () => {
                    const response = await fetch(
                        `${INSPECTION_URL}?payment_id=${encodeURIComponent(paymentId)}`,
                    );
                    if (!response.ok) {
                        throw new Error(
                            `The webhook receiver answered ${response.status}`,
                        );
                    }
                    const { webhooks } = (await response.json()) as {
                        webhooks: {
                            type: string | null;
                            signature: string | null;
                            userAgent: string | null;
                            bodyBase64: string;
                        }[];
                    };
                    return webhooks.find(
                        (webhook) => webhook.type === 'payments.canceled',
                    );
                },
                30_000,
            );

            expect(stored.userAgent).toBe('GoPay-Webhooks/1.0');
            const event = await sdk.verifyWebhook(
                Buffer.from(stored.bodyBase64, 'base64'),
                stored.signature,
            );
            expect(event).toEqual(canceled);
        }, 45_000);
    } else {
        console.info(
            '[events e2e] webhook delivery not declared: GOPAY_E2E_WEBHOOK_INSPECTION_URL is not set',
        );
    }
});
