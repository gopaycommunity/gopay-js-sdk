import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig, loadEnv } from 'vite';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(__dirname, '..');

const certKey = resolve(__dirname, 'certs', 'localhost-key.pem');
const certFile = resolve(__dirname, 'certs', 'localhost.pem');
const hasMkcert = existsSync(certKey) && existsSync(certFile);

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, resolve(repoRoot, 'sdk'), 'GP_GW_JS_SDK_');

    return {
        envDir: resolve(repoRoot, 'sdk'),
        envPrefix: 'GP_GW_JS_SDK_',
        plugins: [...(hasMkcert ? [] : [basicSsl()]), tailwindcss()],
        server: {
            port: 3000,
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
