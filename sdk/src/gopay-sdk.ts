import { createHttpClient } from '@gopay-internal/core';
import type { GoPayConfig } from './config.js';
import { createAuthApi } from './modules/auth/auth.module.js';
import { createCardsApi } from './modules/cards/cards.module.js';
import { createLinksApi } from './modules/links/links.module.js';
import { createPaymentsApi } from './modules/payments/payments.module.js';
import { createRecurrencesApi } from './modules/recurrences/recurrences.module.js';
import { createRefundsApi } from './modules/refunds/refunds.module.js';
import { SDK_VERSION } from './version.js';

/**
 * Create a GoPay server-side SDK instance.
 *
 * ESM / CommonJS:
 * ```ts
 * import { createGoPaySDK } from 'gopay-js-sdk';
 * const sdk = createGoPaySDK({ environment: 'sandbox' });
 * await sdk.authenticate({ grant_type: 'client_credentials', client_id: '...', client_secret: '...', scope: '...' });
 * ```
 */
export function createGoPaySDK(config: GoPayConfig = {}) {
    const client = createHttpClient(config);
    return {
        version: SDK_VERSION,
        ...createAuthApi(client),
        ...createPaymentsApi(client),
        ...createCardsApi(client),
        ...createRecurrencesApi(client),
        ...createRefundsApi(client),
        ...createLinksApi(client),
    };
}

export type GoPaySDK = ReturnType<typeof createGoPaySDK>;
