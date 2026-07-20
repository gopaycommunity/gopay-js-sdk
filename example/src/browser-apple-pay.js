import { requireAttachedSDK } from './browser-sdk.js';
import { formatError } from './helpers.js';
import { sanitizeBody } from './sanitize.js';

let _ctrl = null;

export async function browserApplePayLoadInfo() {
    const pre = document.getElementById('bapplepay-output');
    const container = document.getElementById('bapplepay-button-container');

    _ctrl?.unmount();
    _ctrl = null;
    container.replaceChildren();

    const sdk = requireAttachedSDK(pre);
    if (!sdk) {
        return;
    }

    pre.textContent = '── mounting Apple Pay button ──';

    try {
        _ctrl = await sdk.mountApplePayButton(container, {
            onUnavailable: () => {
                pre.textContent =
                    '── Apple Pay not available on this device or browser ──';
            },
            onCancel: () => {
                pre.textContent +=
                    '\n\n── onCancel (user dismissed the Apple Pay sheet) ──';
            },
        });
    } catch (err) {
        pre.textContent = `── onError (mount) ──\n${formatError(err)}`;
        return;
    }

    pre.textContent =
        '── Apple Pay button mounted — click it to start payment ──';

    _ctrl.result.then(
        (chargeState) => {
            pre.textContent = `── onSuccess (charge) ──\n${JSON.stringify(sanitizeBody(chargeState), null, 2)}`;
        },
        (err) => {
            pre.textContent = `── onError (charge) ──\n${formatError(err)}`;
        },
    );
}
