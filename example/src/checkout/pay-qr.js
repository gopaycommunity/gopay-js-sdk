import { getBrowserSDK } from '../browser-sdk.js';
import { sdk } from '../sdk.js';
import { showStatusSuccess } from './dom.js';

const POLL_INTERVAL_MS = 3000;
const POLL_MAX_ATTEMPTS = 40; // 2 minutes

let _polling = false;

/** Called after bootstrap completes. Fetches QR code and starts polling. */
export async function mountQRPayment() {
    const browserSdk = getBrowserSDK();
    if (!browserSdk) {
        return;
    }

    const container = document.getElementById('qr-image-container');
    if (!container || container.dataset.loaded) {
        return;
    }

    try {
        const info = await browserSdk.getQRPaymentInfo();
        const base64 = info?.qr_code?.spayd;
        if (!base64) {
            console.error('[checkout] QR: no spayd code in response', info);
            return;
        }

        const img = document.createElement('img');
        img.src = `data:image/png;base64,${base64}`;
        img.alt = 'QR kód pro platbu převodem';
        img.className = 'w-48 h-48 mx-auto block';
        container.innerHTML = '';
        container.appendChild(img);
        container.dataset.loaded = '1';

        document.getElementById('qr-loading')?.classList.add('hidden');
        document.getElementById('qr-content')?.classList.remove('hidden');

        console.debug('[checkout] QR code rendered');

        if (!_polling) {
            _polling = true;
            pollQRPayment();
        }
    } catch (err) {
        console.error('[checkout] QR mount error', err);
    }
}

async function pollQRPayment() {
    const paymentId = sessionStorage.getItem('checkout_payment_id');
    if (!paymentId) {
        console.error('[checkout] QR: missing checkout_payment_id');
        _polling = false;
        return;
    }
    for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
        try {
            const status = await sdk.getPaymentStatus(paymentId);
            console.debug('[checkout] QR payment status poll', status);
            if (status?.state === 'PAID') {
                sessionStorage.removeItem('checkout_payment_id');
                _polling = false;
                showStatusSuccess();
                return;
            }
        } catch (err) {
            console.error('[checkout] QR poll error', err);
        }
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    _polling = false;
    console.debug('[checkout] QR payment polling timed out');
}
