import { clientId, clientSecret, sdk } from '../sdk.js';
import {
    showStatusFailure,
    showStatusOverlay,
    showStatusSuccess,
} from './dom.js';

const POLL_INTERVAL_MS = 1500;
const POLL_MAX_ATTEMPTS = 10;
const TERMINAL_STATES = new Set(['SUCCEEDED', 'FAILED']);

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

        // Poll until the charge reaches SUCCEEDED or FAILED. The gateway may
        // still be processing when the 3DS page redirects back.
        let chargeState = null;
        for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
            chargeState = await sdk.getChargeState(paymentId);
            console.debug('[checkout] charge state poll', chargeState);
            if (TERMINAL_STATES.has(chargeState?.state)) {
                break;
            }
            if (i < POLL_MAX_ATTEMPTS - 1) {
                await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
            }
        }

        if (chargeState?.state === 'SUCCEEDED') {
            sessionStorage.removeItem('checkout_payment_id');
            showStatusSuccess();
        } else {
            showStatusFailure();
        }
    } catch (err) {
        console.error('[checkout] status check failed', err);
        showStatusFailure();
    }
}
