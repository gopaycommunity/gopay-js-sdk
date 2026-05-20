export type { BrowserData, GoPayEnvironment } from '@gopay-internal/core';

export interface ClientCredentialsRequest {
    grant_type: 'client_credentials';
    client_id: string;
    client_secret: string;
    scope: string;
}

export type AuthenticateRequest = ClientCredentialsRequest;
