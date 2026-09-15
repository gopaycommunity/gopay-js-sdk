import { beforeAll, describe, expect, it } from 'vitest';
import {
    GoPayErrorCodes,
    GoPayHTTPError,
    type GoPaySDK,
    GoPaySDKError,
} from '../../src/index.js';
import {
    createSandboxSdk,
    PROBE_BROWSER_DATA,
    paymentBody,
} from './_helpers.js';

/**
 * Payments against the live gateway.
 *
 * What is out of reach here is a *settled* payment: driving one to `PAID`
 * needs a real card charge plus a 3-D Secure challenge confirmed in the
 * sandbox ACS, which no automated suite in this repo can do (see
 * refunds.e2e.test.ts and GPOMA-2517). So the charge specs below assert the
 * rejection paths, which is still the whole request path — serialisation,
 * auth, routing, error mapping — exercised against the real gateway rather
 * than a mock.
 */
describe('payments — E2E', () => {
    let sdk: GoPaySDK;
    let goid: string;

    beforeAll(async () => {
        ({ sdk, goid } = await createSandboxSdk(
            'create payments and attempt charges',
        ));
    });

    const createPayment = (overrides: Record<string, unknown> = {}) =>
        sdk.createPayment(goid, paymentBody('e2e-payments', overrides));

    // These reject before any request is made, but beforeAll still
    // authenticates, so they are not runnable without the gateway.
    describe('argument validation', () => {
        it('rejects an empty paymentId on getPaymentStatus', async () => {
            await expect(sdk.getPaymentStatus('')).rejects.toMatchObject({
                errorCode: GoPayErrorCodes.INVALID_ARGUMENT,
            });
        });

        it('rejects an empty paymentId on getChargeState', async () => {
            await expect(sdk.getChargeState('')).rejects.toMatchObject({
                errorCode: GoPayErrorCodes.INVALID_ARGUMENT,
            });
        });

        it('rejects an empty paymentId on chargePayment', async () => {
            await expect(
                sdk.chargePayment('', {
                    payment_instrument: {
                        payment_instrument: 'PAYMENT_CARD',
                        input: { input_type: 'CARD_TOKEN', card_token: 'x' },
                        browser_data: PROBE_BROWSER_DATA,
                    },
                }),
            ).rejects.toThrow(GoPaySDKError);
        });
    });

    describe('createPayment', () => {
        it('returns a CREATED payment with an id and a payment_secret', async () => {
            const payment = await createPayment();

            expect(payment.id).toBeTruthy();
            expect(payment.state).toBe('CREATED');
            expect(payment.amount).toBe(100);
            expect(payment.currency).toBe('CZK');
            expect(payment.order_number).toBe('e2e-payments');
            // The per-payment client credential the browser SDK attaches with.
            // Asserted for presence only — never logged, never compared.
            expect(payment.payment_secret).toBeTruthy();
        });

        it('returns gw_url, the address of the hosted gateway', async () => {
            // Not a redirect target for this SDK's own create → charge flow —
            // the hosted gateway cannot be embedded in the merchant's checkout
            // — but it is part of the contract and consumers do reach for it,
            // so a backend that stopped sending it should fail here.
            const payment = await createPayment();
            expect(payment.gw_url).toMatch(/^https:\/\//);
        });

        it('404s on an eshop that is not this merchant', async () => {
            await expect(
                sdk.createPayment('1234567890', paymentBody('e2e-payments')),
            ).rejects.toMatchObject({ name: 'GoPayHTTPError', status: 404 });
        });

        it('rejects a negative amount', async () => {
            // 400, the same code the refund endpoint answers for the same
            // mistake. The two used to differ — create was validated by a layer
            // that raised ValidationException and mapped to 422 — and GPMAIN-9260
            // ("Narovnání API errors 2") deleted that exception in favour of
            // validation annotations, which answer 400.
            //
            // 422 is still accepted because that ticket is Merged, not Done: the
            // change is live on alpha, where CI points, but not yet on sandbox,
            // where a laptop run lands by default. Tighten this to 400 alone once
            // it reaches sandbox.
            const err = await createPayment({ amount: -100 }).catch(
                (e: unknown) => e,
            );

            expect(err).toBeInstanceOf(GoPayHTTPError);
            expect([400, 422]).toContain((err as GoPayHTTPError).status);
        });
    });

    describe('getPaymentStatus', () => {
        it('reads back a payment just created', async () => {
            const created = await createPayment();

            const read = await sdk.getPaymentStatus(created.id);

            expect(read.id).toBe(created.id);
            expect(read.state).toBe('CREATED');
            expect(read.amount).toBe(created.amount);
            expect(read.currency).toBe(created.currency);
        });

        it('404s on an unknown payment id', async () => {
            await expect(
                sdk.getPaymentStatus('9999999999'),
            ).rejects.toMatchObject({ name: 'GoPayHTTPError', status: 404 });
        });
    });

    /**
     * DELETE /payments/{payment_id} is deployed on alpha8 and alpha9 but not on
     * the public sandbox, which answers 405 for the method (measured 15.09.2026).
     * CI runs this suite against alpha8, so these assertions hold there. Running
     * locally against a sandbox .env will fail all three — point the env at an
     * alpha gateway instead of loosening them.
     */
    describe('cancelPayment', () => {
        it('cancels a CREATED payment and leaves it readable', async () => {
            const created = await createPayment();

            await expect(
                sdk.cancelPayment(created.id),
            ).resolves.toBeUndefined();

            // Cancelling is not deleting — the payment stays readable.
            const read = await sdk.getPaymentStatus(created.id);
            expect(read.id).toBe(created.id);
            expect(read.state).toBe('CANCELED');
        });

        it('409s on a payment that is no longer CREATED', async () => {
            const created = await createPayment();
            await sdk.cancelPayment(created.id);

            await expect(sdk.cancelPayment(created.id)).rejects.toMatchObject({
                name: 'GoPayHTTPError',
                status: 409,
            });
        });

        it('404s on an unknown payment id', async () => {
            await expect(sdk.cancelPayment('9999999999')).rejects.toMatchObject(
                { name: 'GoPayHTTPError', status: 404 },
            );
        });
    });

    describe('getChargeState', () => {
        it('404s while the payment has never been charged', async () => {
            // A CREATED payment has no charge yet, and the gateway says so with
            // 404 rather than an empty charge. Worth pinning: a consumer that
            // polls charge state straight after createPayment has to treat this
            // as "not charged yet", not as a lost payment.
            const created = await createPayment();

            await expect(sdk.getChargeState(created.id)).rejects.toMatchObject({
                name: 'GoPayHTTPError',
                status: 404,
            });
        });

        it('404s on an unknown payment id', async () => {
            await expect(
                sdk.getChargeState('9999999999'),
            ).rejects.toMatchObject({ name: 'GoPayHTTPError', status: 404 });
        });
    });

    describe('chargePayment', () => {
        const chargeWith = (paymentId: string, input: unknown) =>
            sdk.chargePayment(paymentId, {
                payment_instrument: {
                    payment_instrument: 'PAYMENT_CARD',
                    input: input as never,
                    browser_data: PROBE_BROWSER_DATA,
                    challenge_preference: 'AUTO',
                },
            });

        it('400s on a CARD_TOKEN the gateway cannot decrypt', async () => {
            // The closest an automated suite gets to the CARD_TOKEN charge path:
            // a well-formed request that only fails on the token itself, which
            // proves the body shape — including challenge_preference sitting
            // beside `input` rather than inside it — is what the gateway wants.
            const created = await createPayment();

            const err = await chargeWith(created.id, {
                input_type: 'CARD_TOKEN',
                card_token: 'not-a-real-token',
            }).catch((e: unknown) => e);

            expect(err).toBeInstanceOf(GoPayHTTPError);
            expect((err as GoPayHTTPError).status).toBe(400);
        });

        it('rejects an ENCRYPTED_CARD payload that is not a JWE', async () => {
            // Status asserted as a set: alpha9 answers 500 here, where a
            // malformed payload should be a 400. Pinning 500 would make a
            // gateway fix fail this suite, so both are accepted and the 4xx is
            // what we actually want to see one day.
            const created = await createPayment();

            const err = await chargeWith(created.id, {
                input_type: 'ENCRYPTED_CARD',
                payload: 'not.a.jwe',
            }).catch((e: unknown) => e);

            expect(err).toBeInstanceOf(GoPayHTTPError);
            expect([400, 500]).toContain((err as GoPayHTTPError).status);
        });

        it('404s on an unknown payment id', async () => {
            const err = await chargeWith('9999999999', {
                input_type: 'CARD_TOKEN',
                card_token: 'not-a-real-token',
            }).catch((e: unknown) => e);

            expect(err).toBeInstanceOf(GoPayHTTPError);
            expect((err as GoPayHTTPError).status).toBe(404);
        });
    });

    describe('getQRPaymentInfo', () => {
        it('returns a CZK payment as a base64 SPAYD code', async () => {
            const created = await createPayment();

            const qr = await sdk.getQRPaymentInfo(created.id);

            expect(qr.amount).toBe(100);
            expect(qr.currency).toBe('CZK');
            // CZK gets spayd; the EUR and HUF keys are absent, not empty.
            expect(qr.qr_code?.spayd).toBeTruthy();
            expect(qr.qr_code?.paybysquare).toBeUndefined();
            // Default format is PNG — decodes to the PNG magic bytes.
            expect(
                Buffer.from(qr.qr_code?.spayd as string, 'base64').subarray(
                    1,
                    4,
                ),
            ).toEqual(Buffer.from('PNG'));
        });

        it('returns SVG when asked for it, under the same key', async () => {
            const created = await createPayment();

            const qr = await sdk.getQRPaymentInfo(created.id, 'svg');

            const decoded = Buffer.from(
                qr.qr_code?.spayd as string,
                'base64',
            ).toString('utf-8');
            expect(decoded.startsWith('<svg')).toBe(true);
        });

        it('returns a EUR payment as PayBySquare instead', async () => {
            // Which key is populated follows the currency, so a consumer cannot
            // hardcode one — this is the spec's own rule, checked live.
            const created = await createPayment({ currency: 'EUR' });

            const qr = await sdk.getQRPaymentInfo(created.id);

            expect(qr.currency).toBe('EUR');
            expect(qr.qr_code?.paybysquare).toBeTruthy();
            expect(qr.qr_code?.spayd).toBeUndefined();
        });

        it('404s on an unknown payment id', async () => {
            await expect(
                sdk.getQRPaymentInfo('9999999999'),
            ).rejects.toMatchObject({ name: 'GoPayHTTPError', status: 404 });
        });
    });

    describe('wallet info', () => {
        it('returns a Google Pay paymentDataRequest in TEST mode', async () => {
            const created = await createPayment();

            const info = await sdk.getGooglePayInfo(created.id);

            // TEST, because this suite refuses production; a PRODUCTION value
            // here would mean the environment guard let something through.
            expect(info.environment).toBe('TEST');
            expect(info.paymentDataRequest?.apiVersion).toBe(2);
            expect(
                info.paymentDataRequest?.allowedPaymentMethods,
            ).not.toHaveLength(0);
        });

        it('returns an Apple Pay request naming this merchant', async () => {
            const created = await createPayment();

            const info = await sdk.getApplePayInfo(created.id);

            // The wire key is `applePayVersion`; the spec — and so the generated
            // type — spells it `applepayVersion`, lowercase p. Read off the
            // response through a cast rather than the typed property, so this
            // asserts what the gateway actually sends. One of the two is wrong
            // and it is not this test's job to guess which.
            expect(
                (info as unknown as Record<string, unknown>).applePayVersion,
            ).toBeGreaterThan(0);
            expect(info.merchantIdentifier).toBe(goid);
            expect(info.applePayPaymentRequest?.currencyCode).toBe('CZK');
            expect(
                info.applePayPaymentRequest?.supportedNetworks,
            ).not.toHaveLength(0);
        });

        it('404s on an unknown payment id', async () => {
            await expect(
                sdk.getGooglePayInfo('9999999999'),
            ).rejects.toMatchObject({ name: 'GoPayHTTPError', status: 404 });
            await expect(
                sdk.getApplePayInfo('9999999999'),
            ).rejects.toMatchObject({ name: 'GoPayHTTPError', status: 404 });
        });
    });
});
