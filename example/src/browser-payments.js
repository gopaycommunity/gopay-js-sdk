import { requireAttachedSDK } from './browser-sdk.js';
import { formatError } from './helpers.js';
import { renderQRImage } from './qr-render.js';

export async function browserQRPaymentInfo() {
    const pre = document.getElementById('bqr-output');
    const format = document.getElementById('bqr-format').value || undefined;

    const browserSdk = requireAttachedSDK(pre);
    if (!browserSdk) return;

    pre.textContent = '── fetching QR info ──';
    try {
        const result = await browserSdk.getQRPaymentInfo(format);
        pre.textContent = `── onSuccess ──\n${JSON.stringify(result, null, 2)}`;
        renderQRImage(pre, result, format);
    } catch (err) {
        pre.textContent += `\n\n── onError ──\n${formatError(err)}`;
    }
}
