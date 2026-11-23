import {
    createHttpClient,
    GoPayErrorCodes,
    GoPaySDKError,
    reportErrors,
    requireNonEmptyString,
} from '@gopay-internal/core';
import type { AttachPaymentArgs, GoPayBrowserConfig } from './config.js';
import { createGwLoggerTelemetry } from './logging/gw-logger.js';
import { getTransactionId, newTraceId } from './logging/ids.js';
import { registerLeaveBeacon } from './logging/leave-beacon.js';
import { registerPageLifecycle } from './logging/page-lifecycle.js';
import {
    createAuthApi,
    exchangePaymentCredentials,
} from './modules/auth/auth.module.js';
import { createCardsApi } from './modules/cards/cards.module.js';
import { fetchBrowserData } from './modules/payments/browser-data.js';
import { createSessionOpener } from './modules/payments/init-session.js';
import { createPaymentsApi } from './modules/payments/payments.module.js';
import { createWalletsApi } from './modules/wallets/wallets.module.js';
import { SDK_VERSION } from './version.js';

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
 * Requires a `shareableKey` and `clientId` — obtain both server-side via
 * `serverSdk.getBrowserKeys()` and forward them to the browser.
 *
 * ```ts
 * // Server:
 * const { shareable_key, client_id } = await serverSdk.getBrowserKeys();
 *
 * // Browser (Flow A — encrypt-only, charge on your server):
 * const sdk = createGoPayBrowserSDK({ environment: 'production', shareableKey, clientId });
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
 * <script src="https://unpkg.com/@gopaycz/gopay-js-sdk-browser@1/dist/gopay-browser-sdk.min.js"></script>
 * <script>
 *   const sdk = GoPayBrowserSDK.createGoPayBrowserSDK({ ... });
 *   (async () => { await sdk.attachPayment({ ... }); })();
 * </script>
 * ```
 */
