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
    },
    // IIFE browser bundle (script src)
    {
        entry: { 'gopay-sdk.min': 'src/index.ts' },
        format: ['iife'],
        globalName: 'GoPaySDK',
        minify: true,
        sourcemap: true,
        outDir: 'dist',
        // Strip the default `.global` extension suffix tsup adds for IIFE
        outExtension: () => ({ js: '.js' }),
    },
]);
