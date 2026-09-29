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
const GOPAY_SUFFIX = 'gopay.com';

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

// Everything else must still be a GoPay host. The pipeline copies TARGET_BASE_URL into
// GOPAY_PAYMENTS_V4_BASE_URL while keeping the secured workspace client id and secret, so the
// token request carries them to whatever host is named here. Secured variables are masked in the
// log precisely so they cannot be read; a free-text target with only a production denylist would
// route straight around that, by pointing a run at a host the runner does not control. An
// allowlist by suffix keeps every GoPay environment typeable - including ones that do not exist
// yet - while refusing to hand the credentials to anything outside the estate.
if (hostname !== GOPAY_SUFFIX && !hostname.endsWith(`.${GOPAY_SUFFIX}`)) {
    console.error(
        `refusing a target outside ${GOPAY_SUFFIX} - ${raw} resolves to host ${hostname}`,
    );
    process.exit(1);
}

console.log(`target host: ${hostname}`);
