import { DEFAULT_CARD_FORM_THEME } from '@gopaycz/gopay-js-sdk-browser';
import { getBrowserSDK } from '../browser-sdk.js';
import {
    setPayButtonEnabled,
    showStatusFailure,
    showStatusSuccess,
} from './dom.js';

let _controller = null;
let _mounting = false;

/**
 * Called once bootstrap has completed.
 * Mounts the card iframe with external-submit + direct-charge so the
 * big Zaplatit button drives submission and the SDK charges immediately.
 */
export async function mountCheckoutCardForm() {
    if (_mounting || _controller) {
        return;
    }

    const browserSdk = getBrowserSDK();
    if (!browserSdk) {
        return;
    }

    const container = document.getElementById('card-iframe-container');
    if (!container) {
        return;
    }

    _mounting = true;

    try {
        _controller = await browserSdk.mountCardForm(container, {
            flow: 'direct-charge',
            theme: DEFAULT_CARD_FORM_THEME,
            locale: 'cs',
            submitMode: 'external',
            onValidityChange: (isValid) => {
                setPayButtonEnabled(isValid);
            },
        });
        _mounting = false;

        // direct-charge resolves with the charge state once the SDK finishes
        const chargeState = await _controller.result;
        _controller = null;
        console.debug('[checkout] card charge result', chargeState);

        if (chargeState?.state === 'SUCCEEDED') {
            showStatusSuccess();
        } else if (chargeState?.action?.redirect_url) {
            // 3DS required — redirect in the same window; return_url brings us back
            window.location.href = chargeState.action.redirect_url;
        } else {
            showStatusFailure();
        }
    } catch (err) {
        _mounting = false;
        _controller = null;
        console.error('[checkout] card form error', err);
        showStatusFailure();
    }
}

/** Called by the Zaplatit button. */
export function submitCardForm() {
    _controller?.submit();
}
