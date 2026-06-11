import { RED_CARD_FORM_THEME } from '@gopaycz/gopay-js-sdk-browser';
import { getBrowserSDK } from '../browser-sdk.js';
import {
    setPayButtonEnabled,
    showStatusFailure,
    showStatusOverlay,
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
            theme: RED_CARD_FORM_THEME,
            locale: 'cs',
            submitMode: 'external',
            onValidityChange: (isValid) => {
                setPayButtonEnabled(isValid);
            },
        });
        _mounting = false;

        // Resolves on SUCCEEDED; rejects on FAILED (CHARGE_FAILED error).
        // 3DS redirects are handled automatically by the SDK — if the user is
        // sent to the ACS and returns via return_url, resolveReturnStatus() takes over.
        await _controller.result;
        _controller = null;
        showStatusSuccess();
    } catch (err) {
        _mounting = false;
        _controller = null;
        console.error('[checkout] card form error', err);
        showStatusFailure();
    }
}

/** Called by the Zaplatit button. Shows the loading overlay, then submits. */
export function submitCardForm() {
    if (!_controller) {
        return;
    }
    showStatusOverlay();
    _controller.submit();
}
