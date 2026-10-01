import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'tsup';

const pkgDir = dirname(fileURLToPath(import.meta.url));
const pkg: { version: string } = JSON.parse(
    readFileSync(join(pkgDir, 'package.json'), 'utf-8'),
);
const { version } = pkg;

export default defineConfig({
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    // dts.resolve inlines @gopay-internal/core's types into the emitted .d.ts.
    // Without it the declarations `import ... from '@gopay-internal/core'`, a package
    // that is private and never published, so a consumer gets TS2307 with
    // skipLibCheck off and - far worse - every core-derived type silently becomes
    // `any` with it on, which is the usual setup. noExternal already inlines the
    // JavaScript; this is the same thing for the types.
    dts: { resolve: true },
    clean: true,
    sourcemap: true,
    outDir: 'dist',
    noExternal: ['@gopay-internal/core'],
    define: {
        __GOPAY_SDK_VERSION__: JSON.stringify(version),
    },
});
