import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = resolve(fileURLToPath(import.meta.url), '..', 'dist');
const port = process.env.PORT ?? 8080;

// Normalise to no trailing slash for string prefix matching below.
// vite.config.ts reads the same env var and passes it directly to Vite's `base`,
// which expects a trailing slash — the two usages are intentionally different.
const basePath = (process.env.GP_BASE_PATH ?? '').replace(/\/$/, '');

const mime = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
};

const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    // When deployed behind a reverse proxy that does NOT strip the base path
    // prefix (e.g. /gp-gw-js-sdk), normalise the pathname so the rest of
    // the handler can treat it as a root-relative path.
    if (
        basePath &&
        (url.pathname === basePath || url.pathname.startsWith(`${basePath}/`))
    ) {
        url.pathname = url.pathname.slice(basePath.length) || '/';
    }

    if (url.pathname === '/version') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(process.env.SDK_VERSION ?? 'dev');
        return;
    }

    if (url.pathname === '/env.js') {
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        res.end(
            `window._gpConfig = ${JSON.stringify({ baseUrl: process.env.GOPAY_PAYMENTS_V4_BASE_URL ?? null })};`,
        );
        return;
    }

    let file = join(dist, url.pathname);

    if (!existsSync(file) || statSync(file).isDirectory()) {
        // Only fall back to an HTML file for extensionless paths (SPA routes).
        // Missing assets (e.g. .js, .css) get a 404 to avoid masking build errors.
        if (extname(file)) {
            res.writeHead(404);
            res.end();
            return;
        }
        file = join(dist, 'index.html');
    }

    const type = mime[extname(file)] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    createReadStream(file).pipe(res);
});

const shutdown = () => {
    server.closeIdleConnections();
    server.close(() => process.exit(0));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

server.listen(port, () => console.log(`Serving on http://localhost:${port}`));
