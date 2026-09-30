import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const pkg: { version: string } = JSON.parse(
    readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf-8'),
);

/**
 * Browser-SDK E2E against a live gateway, deliberately outside the default run.
 *
 * `vitest.config.ts` excludes `tests/e2e/**` so the unit suite stays green when no
 * environment is reachable - alpha and the personal namespaces are switched off
 * overnight and at weekends. These run from `yarn test:e2e`, which the e2e-on-env
 * pipeline calls against the gateway chosen in its run form.
 *
 * Credentials come from the process environment: the workspace variables in CI,
 * and `sdk/.env` locally, which is the one credentials file in this repo.
 */
export default defineConfig({
    define: {
        __GOPAY_BROWSER_SDK_VERSION__: JSON.stringify(pkg.version),
        __GOPAY_INTEGRATION__: '"browser-sdk-e2e"',
    },
    resolve: {
        alias: [
            {
                find: '@gopay-internal/core/types/generated.js',
                replacement: resolve(
                    import.meta.dirname,
                    '../internal/core/src/types/generated.ts',
                ),
            },
            {
                find: '@gopay-internal/core',
                replacement: resolve(
                    import.meta.dirname,
                    '../internal/core/src/index.ts',
                ),
            },
        ],
    },
    test: {
        unstubGlobals: true,
        environment: 'jsdom',
        include: ['tests/e2e/**/*.e2e.test.ts'],
        testTimeout: 30_000,
        reporters: ['verbose', 'junit'],
        outputFile: { junit: 'test-results/e2e-junit.xml' },
        env: loadSharedEnv(),
    },
});

/**
 * Read `sdk/.env` for local runs and let the real environment win over it, so a
 * shell override works the way it does for every other tool. Missing file is not
 * an error: in CI the values arrive as workspace variables and there is no file.
 */
function loadSharedEnv(): Record<string, string> {
    const file = resolve(import.meta.dirname, '../sdk/.env');
    const fromFile: Record<string, string> = {};
    try {
        for (const line of readFileSync(file, 'utf-8').split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) {
                continue;
            }
            const eq = trimmed.indexOf('=');
            if (eq === -1) {
                continue;
            }
            fromFile[trimmed.slice(0, eq).trim()] = trimmed
                .slice(eq + 1)
                .trim();
        }
    } catch {
        // No local .env - CI supplies the values directly.
    }
    for (const key of Object.keys(fromFile)) {
        const live = process.env[key];
        if (live) {
            fromFile[key] = live;
        }
    }
    return fromFile;
}
