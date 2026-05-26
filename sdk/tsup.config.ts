import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'tsup';

const pkgDir = dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(
    readFileSync(join(pkgDir, 'package.json'), 'utf-8'),
) as { version: string };

export default defineConfig({
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    sourcemap: true,
    outDir: 'dist',
    noExternal: ['@gopay-internal/core'],
    define: {
        __GOPAY_SDK_VERSION__: JSON.stringify(version),
    },
});
