#!/usr/bin/env node
// example/serve.js
// Serves example/index.html with window.__ENV__ injected from sdk/.env.e2e.
// Missing or incomplete .env.e2e is handled gracefully — missing keys become null.

const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Parse sdk/.env.e2e — returns {} if the file is absent or unreadable
// ---------------------------------------------------------------------------
function loadEnv(filePath) {
    let raw;
    try {
        raw = fs.readFileSync(filePath, 'utf8');
    } catch {
        return {};
    }
    return Object.fromEntries(
        raw
            .split('\n')
            .map((l) => l.trim())
            .filter((l) => l && !l.startsWith('#'))
            .flatMap((l) => {
                const eq = l.indexOf('=');
                return eq > 0
                    ? [[l.slice(0, eq).trim(), l.slice(eq + 1).trim()]]
                    : [];
            }),
    );
}

const raw = loadEnv(path.join(ROOT, 'sdk/.env.e2e'));

// File values take precedence; fall back to process.env (CI repository variables)
const upstreamBaseUrl =
    raw.GP_GW_JS_SDK_BASE_URL || process.env.GP_GW_JS_SDK_BASE_URL || null;

/** Values exposed as window.__ENV__ in the browser */
const ENV = {
    // Point the SDK at the local proxy so the browser never hits the API directly
    baseUrl: upstreamBaseUrl ? `http://localhost:${PORT}/proxy` : null,
    clientId:
        raw.GP_GW_JS_SDK_CLIENT_ID ||
        process.env.GP_GW_JS_SDK_CLIENT_ID ||
        null,
    clientSecret:
        raw.GP_GW_JS_SDK_CLIENT_SECRET ||
        process.env.GP_GW_JS_SDK_CLIENT_SECRET ||
        null,
    goid: raw.GP_GW_JS_SDK_GOID || process.env.GP_GW_JS_SDK_GOID || null,
};

// ---------------------------------------------------------------------------
// Proxy — forwards /proxy/* to the upstream API, bypassing browser CORS
// ---------------------------------------------------------------------------
function proxyRequest(req, res) {
    if (!upstreamBaseUrl) {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end('Proxy: GP_GW_JS_SDK_BASE_URL is not set in sdk/.env.e2e');
        return;
    }

    const suffix = req.url.slice('/proxy'.length); // e.g. /oauth2/token
    const base = upstreamBaseUrl.endsWith('/')
        ? upstreamBaseUrl.slice(0, -1)
        : upstreamBaseUrl;
    const target = new URL(`${base}${suffix || '/'}`);

    const options = {
        method: req.method,
        headers: { ...req.headers, host: target.host },
    };
    delete options.headers.referer;
    delete options.headers.cookie;

    const transport = target.protocol === 'http:' ? http : https;
    const upstreamReq = transport.request(target, options, (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode, {
            ...upstreamRes.headers,
            'access-control-allow-origin': '*',
            'access-control-allow-headers': '*',
            'access-control-allow-methods': '*',
        });
        upstreamRes.pipe(res);
    });

    upstreamReq.on('error', (err) => {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end(`Proxy error: ${err.message}`);
    });

    req.pipe(upstreamReq);
}

// ---------------------------------------------------------------------------
// MIME types
// ---------------------------------------------------------------------------
const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript',
    '.mjs': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.map': 'application/json',
};

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------
function handler(req, res) {
    // Forward /proxy/* to the upstream API server-side (avoids browser CORS)
    if (
        req.url === '/proxy' ||
        req.url.startsWith('/proxy/') ||
        req.url.startsWith('/proxy?')
    ) {
        if (req.method === 'OPTIONS') {
            res.writeHead(204, {
                'access-control-allow-origin': '*',
                'access-control-allow-headers': '*',
                'access-control-allow-methods': '*',
            });
            res.end();
            return;
        }
        proxyRequest(req, res);
        return;
    }

    // Serve index.html for /, /index.html, and /example/index.html
    const urlPath = req.url.split('?')[0];
    const isIndex =
        urlPath === '/' ||
        urlPath === '/index.html' ||
        urlPath === '/example/index.html';
    const filePath = isIndex
        ? path.join(ROOT, 'example', 'index.html')
        : path.join(ROOT, urlPath);

    let content;
    try {
        content = fs.readFileSync(filePath);
    } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end(`Not found: ${urlPath}`);
        return;
    }

    const ext = path.extname(filePath);
    const mime = MIME[ext] || 'application/octet-stream';

    if (isIndex) {
        // Inject window.__ENV__ before </head>
        const injection = `<script>window.__ENV__ = ${JSON.stringify(ENV)};</script>`;
        content = content
            .toString()
            .replace('</head>', `  ${injection}\n</head>`);
    }

    res.writeHead(200, { 'Content-Type': mime });
    res.end(content);
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
const server = http.createServer(handler);

server.once('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`Error: port ${PORT} is already in use.`);
        console.error('A stale "serve" process may still be running.');
        console.error(`  Kill it: lsof -ti :${PORT} | xargs kill`);
        process.exit(1);
    }
    console.error('Server error:', err.message);
    process.exit(1);
});

server.listen(PORT, () => {
    console.log(`Example app running at http://localhost:${PORT}`);
});
