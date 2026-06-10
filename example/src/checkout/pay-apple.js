import { getBrowserSDK } from '../browser-sdk.js';
import {
    hidePaymentErrorBanner,
    showPaymentErrorBanner,
    showStatusFailure,
    showStatusSuccess,
} from './dom.js';

let _ctrl = null;

/** Called once bootstrap completes. */
export async function mountApplePayButton() {
    const browserSdk = getBrowserSDK();
    if (!browserSdk) {
        return;
    }

    const container = document.getElementById('applepay-button-container');
    if (!container || container.children.length > 0) {
        return; // already mounted
    }

    try {
        _ctrl = await browserSdk.mountApplePayButton(container, {
            onUnavailable: () => {
                const col = document.getElementById('wallet-col-applepay');
                if (col) {
                    col.style.display = 'none';
                }
                const gpayCol = document.getElementById('wallet-col-gpay');
                if (gpayCol && gpayCol.style.display !== 'none') {
                    gpayCol.style.gridColumn = '1 / -1';
                }
                console.debug(
                    '[checkout] Apple Pay unavailable on this device',
                );
            },
            onCancel: () => {
                console.debug('[checkout] Apple Pay cancelled by user');
            },
            appleButtonOptions: {
                buttonstyle: 'black',
                type: 'subscribe',
                locale: 'cs-CZ',
            },
        });
    } catch (err) {
        console.error('[checkout] Apple Pay mount error', err);
        return;
    }

    _ctrl.result.then(
        (chargeState) => {
            console.debug('[checkout] Apple Pay charge result', chargeState);
            hidePaymentErrorBanner();

            if (chargeState?.state === 'SUCCEEDED') {
                showStatusSuccess();
            } else if (chargeState?.action?.redirect_url) {
                window.location.href = chargeState.action.redirect_url;
            } else {
                showStatusFailure();
            }
        },
        (err) => {
            console.error('[checkout] Apple Pay charge error', err);
            showPaymentErrorBanner();
        },
    );
}
