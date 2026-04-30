// Static fallback so Vite registers this path as a known asset and rewrites
// the /env.js reference in index.html to include the GP_BASE_PATH prefix.
// At runtime serve.js intercepts the request and returns the real config;
// this file is never actually served in production.
window._gpConfig = { baseUrl: null };
