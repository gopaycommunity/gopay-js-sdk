import './styles.css';
import { bootstrapCheckout, onBootstrapReady } from './bootstrap.js';
import { activateMethod } from './dom.js';
import { mountApplePayButton } from './pay-apple.js';
import { mountCheckoutCardForm, submitCardForm } from './pay-card.js';
import { mountGooglePayButton } from './pay-google.js';
import { mountQRPayment } from './pay-qr.js';
import { resolveReturnStatus } from './status.js';

// If returning from 3DS, resolve payment status and stop — don't bootstrap again.
const isReturnFlow = new URLSearchParams(location.search).get('return') === '1';
if (isReturnFlow) {
    resolveReturnStatus();
} else {
    init();
}

async function init() {
    // Wire secondary method buttons (card / QR) — click toggles the panel
    document
        .getElementById('method-card-btn')
        ?.addEventListener('click', () => activateMethod('card'));
    document
        .getElementById('method-qr-btn')
        ?.addEventListener('click', () => activateMethod('qr'));

    // Bootstrap: auth + createPayment + attach browser SDK
    const paymentId = await bootstrapCheckout();
    if (!paymentId) {
        return; // error state already shown by bootstrap
    }

    onBootstrapReady();

    // Mount all payment methods eagerly
    mountCheckoutCardForm();
    mountGooglePayButton();
    mountApplePayButton();
    mountQRPayment();
}

// Exposed to HTML onclick
window.checkoutPay = submitCardForm;
