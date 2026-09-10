import { RUNTIME_ENV_VARS } from './runtime-keys.js';

/** The host the SDK uses for `environment: 'production'` (see internal/core/src/config.ts). */
const PRODUCTION_HOST = 'gate.gopay.com';

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
 * in it — and `assertNotProduction` is the part that does not rely on remembering that. `null` means
 * "not configured" and lets the page fall back to its build-time value.
 */
export function runtimeConfigScript(env = process.env) {
    assertNotProduction(env);

    const config = {};
    for (const [key, varName] of Object.entries(RUNTIME_ENV_VARS)) {
        config[key] = env[varName] ?? null;
    }
    return `window._gpConfig = ${JSON.stringify(config)};`;
}

/**
 * Refuse to hand a client secret to the browser against production.
 *
 * The comment above is a promise; this is the pin. `sdk/tests/e2e/_helpers.ts` guards the same
 * mistake the same way, by the host rather than by trusting the caller. It throws rather than
 * dropping the field silently, because a demo that half-works against production is worse than one
 * that will not start — and `serve.js` calls it once at boot, so a misconfigured deployment fails
 * there and not on somebody's first page load.
 */
export function assertNotProduction(env = process.env) {
    if (!env[RUNTIME_ENV_VARS.clientSecret]) {
        return;
    }
    // Both comparisons are widened deliberately: host names are case-insensitive in DNS, so
    // https://GATE.GOPAY.COM reaches production while failing a case-sensitive test. A guard may
    // refuse more than it strictly has to, never less - which is also why this stays a substring
    // test rather than a parsed host: a value it cannot parse still cannot slip past it.
    const baseUrl = (env[RUNTIME_ENV_VARS.baseUrl] ?? '').toLowerCase();
    const environment = (env[RUNTIME_ENV_VARS.environment] ?? '')
        .trim()
        .toLowerCase();
    if (baseUrl.includes(PRODUCTION_HOST) || environment === 'production') {
        throw new Error(
            `Refusing to serve ${RUNTIME_ENV_VARS.clientSecret} to the browser against production. ` +
                `${RUNTIME_ENV_VARS.baseUrl} was '${baseUrl}', ${RUNTIME_ENV_VARS.environment} was '${environment}'.`,
        );
    }
}
