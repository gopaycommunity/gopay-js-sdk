import {
    createHttpClient,
    GoPayErrorCodes,
    GoPaySDKError,
} from '@gopay-internal/core';
import type { AttachPaymentArgs, GoPayBrowserConfig } from './config.js';
import {
    createAuthApi,
    exchangeAuthorizationCode,
} from './modules/auth/auth.module.js';
import { createCardsApi } from './modules/cards/cards.module.js';
import { createPaymentsApi } from './modules/payments/payments.module.js';

type PaymentsApi = ReturnType<typeof createPaymentsApi>;

function notAttached(): never {
    throw new GoPaySDKError(
        '[GoPayBrowserSDK] Payment not attached. Call attachPayment({ paymentId, paymentSecret }) first.',
        { errorCode: GoPayErrorCodes.PAYMENT_NOT_ATTACHED },
    );
}

/**
 * Create a GoPay browser SDK instance.
 *
 * Requires a `publishableKey` and `clientId` — obtain both server-side via
 * `serverSdk.getBrowserKeys()` and forward them to the browser.
 *
 * ```ts
 * // Server:
 * const { publishable_key, client_id } = await serverSdk.getBrowserKeys();
 *
 * // Browser (Flow A — encrypt-only, charge on your server):
 * const sdk = createGoPayBrowserSDK({ environment: 'production', publishableKey, clientId });
 * const ctrl = await sdk.mountCardForm(container, { flow: 'return-payload' });
 * const { encryptedPayload } = await ctrl.result;
 * // → forward encryptedPayload to your server → server calls tokenizeEncryptedCard + chargePayment
 *
 * // Browser (Flow B — charge in the browser):
 * await sdk.attachPayment({ paymentId, paymentSecret });
 * const ctrl = await sdk.mountCardForm(container, { flow: 'direct-charge', redirectContainer });
 * const chargeResult = await ctrl.result;
 * ```
 *
 * CDN (IIFE):
 * ```html
 * <script src="https://unpkg.com/gopay-js-sdk-browser@1/dist/gopay-browser-sdk.min.js"></script>
 * <script>
 *   const sdk = GoPayBrowserSDK.createGoPayBrowserSDK({ ... });
 *   await sdk.attachPayment({ ... });
 * </script>
 * ```
 */
export function createGoPayBrowserSDK(config: GoPayBrowserConfig) {
    const { publishableKey, clientId, ...coreConfig } = config;
    const client = createHttpClient(
        { ...coreConfig, publishableKey },
        'Call attachPayment({ paymentId, paymentSecret }) again.',
    );
    client.setClientId(clientId);

    let paymentsApi: PaymentsApi | null = null;
    const getPaymentsApi = () => paymentsApi;

    return {
        ...createAuthApi(client),

        /**
         * Exchange a `payment_secret` for a payment-scoped JWT and unlock
         * payment methods (`chargePayment`, Apple Pay, Google Pay, `getStatus`).
         * Must be called before `mountCardForm({ flow: 'direct-charge' })`.
         */
        async attachPayment({
            paymentId,
            paymentSecret,
        }: AttachPaymentArgs): Promise<void> {
            await exchangeAuthorizationCode(client, paymentSecret, clientId);
            paymentsApi = createPaymentsApi(client, paymentId);
        },

        ...createCardsApi(client, getPaymentsApi),

        // Payment-scoped methods — only available after attachPayment()
        async getStatus() {
            return (paymentsApi ?? notAttached()).getStatus();
        },
        async chargePayment(
            params: Parameters<PaymentsApi['chargePayment']>[0],
        ) {
            return (paymentsApi ?? notAttached()).chargePayment(params);
        },
        async getChargeState() {
            return (paymentsApi ?? notAttached()).getChargeState();
        },
        awaitChargeState(
            options?: Parameters<PaymentsApi['awaitChargeState']>[1],
        ) {
            return (paymentsApi ?? notAttached()).awaitChargeState(
                null,
                options,
            );
        },
        async getGooglePayInfo() {
            return (paymentsApi ?? notAttached()).getGooglePayInfo();
        },
        async getApplePayInfo() {
            return (paymentsApi ?? notAttached()).getApplePayInfo();
        },
        async getApplePayAppInfo() {
            return (paymentsApi ?? notAttached()).getApplePayAppInfo();
        },
        startApplePaySession(
            ...args: Parameters<PaymentsApi['startApplePaySession']>
        ) {
            return (paymentsApi ?? notAttached()).startApplePaySession(...args);
        },
        async getQRPaymentInfo(format?: 'png' | 'svg') {
            return (paymentsApi ?? notAttached()).getQRPaymentInfo(format);
        },
    };
}

export type GoPayBrowserSDK = ReturnType<typeof createGoPayBrowserSDK>;
