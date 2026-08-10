/**
 * Memoised `<script>` injector. Calling `loadScriptOnce(src)` multiple times
 * with the same URL is safe — the script is only appended once, and all
 * callers share the same resolved promise.
 *
 * Resolves when the script has loaded; rejects if the `error` event fires
 * before `load`. The cache is keyed by URL alone, so `options` only takes
 * effect on the call that actually injects the script.
 */
const cache = new Map<string, Promise<void>>();

export function loadScriptOnce(
    src: string,
    options?: {
        /**
         * Sets the `crossorigin` attribute on the injected `<script>`.
         *
         * Only pass this for hosts that actually send CORS headers. A
         * `crossorigin` script served without an `Access-Control-Allow-Origin`
         * header is blocked outright, so this stays opt-in per URL rather than
         * a global default — `pay.google.com` sends no CORS headers and would
         * stop loading.
         */
        crossOrigin?: 'anonymous' | 'use-credentials';
    },
): Promise<void> {
    const existing = cache.get(src);
    if (existing) {
        return existing;
    }

    const promise = new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        if (options?.crossOrigin) {
            script.crossOrigin = options.crossOrigin;
        }
        script.onload = () => resolve();
        script.onerror = () => {
            cache.delete(src);
            script.remove();
            reject(
                new Error(`[GoPayBrowserSDK] Failed to load script: ${src}`),
            );
        };
        document.head.appendChild(script);
    });

    cache.set(src, promise);
    return promise;
}
