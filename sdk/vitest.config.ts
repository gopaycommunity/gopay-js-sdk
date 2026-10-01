import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defaultExclude, defineConfig } from 'vitest/config';
// @ts-expect-error - plain ESM helper shared with browser-sdk/vitest.e2e.config.ts
import { loadTestEnv } from '../scripts/load-test-env.mjs';

const pkg: { version: string } = JSON.parse(
    readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf-8'),
);
const version = pkg.version;

const REQUIRED_E2E_ENV_KEYS = [
    'GOPAY_PAYMENTS_V4_CLIENT_ID',
    'GOPAY_PAYMENTS_V4_CLIENT_SECRET',
];

export default defineConfig({
    define: {
        __GOPAY_SDK_VERSION__: JSON.stringify(version),
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
        exclude: [...defaultExclude, 'tests/browser/**'],
        pool: 'forks',
        testTimeout: 15_000,
        env: loadTestEnv(
            resolve(import.meta.dirname, '.env'),
            REQUIRED_E2E_ENV_KEYS,
        ),
        reporters: ['verbose', 'junit'],
        outputFile: { junit: 'test-results/junit.xml' },
        coverage: {
            provider: 'v8',
            reporter: ['text', 'lcov', 'html'],
            include: ['src/**'],
        },
    },
});
