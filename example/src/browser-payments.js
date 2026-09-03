import {
    collectBrowserDataTolerantly,
    requireAttachedSDK,
} from './browser-sdk.js';
import { formatError } from './helpers.js';
import { appendOutput } from './output-scroll.js';
import { renderQRImage } from './qr-render.js';
import { sanitizeBody } from './sanitize.js';

export async function browserGetStatus() {
    const pre = document.getElementById('bstatus-output');
    const browserSdk = requireAttachedSDK(pre);
    if (!browserSdk) {
        return;
    }
    pre.textContent = '── fetching payment status ──';
    try {
        const result = await browserSdk.getStatus();
        pre.textContent = `── onSuccess ──\n${JSON.stringify(sanitizeBody(result), null, 2)}`;
    } catch (err) {
        pre.textContent = `── onError ──\n${formatError(err)}`;
    }
}

export async function browserGetChargeState() {
    const pre = document.getElementById('bcharge-state-output');
    const browserSdk = requireAttachedSDK(pre);
    if (!browserSdk) {
        return;
    }
    pre.textContent = '── fetching charge state ──';
    try {
        const result = await browserSdk.getChargeState();
        pre.textContent = `── onSuccess ──\n${JSON.stringify(sanitizeBody(result), null, 2)}`;
    } catch (err) {
        pre.textContent = `── onError ──\n${formatError(err)}`;
    }
}

export async function browserQRPaymentInfo() {
    const pre = document.getElementById('bqr-output');
    const format = document.getElementById('bqr-format').value || undefined;

    const browserSdk = requireAttachedSDK(pre);
    if (!browserSdk) {
        return;
    }

    pre.textContent = '── fetching QR info ──';
    try {
        const result = await browserSdk.getQRPaymentInfo(format);
        pre.textContent = `── onSuccess ──\n${JSON.stringify(sanitizeBody(result), null, 2)}`;
        renderQRImage(pre, result);
    } catch (err) {
        appendOutput(pre, `\n\n── onError ──\n${formatError(err)}`);
    }
}

/**
 * Collect `browser_data` here and hand it to the server-charge panels.
 *
 * This mirrors the real split: `ip`, `user_agent` and `accept_header` describe
 * the customer's connection, so they can only be collected in the customer's
 * browser. A server that fills them in from its own request authenticates from
 * the wrong address and the issuer rejects the charge. The merchant's page
 * collects them and posts them to its backend — the prefilled field below is
 * that hand-off, made visible.
 */
export async function browserGetBrowserData() {
    const pre = document.getElementById('bbrowserdata-output');
    pre.textContent = '── collecting browser data ──';
    try {
        const { data, note } = await collectBrowserDataTolerantly();
        pre.textContent = `── onSuccess ──\n${JSON.stringify(data, null, 2)}`;
        if (note) {
            appendOutput(pre, `\n\n${note}`);
        }
        const serialised = JSON.stringify(data);
        for (const id of ['charge-browser-data', 'charge-enc-browser-data']) {
            const el = document.getElementById(id);
            if (el) {
                el.value = serialised;
            }
        }
        appendOutput(
            pre,
            '\n\nPrefilled into the Browser Data field of both server charge panels.',
        );
    } catch (err) {
        pre.textContent = `── onError ──\n${formatError(err)}`;
    }
}