export function createGoPayBrowserSDK(config: GoPayBrowserConfig) {
    const { shareableKey, clientId, threeDS, ...coreConfig } = config;
    // Always on, with no switch and nothing to configure: GoPay needs to see
    // how the SDK behaves on real checkouts, and a signal only the merchants
    // who opted in produce is a signal about those merchants, not about the
    // SDK. What it may carry is bounded at the source instead — see
    // logging/sanitize.ts and the README's Operational data section.
    let attachedPaymentId: string | undefined;
    const telemetry = createGwLoggerTelemetry({
        environment: coreConfig.environment ?? 'sandbox',
        getClientId: () => clientId,
        getPaymentId: () => attachedPaymentId,
    });
    const client = createHttpClient(
        { ...coreConfig, shareableKey },
        'Call attachPayment({ paymentId, paymentSecret }) again.',
        telemetry,
        // The ids gw-logger events carry, on every API v4 request too, so the
        // gateway's log lines for a checkout can be found from its events and
        // the other way round. No User-Agent: a page cannot set one.
        {
            transactionId: getTransactionId,
            paymentId: () => attachedPaymentId,
            newTraceId,
        },
    );
    client.setClientId(clientId);

    // The denominator. Every other event says something went a particular way;
    // this one says an attempt happened at all, which is what a payment that
    // never starts otherwise leaves no trace of.
    telemetry.lifecycle('init');
    registerLeaveBeacon(telemetry);
    // After the leave beacon: a restore re-arms it, and a discarded tab's
    // reload reports itself right after this instance's init.
    registerPageLifecycle(telemetry);

    let paymentsApi: PaymentsApi | null = null;
    const getPaymentsApi = () => paymentsApi;
    const openSession = createSessionOpener(client);
    // Bumped by every attachPayment() and by logout(). Two attaches may overlap
    // while no card form is mounted, and the one called last is the one that
    // counts — not whichever exchange happens to answer last. A logout counts
    // the same way, or an attach pending across it would answer and undo it.
    let attachAttempt = 0;
    const detach = () => {
        attachAttempt += 1;
        paymentsApi = null;
        attachedPaymentId = undefined;
    };

    const { isCardFormMounted, ...cardsApi } = createCardsApi(
        client,
        getPaymentsApi,
        telemetry,
    );

    // reportErrors so that config.onError also sees the failures raised before a
    // request goes out — argument validation and the mount-time guards — and not
    // just the ones the HTTP client raises itself.
    const authApi = createAuthApi(client, detach);

    return reportErrors(client, {
        version: SDK_VERSION,
        ...authApi,

        /**
         * Returns `true` while a payment is attached — from the moment
         * `attachPayment()` resolves, and no sooner. The payment's token is
         * held from part-way through the attach, while its methods still
         * throw `PAYMENT_NOT_ATTACHED`; a page that unlocks its pay button on
         * this must not be told `true` for a payment it cannot use yet.
         */
        isAuthenticated(): boolean {
            return paymentsApi !== null && authApi.isAuthenticated();
        },

        /**
         * Exchange a `payment_secret` for a payment-scoped JWT and unlock
         * payment methods (`chargePayment`, Apple Pay, Google Pay, `getStatus`).
         * Must be called before `mountCardForm({ flow: 'direct-charge' })`.
         *
         * Throws `INVALID_ARGUMENT` if a card form is currently mounted — call
         * `unmount()` on the active controller first to avoid charging the wrong payment.
         */
        async attachPayment({
            paymentId,
            paymentSecret,
        }: AttachPaymentArgs): Promise<void> {
            if (isCardFormMounted()) {
                throw new GoPaySDKError(
                    '[GoPayBrowserSDK] Cannot re-attach payment while a card form is mounted. Call unmount() on the active controller first.',
                    { errorCode: GoPayErrorCodes.INVALID_ARGUMENT },
                );
            }
            const pid = requireNonEmptyString(paymentId, 'paymentId');
            const secret = requireNonEmptyString(
                paymentSecret,
                'paymentSecret',
            );
            const attempt = ++attachAttempt;
            const isCurrent = () => attempt === attachAttempt;
            paymentsApi = null;
            // Set before the exchange rather than after it. The token call
            // that performs the attach is emitted while it runs, and so is the
            // error event if it fails — set afterwards, both went out with no
            // payment session on them, which left a failed attach impossible
            // to tie to the payment it was for. The catch below puts the
            // "never claim a session the SDK did not get" guarantee back.
            attachedPaymentId = pid;
            try {
                await exchangePaymentCredentials(
                    client,
                    pid,
                    secret,
                    undefined,
                    isCurrent,
                );
            } catch (error) {
                if (isCurrent()) {
                    attachedPaymentId = undefined;
                }
                throw error;
            }
            // Overtaken by a later attachPayment() or a logout(): that one owns
            // the session. Resolving would tell the caller this payment is
            // attached, and the next charge would go to a different one.
            const assertCurrent = () => {
                if (!isCurrent()) {
                    throw new GoPaySDKError(
                        '[GoPayBrowserSDK] attachPayment() was overtaken by a later attachPayment() or logout(); this payment is not attached.',
                        { errorCode: GoPayErrorCodes.PAYMENT_NOT_ATTACHED },
                    );
                }
            };
            assertCurrent();
            // Built here, unlocked below: an id it rejects fails the attach
            // now, before anything is sent to the payment or said about it.
            const attached = createPaymentsApi(client, pid, threeDS, telemetry);
            // The attach has no HTTP call of its own to stand for it: the
            // exchange is a POST /oauth2/token like the SDK's own
            // authentication, so in the logs the two are only told apart by
            // this marker. Ahead of init-session, which belongs to the attach
            // it follows.
            telemetry.lifecycle('navigate', { flow: 'attach' });
            // Awaited, and before the payment's methods are unlocked: it has
            // to be the first request the payment sees and to be answered
            // before the next one — see init-session.ts. It never rejects and
            // gives up waiting on its own, so the attach cannot fail or hang
            // on it.
            await openSession(pid);
            // The wait is long enough to be overtaken in, like the exchange.
            assertCurrent();
            paymentsApi = attached;
        },

        ...cardsApi,
        ...createWalletsApi(client, getPaymentsApi, telemetry),

        /**
         * Fetch `ip`, `user_agent` and `accept_header` from
         * `GET /cards/browser-data` and merge them with the locally readable
         * fields, yielding a complete `browser_data` object.
         *
         * Needs only `shareableKey`, so it works before `attachPayment()`. The
         * SDK calls it internally for `chargePayment` and for
         * `mountCardForm({ flow: 'direct-charge' })`; call it directly when the
         * merchant's server performs the charge and needs the values collected
         * in the customer's browser.
         */
        async getBrowserData(options?: { signal?: AbortSignal }) {
            return fetchBrowserData(client, options);
        },

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
            options?: Parameters<PaymentsApi['awaitChargeState']>[0],
        ) {
            return (paymentsApi ?? notAttached()).awaitChargeState(options);
        },
        awaitPaymentStatus(
            options?: Parameters<PaymentsApi['awaitPaymentStatus']>[0],
        ) {
            return (paymentsApi ?? notAttached()).awaitPaymentStatus(options);
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
    });
}

export type GoPayBrowserSDK = ReturnType<typeof createGoPayBrowserSDK>;
