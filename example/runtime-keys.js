/**
 * The keys of `window._gpConfig`, and the environment variable each one is read from.
 *
 * One list, because the payload is written in `runtime-config.js` and read in `src/sdk.js`, and a
 * name spelled two different ways there is silent: the page finds nothing at runtime and quietly
 * uses whatever the build baked in. Plain JS gets no help from tsc on that, so the list is the
 * check — `runtime()` refuses a key that is not in it.
 *
 * The `import.meta.env.*` reads in sdk.js deliberately stay written out. Vite replaces those at
 * build time by matching the literal member expression, so an indexed lookup through this map
 * would not be substituted and the build-time fallback would vanish.
 */
export const RUNTIME_ENV_VARS = {
    baseUrl: 'GOPAY_PAYMENTS_V4_BASE_URL',
    environment: 'GOPAY_PAYMENTS_V4_ENVIRONMENT',
    clientId: 'GOPAY_PAYMENTS_V4_CLIENT_ID',
    clientSecret: 'GOPAY_PAYMENTS_V4_CLIENT_SECRET',
    goid: 'GOPAY_PAYMENTS_V4_GOID',
    shareableKey: 'GOPAY_PAYMENTS_V4_SHAREABLE_KEY',
};
