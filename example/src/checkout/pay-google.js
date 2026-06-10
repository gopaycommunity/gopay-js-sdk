import { getBrowserSDK } from '../browser-sdk.js';
import {
    hidePaymentErrorBanner,
    showPaymentErrorBanner,
    showStatusFailure,
    showStatusSuccess,
} from './dom.js';

let _ctrl = null;

/** Called once bootstrap completes. */
export async function mountGooglePayButton() {
    const browserSdk = getBrowserSDK();
    if (!browserSdk) {
        return;
    }

    const container = document.getElementById('gpay-button-container');
    if (!container || container.children.length > 0) {
        return; // already mounted
    }

    try {
        _ctrl = await browserSdk.mountGooglePayButton(container, {
            onUnavailable: () => {
                const col = document.getElementById('wallet-col-gpay');
                if (col) {
                    col.style.display = 'none';
                }
                // If Apple Pay is also unavailable the wallet row collapses naturally
                const appleCol = document.getElementById('wallet-col-applepay');
                if (appleCol && appleCol.style.display !== 'none') {
                    appleCol.style.gridColumn = '1 / -1';
                }
                console.debug(
                    '[checkout] Google Pay unavailable on this device',
                );
            },
            onCancel: () => {
                console.debug('[checkout] Google Pay cancelled by user');
            },
            googleButtonOptions: {
                buttonColor: 'black',
                buttonType: 'subscribe',
                buttonSizeMode: 'fill',
                buttonRadius: 12,
                buttonLocale: 'cs',
            },
        });
    } catch (err) {
        console.error('[checkout] Google Pay mount error', err);
        return;
    }

    _ctrl.result.then(
        (chargeState) => {
            console.debug('[checkout] Google Pay charge result', chargeState);
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
            console.error('[checkout] Google Pay charge error', err);
            showPaymentErrorBanner();
        },
    );
}
