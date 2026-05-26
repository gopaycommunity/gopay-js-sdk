import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'tsup';

const pkgDir = dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(
    readFileSync(join(pkgDir, 'package.json'), 'utf-8'),
) as { version: string };

const define = { __GOPAY_BROWSER_SDK_VERSION__: JSON.stringify(version) };

export default defineConfig([
    // ESM + CJS dual package with type declarations
    {
        entry: { index: 'src/index.ts' },
        format: ['esm', 'cjs'],
        dts: true,
        clean: true,
        sourcemap: true,
        outDir: 'dist',
        noExternal: ['@gopay-internal/core'],
        define,
    },
    // IIFE browser bundle (script src)
    {
        entry: { 'gopay-browser-sdk.min': 'src/index.ts' },
        format: ['iife'],
        globalName: 'GoPayBrowserSDK',
        minify: true,
        sourcemap: true,
        outDir: 'dist',
        outExtension: () => ({ js: '.js' }),
        noExternal: ['@gopay-internal/core'],
        define,
    },
]);
