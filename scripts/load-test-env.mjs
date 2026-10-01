/**
 * Credentials for the E2E suites, shared by sdk/vitest.config.ts and
 * browser-sdk/vitest.e2e.config.ts.
 *
 * One copy because the two drifted the moment there were two: they disagreed on whether the
 * file or the real environment wins, and one swallowed every read error rather than just a
 * missing file, which would have hidden a malformed .env as "no credentials".
 *
 * The real environment wins over the file. That is what makes
 * `GOPAY_PAYMENTS_V4_BASE_URL=... yarn test:e2e` point the suite somewhere else for one run,
 * which is the obvious way to do it and silently did nothing before. CI has no .env at all,
 * so there the workspace variables are the only source either way.
 */
import { readFileSync } from 'node:fs';

/**
 * @param {string} path - .env to read; absent is fine, CI supplies the values directly.
 * @param {string[]} requiredKeys - keys without which the suites cannot authenticate.
 * @returns {Record<string, string>}
 */
export function loadTestEnv(path, requiredKeys) {
    /** @type {Record<string, string>} */
    let fileEnv = {};
    try {
        fileEnv = Object.fromEntries(
            readFileSync(path, 'utf-8')
                .split('\n')
                .map((line) => line.trim())
                .filter((line) => line && !line.startsWith('#'))
                .map((line) => {
                    const eq = line.indexOf('=');
                    if (eq === -1) {
                        throw new Error(
                            `Invalid .env line (missing '='): "${line}"`,
                        );
                    }
                    return [
                        line.slice(0, eq).trim(),
                        line.slice(eq + 1).trim(),
                    ];
                })
                .filter(([key]) => key),
        );
    } catch (err) {
        // Only a missing file is normal. Anything else - unreadable, malformed - is reported
        // rather than quietly turning into "no credentials found".
        if (err.code !== 'ENOENT') {
            throw err;
        }
    }

    const env = { ...fileEnv };
    for (const key of Object.keys(env)) {
        if (process.env[key]) {
            env[key] = process.env[key];
        }
    }
    for (const key of requiredKeys) {
        if (!env[key] && process.env[key]) {
            env[key] = process.env[key];
        }
    }

    const missing = requiredKeys.filter((key) => !env[key]);
    if (missing.length > 0) {
        throw new Error(`Missing required E2E env vars: ${missing.join(', ')}`);
    }
    return env;
}
