import type { GoPayConfig } from './config.js';
import { HttpClient } from './http/client.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { CardsModule } from './modules/cards/cards.module.js';
import { EncryptionModule } from './modules/encryption/encryption.module.js';
import { PaymentsModule } from './modules/payments/payments.module.js';

/**
 * GoPay JavaScript SDK
 *
 * Browser (IIFE):
 * ```html
 * <script src="https://gopaycdn.com/js-sdk/gopay-sdk.min.js"></script>
 * <script>
 *   const sdk = new GoPaySDK.GoPaySDK({ environment: 'sandbox' });
 * </script>
 * ```
 *
 * ESM / CommonJS:
 * ```ts
 * import { GoPaySDK } from 'gopay-js-sdk';
 * const sdk = new GoPaySDK({ environment: 'sandbox' });
 * ```
 */
export class GoPaySDK {
    /** Authentication — obtain and refresh access tokens */
    readonly auth: AuthModule;

    /** Payments — create and charge payment sessions */
    readonly payments: PaymentsModule;

    /** Cards — tokenize encrypted card data */
    readonly cards: CardsModule;

    /** Encryption — fetch the public key for JWE card encryption */
    readonly encryption: EncryptionModule;

    private readonly httpClient: HttpClient;

    constructor(config: GoPayConfig = {}) {
        this.httpClient = new HttpClient(config);
        this.auth = new AuthModule(this.httpClient);
        this.payments = new PaymentsModule(this.httpClient);
        this.cards = new CardsModule(this.httpClient);
        this.encryption = new EncryptionModule(this.httpClient);
    }
}
