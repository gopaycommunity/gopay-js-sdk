/**
 * Refuse a production gateway as the e2e-on-env target.
 *
 * The pipeline's TARGET_BASE_URL is free text, so this is the first thing that looks at it. A
 * substring test on the raw string is not enough: `https://%67ate.gopay.com/` and
 * `https://gate%2Egopay.com/` both parse to the host `gate.gopay.com`, so the request reaches
 * production while the raw string contains neither. Compare the parsed, lower-cased hostname.
 *
 * This fails in a second, before the install and the two builds. assertNotProduction() in
 * example/runtime-config.js is the backstop when the page is actually served.
 */
const PRODUCTION_HOST = 'gate.gopay.com';

const raw = process.argv[2];

if (!raw) {
    console.error('TARGET_BASE_URL is empty - pass a gateway URL');
    process.exit(1);
}

let hostname;
try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        console.error(`TARGET_BASE_URL is not an http(s) URL - ${raw}`);
        process.exit(1);
    }
    // The trailing root dot is dropped before comparing: `gate.gopay.com.` is the same DNS name
    // as `gate.gopay.com`, and the parser keeps the dot, so without this the comparison below
    // misses it and the run starts against production.
    hostname = url.hostname.toLowerCase().replace(/\.$/, '');
} catch {
    // An unparseable value cannot be shown to be safe, so it is refused rather than passed on.
    console.error(`TARGET_BASE_URL is not a URL - ${raw}`);
    process.exit(1);
}

if (!hostname) {
    console.error(`TARGET_BASE_URL has no host - ${raw}`);
    process.exit(1);
}

if (hostname === PRODUCTION_HOST || hostname.endsWith(`.${PRODUCTION_HOST}`)) {
    console.error(
        `refusing to run against production - ${raw} resolves to host ${hostname}`,
    );
    process.exit(1);
}

console.log(`target host: ${hostname}`);
