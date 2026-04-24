import { createReadStream, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = resolve(fileURLToPath(import.meta.url), '..', 'dist');
const port = process.env.PORT ?? 8080;

const mime = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
};

createServer((req, res) => {
    if (req.url === '/env.js') {
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        res.end(
            `window._gpConfig = ${JSON.stringify({ baseUrl: process.env.GP_GW_JS_SDK_BASE_URL ?? null })};`,
        );
        return;
    }

    const url = new URL(req.url, 'http://localhost');
    let file = join(dist, url.pathname);

    if (!existsSync(file)) {
        // Only fall back to index.html for extensionless paths (SPA routes).
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
}).listen(port, () => console.log(`Serving on http://localhost:${port}`));
