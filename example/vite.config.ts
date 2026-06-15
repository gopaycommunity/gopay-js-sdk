import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig } from 'vite';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(__dirname, '..');

function readPkgVersion(path: string): string {
    const pkg: { version: string } = JSON.parse(readFileSync(path, 'utf-8'));
    return pkg.version;
}
const sdkVersion = readPkgVersion(resolve(repoRoot, 'sdk/package.json'));
const browserSdkVersion = readPkgVersion(
    resolve(repoRoot, 'browser-sdk/package.json'),
);

const certKey = resolve(__dirname, 'certs', 'localhost-key.pem');
const certFile = resolve(__dirname, 'certs', 'localhost.pem');
const hasMkcert = existsSync(certKey) && existsSync(certFile);

export default defineConfig(() => {
    return {
        // Vite requires a trailing slash; serve.js strips it for prefix matching.
        base: process.env.GP_BASE_PATH ?? '/',
        envDir: resolve(repoRoot, 'sdk'),
        envPrefix: 'GP_GW_JS_SDK_',
        define: {
            __GOPAY_SDK_VERSION__: JSON.stringify(sdkVersion),
            __GOPAY_BROWSER_SDK_VERSION__: JSON.stringify(browserSdkVersion),
        },
        resolve: {
            alias: [
                // Point workspace packages to TypeScript source so Vite doesn't
                // require a dist build before starting the dev server.
                {
                    find: '@gopaycz/gopay-js-sdk',
                    replacement: resolve(repoRoot, 'sdk/src/index.ts'),
                },
                {
                    find: '@gopaycz/gopay-js-sdk-browser',
                    replacement: resolve(repoRoot, 'browser-sdk/src/index.ts'),
                },
                {
                    find: '@gopay-internal/core',
                    replacement: resolve(
                        repoRoot,
                        'internal/core/src/index.ts',
                    ),
                },
            ],
        },
        plugins: [
            ...(hasMkcert ? [] : [basicSsl()]),
            tailwindcss(),
            {
                name: 'html-include',
                transformIndexHtml(html) {
                    return html.replace(
                        /<!--\s*#include\s+"([^"]+)"\s*-->/g,
                        (_, file) =>
                            readFileSync(resolve(__dirname, file), 'utf-8'),
                    );
                },
            },
            {
                name: 'env-js',
                configureServer(server) {
                    server.middlewares.use('/env.js', (_req, res) => {
                        res.setHeader('Content-Type', 'application/javascript');
                        res.end(
                            `window._gpConfig = ${JSON.stringify({ baseUrl: process.env.GP_GW_JS_SDK_BASE_URL ?? null })};`,
                        );
                    });
                },
            },
        ],
        build: {
            rollupOptions: {
                input: {
                    main: resolve(__dirname, 'index.html'),
                },
            },
        },
        server: {
            port: 8080,
            fs: {
                // Allow Vite to serve TypeScript source files from outside the
                // example/ project root (browser-sdk/ and internal/core/).
                allow: ['..'],
            },
            // The card form iframe runs sandboxed (no allow-same-origin), so its origin
            // is "null". Allow null-origin requests so Vite's injected @vite/client
            // script loads correctly during development.
            cors: { origin: ['null', /^https?:\/\/localhost(:\d+)?$/] },
            ...(hasMkcert
                ? {
                      https: {
                          key: readFileSync(certKey),
                          cert: readFileSync(certFile),
                      },
                  }
                : {}),
        },
    };
});
