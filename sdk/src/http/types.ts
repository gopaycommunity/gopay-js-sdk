export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RequestOptions {
    /** Additional headers to merge with the defaults. */
    headers?: Record<string, string>;
    /** Access token to use instead of the client-level token. */
    accessToken?: string;
}
