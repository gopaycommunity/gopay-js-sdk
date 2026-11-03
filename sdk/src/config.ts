import type { CoreConfig } from '@gopay-internal/core';

/** Server SDK configuration. All fields are optional. */
export type GoPayConfig = CoreConfig & {
    /**
     * Appended to the SDK's own `User-Agent` (`GoPay JS v4 <version>`), e.g. `my-shop/2.1`.
     * It names your integration in GoPay's logs; it never replaces the SDK's part.
     */
    userAgentSuffix?: string;
};
