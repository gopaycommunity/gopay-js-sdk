import type { GoPayConfig } from './config.js';
import { createHttpClient } from './http/client.js';
import { createAuthApi } from './modules/auth/auth.module.js';
import { createCardsApi } from './modules/cards/cards.module.js';
import { createPaymentsApi } from './modules/payments/payments.module.js';

/**
 * Create a GoPay SDK instance.
 *
 * Browser (IIFE):
 * ```html
 * <script src="https://gopaycdn.com/js-sdk/gopay-sdk.min.js"></script>
 * <script>
 *   const sdk = GoPaySDK.createGoPaySDK({ environment: 'sandbox' });
 * </script>
 * ```
 *
 * ESM / CommonJS:
 * ```ts
 * import { createGoPaySDK } from 'gopay-js-sdk';
 * const sdk = createGoPaySDK({ environment: 'sandbox' });
 * ```
 */
export function createGoPaySDK(config: GoPayConfig = {}) {
    const client = createHttpClient(config);
    return {
        ...createAuthApi(client),
        ...createPaymentsApi(client),
        ...createCardsApi(client),
    };
}

export type GoPaySDK = ReturnType<typeof createGoPaySDK>;
