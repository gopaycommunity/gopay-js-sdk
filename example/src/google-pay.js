// Google Pay flow — two steps:
//
// Step 1 (googlePayLoadInfo): call sdk.getGooglePayInfo(paymentId) to fetch the
//   PaymentsClient config and paymentDataRequest from the GoPay API. This must happen before
//   rendering the Google Pay button, and the button must be created via Google's own
//   paymentsClient.createButton() so it meets Google's UX requirements.
//
// Step 2 (googlePayOpenSheet): call paymentsClient.loadPaymentData() from within the button's
//   click handler (must be user-initiated). Parse the tokenizationData.token JSON string to
//   extract { protocolVersion, signature, signedMessage }, then pass them to sdk.chargePayment()
//   as input_type: 'GOOGLE_PAY'.
//
// Note: load the Google Pay script in your HTML:
//   <script async src="https://pay.google.com/gp/p/js/pay.js"></script>

import {
    createGooglePayButton,
    ensureGooglePayLoaded,
    extractGooglePayInstrument,
    loadGooglePayData,
} from './google-pay-shared.js';
import { formatError, prefillCharge } from './helpers.js';
import { sdk } from './sdk.js';

// Holds the config fetched in step 1, consumed in step 2
let _googlePayInfo = null;
let _googlePaymentId = null;

export async function googlePayLoadInfo() {
    const paymentId = document
        .getElementById('googlepay-payment-id')
        .value.trim();
    const pre = document.getElementById('googlepay-output');
    const container = document.getElementById('googlepay-button-container');
    container.innerHTML = '';
    _googlePayInfo = null;
    _googlePaymentId = null;

    if (!ensureGooglePayLoaded(pre)) return;

    pre.textContent = 'Step 1: Fetching Google Pay info…';
    try {
        _googlePayInfo = await sdk.getGooglePayInfo(paymentId);
        _googlePaymentId = paymentId;
        pre.textContent = `── onSuccess (getGooglePayInfo) ──\n${JSON.stringify(_googlePayInfo, null, 2)}\n\nClick the Google Pay button to proceed.`;
    } catch (err) {
        pre.textContent = `── onError (getGooglePayInfo) ──\n${formatError(err)}`;
        return;
    }

    // Render the Google Pay button — loadPaymentData must be called directly from its click
    const btn = createGooglePayButton(_googlePayInfo, googlePayOpenSheet);
    container.appendChild(btn);
}

async function googlePayOpenSheet() {
    const pre = document.getElementById('googlepay-output');
    if (!_googlePayInfo || !_googlePaymentId) return;

    const paymentData = await loadGooglePayData(_googlePayInfo, pre);
    if (!paymentData) return;

    pre.textContent += '\n\n── onSuccess (loadPaymentData) ──';
    // tokenizationData.token is a JSON string: { protocolVersion, signature, signedMessage, ... }
    prefillCharge(_googlePaymentId, extractGooglePayInstrument(paymentData));
    pre.textContent += '\n\nCharge section prefilled — scroll down to run.';
}
