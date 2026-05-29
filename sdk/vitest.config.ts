import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defaultExclude, defineConfig } from 'vitest/config';

const version = (
    JSON.parse(
        readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf-8'),
    ) as { version: string }
).version;

const REQUIRED_E2E_ENV_KEYS = [
    'GP_GW_JS_SDK_BASE_URL',
    'GP_GW_JS_SDK_CLIENT_ID',
    'GP_GW_JS_SDK_CLIENT_SECRET',
];

function loadDotEnv(path: string): Record<string, string> {
    let fileEnv: Record<string, string> = {};
    try {
        const raw = readFileSync(path, 'utf-8');
        fileEnv = Object.fromEntries(
            raw
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
                    ] as [string, string];
                })
                .filter(([key]) => key),
        );
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw err;
        }
        // file not found — fall back to process.env (CI secrets)
    }
    const env = { ...fileEnv };
    for (const key of REQUIRED_E2E_ENV_KEYS) {
        if (!env[key] && process.env[key]) {
            env[key] = process.env[key] as string;
        }
    }
    const missing = REQUIRED_E2E_ENV_KEYS.filter((key) => !env[key]);
    if (missing.length > 0) {
        throw new Error(`Missing required E2E env vars: ${missing.join(', ')}`);
    }
    return env;
}

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
        env: loadDotEnv(resolve(import.meta.dirname, '.env.e2e')),
        reporters: ['verbose', 'junit'],
        outputFile: { junit: 'test-results/junit.xml' },
        coverage: {
            provider: 'v8',
            reporter: ['text', 'lcov', 'html'],
            include: ['src/**'],
        },
    },
});
