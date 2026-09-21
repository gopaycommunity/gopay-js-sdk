import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'tsup';

const pkgDir = dirname(fileURLToPath(import.meta.url));
const pkg: { version: string } = JSON.parse(
    readFileSync(join(pkgDir, 'package.json'), 'utf-8'),
);
const { version } = pkg;

const define = { __GOPAY_BROWSER_SDK_VERSION__: JSON.stringify(version) };

// Which distribution is running, decided at build time because the bundle
// cannot tell at runtime. Worth having: "only the CDN bundle fails" is a
// different investigation from "every integration fails".
const defineEsm = { ...define, __GOPAY_INTEGRATION__: '"browser-sdk-esm"' };
const defineIife = { ...define, __GOPAY_INTEGRATION__: '"browser-sdk-iife"' };

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
        define: defineEsm,
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
        define: defineIife,
    },
]);
