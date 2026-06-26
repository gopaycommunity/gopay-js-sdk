export interface RequestOptions {
    /** Additional headers to merge with the defaults. */
    headers?: Record<string, string>;
    /** Access token to use instead of the client-level token. */
    accessToken?: string;
    /** Abort signal to cancel the request mid-flight. Combined with the built-in request timeout. */
    signal?: AbortSignal;
}
