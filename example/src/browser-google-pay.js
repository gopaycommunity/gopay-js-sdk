import { requireAttachedSDK } from './browser-sdk.js';
import { formatError } from './helpers.js';

let _ctrl = null;

export async function browserGooglePayLoadInfo() {
    const pre = document.getElementById('bgpay-output');
    const container = document.getElementById('bgpay-button-container');

    _ctrl?.unmount();
    _ctrl = null;
    container.replaceChildren();

    const sdk = requireAttachedSDK(pre);
    if (!sdk) {
        return;
    }

    const return_url = document.getElementById('bgpay-return-url').value.trim();
    pre.textContent = '── mounting Google Pay button ──';

    try {
        _ctrl = await sdk.mountGooglePayButton(container, {
            // TODO: optional per spec — backend erroneously requires it
            return_url,
            onUnavailable: () => {
                pre.textContent =
                    '── Google Pay not available on this device or browser ──';
            },
            onCancel: () => {
                pre.textContent +=
                    '\n\n── onCancel (user dismissed the Google Pay sheet) ──';
            },
        });
    } catch (err) {
        pre.textContent = `── onError (mount) ──\n${formatError(err)}`;
        return;
    }

    pre.textContent =
        '── Google Pay button mounted — click it to start payment ──';

    _ctrl.result.then(
        (chargeState) => {
            pre.textContent = `── onSuccess ──\n${JSON.stringify(chargeState, null, 2)}`;
        },
        (err) => {
            pre.textContent = `── onError ──\n${formatError(err)}`;
        },
    );
}
