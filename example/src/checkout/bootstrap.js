import { attachPaymentToSDK, initBrowserSDK } from '../browser-sdk.js';
import { clientId, clientSecret, goid, sdk, shareableKey } from '../sdk.js';
import { setPayButtonEnabled, showCheckoutError } from './dom.js';

const ORDER_AMOUNT = 4900; // 49.00 CZK in haléře
const ORDER_CURRENCY = 'CZK';

/** Runs silently on page load. Authenticates, creates the payment, attaches browser SDK. */
export async function bootstrapCheckout() {
    try {
        if (!clientId || !clientSecret || !goid || !shareableKey) {
            console.error(
                '[checkout] Missing env vars — cannot bootstrap. Check sdk/.env.e2e.',
            );
            showCheckoutError();
            return null;
        }

        console.debug('[checkout] authenticating…');
        await sdk.authenticate({
            grant_type: 'client_credentials',
            client_id: clientId,
            client_secret: clientSecret,
            scope: 'payment:write payment:read',
        });
        console.debug('[checkout] auth ok');

        const orderNumber = `NOVINY-${Date.now()}`;
        console.debug('[checkout] creating payment…', {
            orderNumber,
            amount: ORDER_AMOUNT,
        });
        const payment = await sdk.createPayment(goid, {
            amount: ORDER_AMOUNT,
            currency: ORDER_CURRENCY,
            order_number: orderNumber,
            customer: { email: 'demo@noviny.cz' },
            callback: {
                return_url: `${location.href.split('?')[0]}?return=1`,
                notification_url: `${location.origin}/notify`,
            },
        });
        console.debug('[checkout] payment created', { paymentId: payment.id });

        sessionStorage.setItem('checkout_payment_id', payment.id);

        initBrowserSDK(shareableKey, clientId);
        await attachPaymentToSDK(payment.id, payment.payment_secret);
        console.debug('[checkout] browser SDK attached');

        return payment.id;
    } catch (err) {
        console.error('[checkout] bootstrap failed', err);
        showCheckoutError();
        return null;
    }
}

/** After bootstrap succeeds, reveal the payment UI. */
export function onBootstrapReady() {
    setPayButtonEnabled(false); // card pay button enables only when iframe is valid
    const loading = document.getElementById('checkout-loading');
    if (loading) {
        loading.classList.add('hidden');
    }
    const content = document.getElementById('payment-content');
    if (content) {
        content.classList.remove('hidden');
    }
}
