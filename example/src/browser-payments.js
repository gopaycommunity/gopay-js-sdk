import { requireAttachedSDK } from './browser-sdk.js';
import { formatError } from './helpers.js';
import { renderQRImage } from './qr-render.js';

export async function browserGetStatus() {
    const pre = document.getElementById('bstatus-output');
    const browserSdk = requireAttachedSDK(pre);
    if (!browserSdk) {
        return;
    }
    pre.textContent = '── fetching payment status ──';
    try {
        const result = await browserSdk.getStatus();
        pre.textContent = `── onSuccess ──\n${JSON.stringify(result, null, 2)}`;
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
        pre.textContent = `── onSuccess ──\n${JSON.stringify(result, null, 2)}`;
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
        pre.textContent = `── onSuccess ──\n${JSON.stringify(result, null, 2)}`;
        renderQRImage(pre, result);
    } catch (err) {
        pre.textContent += `\n\n── onError ──\n${formatError(err)}`;
    }
}
