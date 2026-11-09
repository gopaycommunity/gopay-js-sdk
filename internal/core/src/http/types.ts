export interface RequestOptions {
    /** Additional headers to merge with the defaults. */
    headers?: Record<string, string>;
    /** Access token to use instead of the client-level token. */
    accessToken?: string;
    /** Abort signal to cancel the request mid-flight. Combined with the built-in request timeout. */
    signal?: AbortSignal;
}

/**
 * What `post` takes on top of RequestOptions. A type of its own, so a verb
 * that does not honour `quiet` does not accept it either: on `get` it would
 * compile and quietly do nothing - the failure would still reach `onError`,
 * and a 401 would still re-exchange the credentials.
 */
export interface PostOptions extends RequestOptions {
    /**
     * Keep the request's own failure — HTTP status, timeout, network error —
     * away from `onError`; it still rejects and still reaches telemetry. For a
     * call the SDK makes on its own behalf that nothing waits on, whose failure
     * the integrator could not act on. A 401 is returned as it is, without
     * re-exchanging the credentials or dropping the token, so the call cannot
     * disturb the session other calls rely on.
     */
    quiet?: boolean;
}
