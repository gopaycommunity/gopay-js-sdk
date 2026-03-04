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

export interface RefreshTokenRequest {
    grant_type: 'refresh_token';
    refresh_token: string;
    client_id?: string;
    scope?: string;
}

export type AuthenticateRequest =
    | ClientCredentialsRequest
    | RefreshTokenRequest;
