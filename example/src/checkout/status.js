import { clientId, clientSecret, sdk } from '../sdk.js';
import {
    showStatusFailure,
    showStatusOverlay,
    showStatusSuccess,
} from './dom.js';

/**
 * Called on page load when ?return=1 is in the URL (post-3DS redirect).
 * Polls the charge state until a terminal outcome, then shows success or failure.
 */
export async function resolveReturnStatus() {
    showStatusOverlay(); // show loading state immediately

    const paymentId = sessionStorage.getItem('checkout_payment_id');
    if (!paymentId) {
        console.error('[checkout] return: no paymentId in sessionStorage');
        showStatusFailure();
        return;
    }

    try {
        // Re-authenticate — page was reloaded by the 3DS redirect
        await sdk.authenticate({
            grant_type: 'client_credentials',
            client_id: clientId,
            client_secret: clientSecret,
            scope: 'payment:read',
        });

        // awaitChargeState resolves on SUCCEEDED, rejects (CHARGE_FAILED) on FAILED.
        // After 3DS the gateway returns a terminal state quickly.
        await sdk.awaitChargeState(paymentId);
        sessionStorage.removeItem('checkout_payment_id');
        showStatusSuccess();
    } catch (err) {
        console.error('[checkout] status check failed', err);
        showStatusFailure();
    }
}
