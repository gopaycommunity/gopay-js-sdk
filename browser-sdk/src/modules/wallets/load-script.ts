/**
 * Memoised `<script>` injector. Calling `loadScriptOnce(src)` multiple times
 * with the same URL is safe — the script is only appended once, and all
 * callers share the same resolved promise.
 *
 * Resolves when the script has loaded; rejects if the `error` event fires
 * before `load`.
 */
const cache = new Map<string, Promise<void>>();

export function loadScriptOnce(src: string): Promise<void> {
    const existing = cache.get(src);
    if (existing) {
        return existing;
    }

    const promise = new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
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
