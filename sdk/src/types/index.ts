import type { components } from './generated.js';

type PaymentChargeBody =
    components['requestBodies']['Payment-Charge-Request']['content']['application/json'];

/** Browser context data collected by {@link collectBrowserData} for 3DS / fraud detection. */
export type BrowserData = NonNullable<PaymentChargeBody['browser_data']> & {
    /** Whether Java is enabled (always false in modern browsers; sent for 3DS compliance). */
    java_enabled?: boolean;
    /** Client IP address. Not collected client-side; populated by the backend from the HTTP request. Can be supplied by the caller to override. */
    ip?: string;
};

export type GoPayEnvironment = 'sandbox' | 'production';

/**
 * The schema's Client-Credentials-Request only includes grant_type + scope.
 * The SDK adds client_id and client_secret as a convenience — the module
 * uses them to build the Basic Authorization header before sending the form.
 */
export interface ClientCredentialsRequest {
    grant_type: 'client_credentials';
    client_id: string;
    client_secret: string;
    scope: string;
}

export type AuthenticateRequest = ClientCredentialsRequest;

/**
 * A token pair issued for a browser client via `auth.issueClientToken()`.
 * Pass this object directly to `auth.setClientToken()` in the browser.
 */
export interface ClientToken {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    refresh_expires_in: number;
}
