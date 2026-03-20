import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig, loadEnv } from 'vite';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(__dirname, '..');

const MIME: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css',
};

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, resolve(repoRoot, 'sdk'), 'GP_GW_JS_SDK_');

    return {
        envDir: resolve(repoRoot, 'sdk'),
        envPrefix: 'GP_GW_JS_SDK_',
        plugins: [
            basicSsl(),
            tailwindcss(),
            {
                name: 'serve-repo-sdk',
                configureServer(server) {
                    // Serve /sdk/* from the repo-root sdk directory so the card
                    // encryption iframe (sdk/src/iframe/card-encrypt.html) is reachable.
                    server.middlewares.use((req, res, next) => {
                        const url = (req.url ?? '').split('?')[0];
                        if (!url.startsWith('/sdk/')) return next();
                        const file = resolve(repoRoot, url.slice(1));
                        if (!existsSync(file) || statSync(file).isDirectory())
                            return next();
                        const ct =
                            MIME[extname(file)] ?? 'application/octet-stream';
                        res.setHeader('Content-Type', ct);
                        createReadStream(file).pipe(res as never);
                    });
                },
            },
        ],
        server: {
            port: 3000,
            ...(env.GP_GW_JS_SDK_BASE_URL
                ? {
                      proxy: {
                          '/proxy': {
                              target: env.GP_GW_JS_SDK_BASE_URL,
                              changeOrigin: true,
                              rewrite: (path) => path.replace(/^\/proxy/, ''),
                          },
                      },
                  }
                : {}),
        },
    };
});
