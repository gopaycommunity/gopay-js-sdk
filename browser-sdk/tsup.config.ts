import { defineConfig } from 'tsup';

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
    },
]);
