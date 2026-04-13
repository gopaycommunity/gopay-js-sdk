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
    // sourcemap is intentionally disabled: the .map file would expose full
    // unminified source on the public CDN, which is a PCI-DSS Req 6.4.3 concern.
    {
        entry: { 'gopay-sdk.min': 'src/index.ts' },
        format: ['iife'],
        globalName: 'GoPaySDK',
        minify: true,
        sourcemap: false,
        outDir: 'dist',
        // Strip the default `.global` extension suffix tsup adds for IIFE
        outExtension: () => ({ js: '.js' }),
    },
]);
