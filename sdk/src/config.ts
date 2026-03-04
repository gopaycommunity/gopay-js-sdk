import type { GoPayEnvironment } from './types/index.js';

export interface GoPayConfig {
    /** Target environment. Defaults to 'sandbox'. */
    environment?: GoPayEnvironment;
    /** Override the API base URL (useful for mock servers in testing). */
    baseUrl?: string;
}

export const BASE_URLS: Record<
    NonNullable<GoPayConfig['environment']>,
    string
> = {
    sandbox: 'https://api.sandbox.gopay.com/api/merchant/payments/4.0',
    production: 'https://api.gopay.com/api/merchant/payments/4.0',
};
