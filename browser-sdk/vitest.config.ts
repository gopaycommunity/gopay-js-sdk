import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
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
        environment: 'jsdom',
        reporters: ['verbose', 'junit'],
        outputFile: { junit: 'test-results/junit.xml' },
        coverage: {
            provider: 'v8',
            reporter: ['text', 'lcov', 'html'],
            include: ['src/**'],
            exclude: ['src/types/generated.ts'],
        },
    },
});
