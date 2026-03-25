import { prefillPaymentId, run, show3dsPrompt, state } from './helpers.js';
import { sdk } from './sdk.js';

// Create a payment — call this from your server after authentication.
// Returns a payment object with an `id` you'll use for all subsequent steps (charge, Google Pay, etc.).
// amount is in the smallest currency unit (e.g. 1000 = 10.00 CZK).
// Example:
//   const payment = await sdk.payments.create(goid, { amount: 1000, currency: 'CZK', ... });
export function runCreatePayment() {
    const goid = document.getElementById('create-goid').value.trim();
    const amount = parseInt(document.getElementById('create-amount').value, 10);
    const currency =
        document.getElementById('create-currency').value.trim() || 'CZK';
    const order_number = document
        .getElementById('create-order-number')
        .value.trim();
    const email = document.getElementById('create-customer-email').value.trim();
    const notification_url = document
        .getElementById('create-notification-url')
        .value.trim();
    const return_url = document
        .getElementById('create-return-url')
        .value.trim();

    run(
        'payment-create-output',
        () =>
            sdk.payments.create(goid, {
                amount,
                currency,
                order_number,
                customer: { email },
                callback: { notification_url, return_url },
            }),
        prefillPaymentId,
    );
}

// Charge a payment using a payment instrument obtained from one of the payment flows
// (Google Pay, Apple Pay or card iframe).
// If result.action.redirect_url is present, redirect the customer there for 3DS verification.
// Example:
//   const result = await sdk.payments.charge(paymentId, { payment_instrument: instrument, return_url });
//   if (result.action?.redirect_url) window.location.href = result.action.redirect_url;
export function runCharge() {
    const paymentId = document.getElementById('charge-payment-id').value.trim();
    const return_url = document
        .getElementById('charge-return-url')
        .value.trim();
    const instrument = state.pendingInstrument ?? {
        payment_instrument: 'PAYMENT_CARD',
        input: {
            input_type: 'CARD_TOKEN',
            card_token: document
                .getElementById('charge-card-token')
                .value.trim(),
        },
    };

    run(
        'payment-charge-output',
        () =>
            sdk.payments.charge(paymentId, {
                payment_instrument: instrument,
                return_url,
            }),
        (result) =>
            show3dsPrompt(
                document.getElementById('payment-charge-output'),
                result.action?.redirect_url,
            ),
    );
}

export function clearCharge() {
    state.pendingInstrument = null;
    document.getElementById('charge-payment-id').value = '';
    document.getElementById('charge-card-token').value = '';
    document.getElementById('charge-instrument-info').textContent =
        'No instrument prefilled — complete a payment flow above, or enter a card token manually.';
    document.getElementById('charge-token-fields').style.display = '';
    const output = document.getElementById('payment-charge-output');
    output.textContent = '—';
    if (output.nextElementSibling?.dataset.tds)
        output.nextElementSibling.remove();
}

// Fetch QR payment info for a payment. Returns image data (base64 PNG or SVG markup).
// Render the image in your UI so the customer can scan it with their banking app.
// Example:
//   const qr = await sdk.payments.getQRPaymentInfo(paymentId, 'png'); // or 'svg'
//   img.src = `data:image/png;base64,${qr.data}`;
export function runQRPaymentInfo() {
    const paymentId = document.getElementById('qr-payment-id').value.trim();
    const format = document.getElementById('qr-format').value || undefined;
    run(
        'qr-output',
        () => sdk.payments.getQRPaymentInfo(paymentId, format),
        (result) => {
            const pre = document.getElementById('qr-output');
            if (pre.nextElementSibling?.dataset.qrImg)
                pre.nextElementSibling.remove();
            const data = result?.qr_code;
            if (!data) return;
            const b64 =
                data.spayd ?? data.paybysquare ?? data.sepa ?? data.mnb_qr;
            if (!b64) return;
            const isSvg = format === 'svg';
            const img = document.createElement('img');
            img.dataset.qrImg = '1';
            img.src = isSvg
                ? `data:image/svg+xml;base64,${b64}`
                : `data:image/png;base64,${b64}`;
            Object.assign(img.style, {
                display: 'block',
                marginTop: '0.6rem',
                maxWidth: '200px',
            });
            pre.insertAdjacentElement('afterend', img);
        },
    );
}
