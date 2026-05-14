import { getBrowserSDK, isSdkAttached } from './browser-sdk.js';
import { formatError, pollChargeState, show3dsPrompt } from './helpers.js';

const TERMINAL_STATES = new Set(['SUCCEEDED', 'FAILED']);

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
            'Error: No payment attached.\nRun payments.create() first.';
        return;
    }
    if (!encryptedPayload) {
        pre.textContent =
            'Error: Encrypted Payload required.\nComplete the card form above.';
        return;
    }

    pre.textContent = '── charging ──';

    try {
        const chargeResult = await browserSdk.chargePayment({
            payment_instrument: {
                payment_instrument: 'PAYMENT_CARD',
                input: {
                    input_type: 'Encrypted-Card-Input',
                    payload: encryptedPayload,
                },
            },
        });

        pre.textContent += `\n${JSON.stringify(chargeResult, null, 2)}`;

        if (TERMINAL_STATES.has(chargeResult.state)) return;

        if (
            chargeResult.state === 'ACTION_REQUIRED' &&
            chargeResult.action?.redirect_url
        ) {
            show3dsPrompt(pre, chargeResult.action.redirect_url);
        }

        await pollChargeState(
            (opts) => browserSdk.awaitChargeState(null, opts),
            pre,
        );
    } catch (err) {
        pre.textContent += `\n\n── onError ──\n${formatError(err)}`;
    }
}
