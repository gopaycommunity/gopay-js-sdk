import { existsSync, readdirSync, readFileSync } from 'node:fs';
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

// ── Dev HTTPS ───────────────────────────────────────────────────────────────
// Serving the demo under a real hostname rather than localhost is not cosmetic.
// The production WAF rejects any request whose body mentions a loopback or
// private-network host (localhost, 127.0.0.1, 0.0.0.0, 192.168.*) with a bare
// 403 from the load balancer, and the example derives its callback URLs from
// window.location.origin — so on localhost every createPayment() against
// production fails before it reaches the API. See README, "Local HTTPS".
//
// Configure with:
//   GP_DEV_HOST      address to bind, default 127.0.0.1 (see the note on server.host)
//   GP_DEV_CERT      path to a certificate, overrides discovery
//   GP_DEV_CERT_KEY  path to its private key
const CERT_DIR = resolve(__dirname, 'certs');
const LOOPBACK_NAMES = ['localhost', '127.0.0.1'];

/**
 * Find a usable certificate without knowing anyone's hostname in advance.
 *
 * An explicit GP_DEV_CERT pair wins. Otherwise every `<name>-key.pem` in
 * certs/ with a matching `<name>.pem` counts as a candidate — the layout mkcert
 * produces, including its `name+2` multi-SAN suffix. Loopback-only certs sort
 * last, so a hostname cert is preferred when both are present.
 */
function findCertPair(): { name: string; key: string; cert: string } | null {
    const { GP_DEV_CERT: cert, GP_DEV_CERT_KEY: key } = process.env;
    if (cert && key) {
        if (!existsSync(cert) || !existsSync(key)) {
            throw new Error(
                `GP_DEV_CERT / GP_DEV_CERT_KEY point at a missing file: ${cert}, ${key}`,
            );
        }
        return { name: '', cert, key };
    }
    if (!existsSync(CERT_DIR)) {
        return null;
    }
    const pairs = readdirSync(CERT_DIR)
        .filter((f) => f.endsWith('-key.pem'))
        .map((f) => f.slice(0, -'-key.pem'.length))
        .map((name) => ({
            name,
            key: resolve(CERT_DIR, `${name}-key.pem`),
            cert: resolve(CERT_DIR, `${name}.pem`),
        }))
        .filter((p) => existsSync(p.cert))
        .sort(
            (a, b) =>
                Number(isLoopbackCert(a.name)) - Number(isLoopbackCert(b.name)),
        );
    return pairs[0] ?? null;
}

/** mkcert names a cert after its first SAN, with a `+N` suffix for the rest. */
const certHostname = (name: string) => name.split('+')[0];
const isLoopbackCert = (name: string) =>
    LOOPBACK_NAMES.includes(certHostname(name));

const certPair = findCertPair();
const devHost = process.env.GP_DEV_HOST ?? '127.0.0.1';

// The card form iframe runs sandboxed (no allow-same-origin), so its origin is
// "null" — that entry is what lets Vite's injected @vite/client script load.
// The rest is whatever this machine can actually be reached on.
const devOrigins = [
    ...new Set([
        ...LOOPBACK_NAMES,
        devHost,
        ...(certPair?.name ? [certHostname(certPair.name)] : []),
    ]),
].map((h) => h.replaceAll('.', String.raw`\.`));
const DEV_ORIGIN_PATTERN = new RegExp(
    String.raw`^https?://(${devOrigins.join('|')})(:\d+)?$`,
);

export default defineConfig(() => {
    return {
        // Vite requires a trailing slash; serve.js strips it for prefix matching.
        base: process.env.GP_BASE_PATH ?? '/',
        envDir: resolve(repoRoot, 'sdk'),
        envPrefix: 'GOPAY_PAYMENTS_V4_',
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
            ...(certPair ? [] : [basicSsl()]),
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
                            `window._gpConfig = ${JSON.stringify({ baseUrl: process.env.GOPAY_PAYMENTS_V4_BASE_URL ?? null, environment: process.env.GOPAY_PAYMENTS_V4_ENVIRONMENT ?? null })};`,
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
            // Bind IPv4 explicitly. Vite's default 'localhost' resolves to ::1
            // on macOS and binds IPv6 only, which leaves a hostname alias added
            // to /etc/hosts as 127.0.0.1 — the conventional form — refusing
            // connections. Browsers still reach https://localhost:8080, they
            // fall back to IPv4. Override with GP_DEV_HOST.
            host: devHost,
            fs: {
                // Allow Vite to serve TypeScript source files from outside the
                // example/ project root (browser-sdk/ and internal/core/).
                allow: ['..'],
            },
            cors: { origin: ['null', DEV_ORIGIN_PATTERN] },
            ...(certPair
                ? {
                      https: {
                          key: readFileSync(certPair.key),
                          cert: readFileSync(certPair.cert),
                      },
                  }
                : {}),
        },
    };
});
