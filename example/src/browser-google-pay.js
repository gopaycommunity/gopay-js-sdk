import { requireAttachedSDK } from './browser-sdk.js';
import {
    createGooglePayButton,
    ensureGooglePayLoaded,
    extractGooglePayInstrument,
    loadGooglePayData,
} from './google-pay-shared.js';
import { formatError, pollChargeState, show3dsPrompt } from './helpers.js';

let _gpInfo = null;
let _gpBrowserSdk = null;

export async function browserGooglePayLoadInfo() {
    const pre = document.getElementById('bgpay-output');
    const container = document.getElementById('bgpay-button-container');
    container.innerHTML = '';
    _gpInfo = null;
    _gpBrowserSdk = null;

    if (!ensureGooglePayLoaded(pre)) return;

    const browserSdk = requireAttachedSDK(pre);
    if (!browserSdk) return;

    pre.textContent = '── fetching Google Pay info ──';
    try {
        _gpInfo = await browserSdk.getGooglePayInfo();
        _gpBrowserSdk = browserSdk;
        pre.textContent = `── onSuccess (getGooglePayInfo) ──\n${JSON.stringify(_gpInfo, null, 2)}\n\nClick the Google Pay button to proceed.`;
    } catch (err) {
        pre.textContent = `── onError ──\n${formatError(err)}`;
        return;
    }

    const btn = createGooglePayButton(_gpInfo, _browserGooglePayCharge);
    container.appendChild(btn);
}

async function _browserGooglePayCharge() {
    const pre = document.getElementById('bgpay-output');
    if (!_gpBrowserSdk || !_gpInfo) return;

    const paymentData = await loadGooglePayData(_gpInfo, pre);
    if (!paymentData) return;

    const instrument = extractGooglePayInstrument(paymentData);

    pre.textContent += '\n── charging ──';
    try {
        const chargeResult = await _gpBrowserSdk.chargePayment({
            payment_instrument: instrument,
        });
        pre.textContent += `\n${JSON.stringify(chargeResult, null, 2)}`;

        if (
            chargeResult.state === 'ACTION_REQUIRED' &&
            chargeResult.action?.redirect_url
        ) {
            show3dsPrompt(pre, chargeResult.action.redirect_url);
        }

        if (
            chargeResult.state !== 'SUCCEEDED' &&
            chargeResult.state !== 'FAILED'
        ) {
            await pollChargeState(
                (opts) => _gpBrowserSdk.awaitChargeState(null, opts),
                pre,
            );
        }
    } catch (err) {
        pre.textContent += `\n\n── onError (charge) ──\n${formatError(err)}`;
    }
}
