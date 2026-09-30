/**
 * Refuse anything but a non-production GoPay gateway as the e2e-on-env target.
 *
 * TARGET_BASE_URL is free text, so this is the first thing that looks at it - the step runs it
 * ahead of `corepack enable`, since it has no dependencies and so costs a second rather than an
 * install.
 *
 * A substring test on the raw string is not enough: `https://%67ate.gopay.com/` and
 * `https://gate%2Egopay.com/` both parse to the host `gate.gopay.com`, so the request would reach
 * production while the raw string contains neither. Compare the parsed, lower-cased hostname.
 *
 * assertNotProduction() in example/runtime-config.js is the backstop once the page is served.
 */

// Named for the error message only - the zone allowlist below already excludes all three. Listing
// them means a run aimed at production says "production" rather than "outside the allowed zones".
const PRODUCTION_HOSTS = ['gate.gopay.com', 'secure.gopay.com', 'lx.gopay.com'];

// An allowlist of non-production zones rather than of the whole `gopay.com` suffix, because
// production is not one host: the repo declares `gate.gopay.com` (API) and `lx.gopay.com` (logger)
// in internal/core/src/config.ts and `secure.gopay.com` (card form) in browser-sdk/src/config.ts,
// and a suffix rule admitted the last two. Zones put every production host outside by
// construction, and stay correct when the next one is added.
const ALLOWED_ZONES = [
    '.dev.gopay.com',
    '.sandbox.gopay.com',
    '.test.gopay.com',
];

const raw = process.argv[2];

if (!raw) {
    console.error('TARGET_BASE_URL is empty - pass a gateway URL');
    process.exit(1);
}

let hostname;
try {
    const url = new URL(raw);
    // https only. The step keeps the secured workspace client id and secret, and authenticate()
    // sends them as HTTP Basic - over http: that is a cleartext credential on the wire. Nothing
    // legitimate is lost: every documented target is https, and the zone rule below already
    // excludes the localhost and mock endpoints that http: would otherwise be wanted for.
    if (url.protocol !== 'https:') {
        console.error(`TARGET_BASE_URL is not an https URL - ${raw}`);
        process.exit(1);
    }
    // The trailing root dot is dropped before comparing: `gate.gopay.com.` is the same DNS name
    // as `gate.gopay.com`, and the parser keeps the dot, so without this the comparisons below
    // miss it and the run starts against production.
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

if (
    PRODUCTION_HOSTS.some(
        (host) => hostname === host || hostname.endsWith(`.${host}`),
    )
) {
    console.error(
        `refusing to run against production - ${raw} resolves to host ${hostname}`,
    );
    process.exit(1);
}

// The step copies TARGET_BASE_URL into GOPAY_PAYMENTS_V4_BASE_URL while keeping the secured
// workspace client id and secret, so the token request carries them in Basic auth to whatever host
// is named here. Secured variables are masked in the log precisely so they cannot be read; a
// free-text target with only a denylist routes around that. Personal environments, present and
// future, still match `.dev.gopay.com` with no code change.
if (!ALLOWED_ZONES.some((zone) => hostname.endsWith(zone))) {
    console.error(
        `refusing a target outside ${ALLOWED_ZONES.join(', ')} - ${raw} resolves to host ${hostname}`,
    );
    process.exit(1);
}

console.log(`target host: ${hostname}`);
