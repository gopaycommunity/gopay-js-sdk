import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
// Plain ESM helper shared with sdk/vitest.config.ts; typed by scripts/load-test-env.d.mts.
import { loadTestEnv } from '../scripts/load-test-env.mjs';

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
        // sdk/.env is the one credentials file in this repo; CI supplies the same
        // names as workspace variables and has no file at all.
        env: loadTestEnv(resolve(import.meta.dirname, '../sdk/.env'), [
            'GOPAY_PAYMENTS_V4_CLIENT_ID',
            'GOPAY_PAYMENTS_V4_CLIENT_SECRET',
            'GOPAY_PAYMENTS_V4_GOID',
            'GOPAY_PAYMENTS_V4_SHAREABLE_KEY',
            'GOPAY_PAYMENTS_V4_BASE_URL',
        ]),
    },
});
