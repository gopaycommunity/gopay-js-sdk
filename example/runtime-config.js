/**
 * The body of /env.js, shared by the dev middleware (vite.config.ts) and the production server
 * (serve.js). Two emitters, one shape — a value only one of them sends is a demo that behaves
 * differently in Docker than it does on a laptop.
 *
 * Credentials travel here rather than through `import.meta.env` because the deployed image is built
 * once, by the release pipeline, and only learns which merchant it is talking to when Kubernetes
 * starts it. A build-time variable cannot be told that afterwards.
 *
 * Everything in this payload is served to the browser, so only dev/test merchant credentials belong
 * in it. `null` means "not configured" and lets the page fall back to its build-time value.
 */
export function runtimeConfigScript(env = process.env) {
    const config = {
        baseUrl: env.GOPAY_PAYMENTS_V4_BASE_URL ?? null,
        environment: env.GOPAY_PAYMENTS_V4_ENVIRONMENT ?? null,
        clientId: env.GOPAY_PAYMENTS_V4_CLIENT_ID ?? null,
        clientSecret: env.GOPAY_PAYMENTS_V4_CLIENT_SECRET ?? null,
        goid: env.GOPAY_PAYMENTS_V4_GOID ?? null,
        shareableKey: env.GOPAY_PAYMENTS_V4_SHAREABLE_KEY ?? null,
    };
    return `window._gpConfig = ${JSON.stringify(config)};`;
}
