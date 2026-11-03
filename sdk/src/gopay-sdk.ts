import { createHttpClient, reportErrors } from '@gopay-internal/core';
import type { GoPayConfig } from './config.js';
import { createTransactions, userAgentFor } from './correlation.js';
import { createAuthApi } from './modules/auth/auth.module.js';
import { createCardsApi } from './modules/cards/cards.module.js';
import { createEventsApi } from './modules/events/events.module.js';
import { createLinksApi } from './modules/links/links.module.js';
import { createPaymentsApi } from './modules/payments/payments.module.js';
import { createRecurrencesApi } from './modules/recurrences/recurrences.module.js';
import { createRefundsApi } from './modules/refunds/refunds.module.js';
import { createWebhooksApi } from './modules/webhooks/webhooks.module.js';
import { SDK_VERSION } from './version.js';

/**
 * Create a GoPay server-side SDK instance.
 *
 * ESM / CommonJS:
 * ```ts
 * import { createGoPaySDK } from '@gopaycz/gopay-js-sdk';
 * const sdk = createGoPaySDK({ environment: 'sandbox' });
 * await sdk.authenticate({ grant_type: 'client_credentials', client_id: '...', client_secret: '...', scope: '...' });
 * ```
 */
export function createGoPaySDK(config: GoPayConfig = {}) {
    // Only its own refusals: what fn throws is the caller's, not a failure of the SDK.
    const transactions = createTransactions((error) =>
        client.reportError(error),
    );
    const userAgent = userAgentFor(config.userAgentSuffix);
    // In a page (the example app runs this SDK in one) the headers would make every call a
    // CORS preflight, refused wherever the gateway does not allow them yet. A server sends none.
    const inPage =
        (globalThis as { document?: unknown }).document !== undefined;
    const client = createHttpClient(
        config,
        undefined,
        undefined,
        inPage ? undefined : { userAgent, transactionId: transactions.current },
    );
    // reportErrors so that config.onError also sees the failures raised before a
    // request goes out — argument validation, mostly — and not just the ones the
    // HTTP client raises itself.
    return {
        ...transactions.bind(
            reportErrors(client, {
                version: SDK_VERSION,
                ...createAuthApi(client),
                ...createPaymentsApi(client),
                ...createCardsApi(client),
                ...createRefundsApi(client),
                ...createLinksApi(client),
                ...createRecurrencesApi(client),
                ...createEventsApi(client),
                ...createWebhooksApi(client),
            }),
        ),
        /**
         * Run `fn` with every SDK call inside it sent under `transactionId`
         * (`X-GoPay-Transaction-Id`) — your own request id, say — instead of an id per call.
         * 1–64 characters of `A–Z a–z 0–9 . _ -`. Returns what `fn` returns, untouched.
         */
        withTransactionId: transactions.withTransactionId,
    };
}

export type GoPaySDK = ReturnType<typeof createGoPaySDK>;
