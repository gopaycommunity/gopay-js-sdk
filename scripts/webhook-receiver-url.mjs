/**
 * Print the webhook receiver that belongs to the e2e-on-env target, or fail saying why there is none.
 *
 * The webhook delivery test reads back what the gateway delivered from demo-site's receiver
 * (GPOMA-2797). The gateway delivers to the demo-site of its own environment - gp-main's eshop
 * notification URL is `https://demo${GP_DOMAIN}/api/v1/webhooks` - so the receiver has to be
 * derived from the target, not taken from the workspace variable: that one names the receiver of
 * the environment the PR pipelines run on, and polling it after a run aimed elsewhere waits out the
 * timeout for a webhook that was delivered somewhere else.
 *
 * Only the dev cluster has a receiver: `gw.<env>.dev.gopay.com` -> `demo.<env>.dev.gopay.com`,
 * and only where demo-site runs with GOPAY_PAYMENTS_V4_WEBHOOK_INSPECTION on. Anything else exits
 * non-zero with the reason, which is what the step is for: a red webhook step on such an
 * environment means "no receiver here", not "delivery is broken".
 *
 * The URL goes to stdout and nothing else does, so the step can capture it.
 */

const raw = process.argv[2];

function fail(reason) {
    console.error(
        `No webhook receiver for ${raw || '(empty target)'}: ${reason}`,
    );
    console.error(
        'This step needs demo-site with GOPAY_PAYMENTS_V4_WEBHOOK_INSPECTION on the target environment, ' +
            'so it fails on every environment without it. The suite in the other step does not depend on it.',
    );
    process.exit(1);
}

let host;
try {
    host = new URL(raw).hostname.toLowerCase();
} catch {
    fail('not a URL');
}

const env = /^gw\.([a-z0-9-]+)\.dev\.gopay\.com$/.exec(host)?.[1];
if (!env) {
    fail(
        `${host} is not a dev-cluster gateway (gw.<env>.dev.gopay.com), and only those have a demo-site receiver`,
    );
}

const receiver = `https://demo.${env}.dev.gopay.com/api/v1/test/webhooks`;

// Asked once up front: a receiver that is not there fails the test at its first poll anyway, but
// with "receiver answered 404" or a fetch error, which reads like a broken test rather than a
// missing environment piece.
let response;
try {
    response = await fetch(receiver, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
    });
} catch (error) {
    fail(
        `${receiver} is unreachable (${error?.cause?.code ?? error?.name ?? 'error'}) - demo-site does not run on ${env}, or ${env} is down`,
    );
}
if (response.status === 404) {
    fail(
        `${receiver} answered 404 - demo-site runs on ${env}, but GOPAY_PAYMENTS_V4_WEBHOOK_INSPECTION is off`,
    );
}
if (!response.ok) {
    fail(`${receiver} answered ${response.status}`);
}

console.log(receiver);
