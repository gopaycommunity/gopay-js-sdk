import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const pkg: { version: string } = JSON.parse(
    readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf-8'),
);

export default defineConfig({
    define: {
        __GOPAY_BROWSER_SDK_VERSION__: JSON.stringify(pkg.version),
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
        include: ['tests/stress/**/*.test.ts'],
        testTimeout: 120_000,
        reporters: ['verbose', 'junit'],
        outputFile: { junit: 'test-results/stress-junit.xml' },
        singleThread: true,
    },
});
