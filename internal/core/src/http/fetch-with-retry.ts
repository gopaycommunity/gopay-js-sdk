const MAX_RETRIES = 2;
const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']);

const sleep = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Retry on 5xx responses and network errors; pass through 4xx immediately. */
export async function fetchWithRetry(
    url: string,
    init: Omit<RequestInit, 'signal'>,
    signal: AbortSignal,
): Promise<Response> {
    const method = (init?.method ?? 'GET').toUpperCase();
    const isIdempotent = IDEMPOTENT_METHODS.has(method);
    let lastResponse: Response | undefined;
    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (attempt > 0) {
            await sleep(2 ** (attempt - 1) * 200);
        }
        try {
            const response = await fetch(
                new Request(url, {
                    ...init,
                    signal,
                }),
            );
            if (response.status < 500) {
                return response;
            }
            if (!isIdempotent) {
                return response;
            }
            lastResponse = response;
        } catch (err) {
            // Timeouts are not retriable — bubble up immediately
            if (err instanceof Error && err.name === 'TimeoutError') {
                throw err;
            }
            if (!isIdempotent) {
                throw err;
            }
            lastError = err;
        }
    }
    // Return last 5xx response so GoPayHTTPError gets status + body
    if (lastResponse !== undefined) {
        return lastResponse;
    }
    throw lastError;
}
