import { getBrowserSDK, isSdkAttached } from './browser-sdk.js';
import { chargeAndFollow } from './helpers.js';

export async function runBrowserCharge() {
    const encryptedPayload = document
        .getElementById('bcharge-encrypted-payload')
        .value.trim();
    const pre = document.getElementById('bcharge-output');

    const browserSdk = getBrowserSDK();
    if (!browserSdk) {
        pre.textContent =
            'Error: Browser SDK not initialized.\nRun auth.getBrowserKeys() or click "Initialize Browser SDK" first.';
        return;
    }
    if (!isSdkAttached()) {
        pre.textContent =
            'Error: No payment attached.\nRun sdk.createPayment() first.';
        return;
    }
    if (!encryptedPayload) {
        pre.textContent =
            'Error: Encrypted Payload required.\nComplete the card form above.';
        return;
    }

    // Payment-scoped: the browser SDK already knows which payment is attached,
    // so neither call takes an id the way the server SDK's do — awaitChargeState
    // takes the options as its *only* argument. Passing an id-shaped null first
    // silently discarded them, so this panel polled without ever reporting a
    // state or raising the 3DS prompt.
    await chargeAndFollow('bcharge-output', {
        charge: () =>
            browserSdk.chargePayment({
                payment_instrument: {
                    payment_instrument: 'PAYMENT_CARD',
                    input: {
                        input_type: 'ENCRYPTED_CARD',
                        payload: encryptedPayload,
                    },
                },
            }),
        awaitState: (opts) => browserSdk.awaitChargeState(opts),
    });
}
