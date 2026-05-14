import type { CoreConfig } from '@gopay-internal/core';

export interface GoPayBrowserConfig extends CoreConfig {
    /**
     * Public key that identifies your GoPay merchant account in the browser.
     * Obtain it server-side via `serverSdk.getBrowserKeys()` and ship it to your frontend.
     * Safe to embed in client-side code — it carries no payment-action authority on its own.
     */
    publishableKey: string;
    /**
     * Your GoPay OAuth client_id. Returned alongside `publishable_key` by
     * `serverSdk.getBrowserKeys()`. Embedded in the encrypted card payload for
     * backend merchant identification.
     */
    clientId: string;
}

export interface AttachPaymentArgs {
    /** Payment session ID returned by `serverSdk.createPayment()`. */
    paymentId: string;
    /**
     * Payment secret from the `createPayment` response.
     * Treat like a short-lived bearer credential: TLS-only, never log, never embed in URLs.
     */
    paymentSecret: string;
}

/**
 * Hard-coded allowlist of trusted card-form iframe origins per environment.
 * Applied only in production to prevent token leakage if the API or DNS were compromised.
 */
export const TRUSTED_CARD_FORM_ORIGINS: Record<
    'production',
    readonly string[]
> = {
    production: ['https://secure.gopay.com'],
};
