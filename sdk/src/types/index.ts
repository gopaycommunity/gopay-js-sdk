import type { components } from './generated.js';

/** Browser context data collected for 3DS / fraud detection. */
export type BrowserData = components['schemas']['Browser-Data'] & {
    /** Client IP address. Not collected client-side; populated by the backend from the HTTP request. */
    ip?: string;
};

export type { GoPayEnvironment } from '@gopay-internal/core';

export interface ClientCredentialsRequest {
    grant_type: 'client_credentials';
    client_id: string;
    client_secret: string;
    scope: string;
}

export type AuthenticateRequest = ClientCredentialsRequest;
