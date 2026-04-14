const MAX_RETRIES = 2;

/** Retry on 5xx responses and network errors; pass through 4xx immediately. */
export async function fetchWithRetry(
    url: string,
    init: Omit<RequestInit, 'signal'>,
    timeoutMs: number,
): Promise<Response> {
    let lastResponse: Response | undefined;
    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            const response = await fetch(
                new Request(url, {
                    ...init,
                    signal: AbortSignal.timeout(timeoutMs),
                }),
            );
            if (response.status < 500) return response;
            lastResponse = response;
        } catch (err) {
            // Timeouts are not retriable — bubble up immediately
            if (err instanceof Error && err.name === 'TimeoutError') throw err;
            lastError = err;
        }
    }
    // Return last 5xx response so GoPayHTTPError gets status + body
    if (lastResponse !== undefined) return lastResponse;
    throw lastError;
}
