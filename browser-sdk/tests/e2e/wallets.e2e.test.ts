import { beforeAll, describe, expect, it } from 'vitest';
import { GoPayHTTPError, GoPaySDKError } from '../../src/index.js';
import {
    type AttachedPayment,
    attachedBrowserSdk,
    unattachedBrowserSdk,
} from './_helpers.js';

/**
 * Wallet info endpoints through the browser SDK, against a live gateway.
 *
 * These are the payment-scoped reads a checkout makes before it can show a wallet
 * button. The server SDK covers three of them from its own side; `app-info` exists
 * only here, and until this suite nothing exercised it against a real gateway.
 *
 * Nothing asserts a completed wallet payment: that needs a real Apple Pay or
 * Google Pay sheet, which no headless run can produce. What is asserted is the
 * contract - that each endpoint answers for an attached payment, and that the
 * guards fire before any call when no payment is attached.
 */
describe('wallet info — browser E2E', () => {
    let attached: AttachedPayment;

    beforeAll(async () => {
        attached = await attachedBrowserSdk();
    });

    it('getApplePayAppInfo() answers for the attached payment', async () => {
        // Two legitimate answers, because the endpoint is gated on a merchant
        // capability rather than on the payment: a merchant without Apple Pay
        // in-app enabled gets 403 FORBIDDEN naming exactly that. Asserting only
        // the 200 would make this suite fail on every merchant that has not
        // enabled it, which is the usual case on a dev environment.
        try {
            const info = await attached.sdk.getApplePayAppInfo();
            expect(info).toBeTypeOf('object');
            expect(info).not.toBeNull();
        } catch (error) {
            expect(error).toBeInstanceOf(GoPayHTTPError);
            const http = error as GoPayHTTPError;
            expect(http.status).toBe(403);
            // `endpoint` rather than the message: the message is deliberately
            // just the status, and this proves the refusal came from the
            // endpoint under test rather than from the attach before it.
            expect(String(http.endpoint)).toContain('apple-pay/app-info');
            expect(http.body).toMatchObject({ error: 'FORBIDDEN' });
        }
    });

    it('getApplePayInfo() names this merchant', async () => {
        const info = await attached.sdk.getApplePayInfo();
        expect(info).toBeTypeOf('object');
        expect(info).not.toBeNull();
    });

    it('getGooglePayInfo() returns a payment data request', async () => {
        const info = await attached.sdk.getGooglePayInfo();
        expect(info).toBeTypeOf('object');
        expect(info).not.toBeNull();
    });

    it('getQRPaymentInfo() returns QR data for the attached payment', async () => {
        const info = await attached.sdk.getQRPaymentInfo();
        expect(info).toBeTypeOf('object');
        expect(info).not.toBeNull();
    });

    it('refuses every wallet read before a payment is attached', async () => {
        const sdk = unattachedBrowserSdk();
        await expect(sdk.getApplePayAppInfo()).rejects.toBeInstanceOf(
            GoPaySDKError,
        );
        await expect(sdk.getApplePayInfo()).rejects.toBeInstanceOf(
            GoPaySDKError,
        );
        await expect(sdk.getGooglePayInfo()).rejects.toBeInstanceOf(
            GoPaySDKError,
        );
    });
});
