import { getBrowserSDK } from './browser-sdk.js';
import { prefillPaymentId, run, show3dsPrompt, state } from './helpers.js';
import { sdk } from './sdk.js';

// ip, user_agent and accept_header describe the connection the 3DS challenge
// runs on, so they have to come from GET /cards/browser-data called in the
// customer's browser. This page charges through the *server* SDK, which is
// exactly the flow where the values must be collected here and forwarded —
// a server that fills them in from its own request fails authentication.
async function browserDataForCharge() {
    const browserSdk = getBrowserSDK();
    if (!browserSdk) {
        throw new Error(
            'Initialise the Browser SDK first — browser_data must come from GET /cards/browser-data, not from this page.',
        );
    }
    return browserSdk.getBrowserData();
}

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
            sdk.createPayment(goid, {
                amount,
                currency,
                order_number,
                customer: { email },
                callback: { notification_url, return_url },
            }),
        (result) => prefillPaymentId(result),
    );
}

// Retrieve the current status of an existing payment.
// Useful for polling on the server after a redirect or 3DS challenge.
// Example:
//   const status = await sdk.getPaymentStatus(paymentId);
//   // status.state: 'CREATED' | 'PAID' | 'CANCELED' | ...
export function runGetPaymentStatus() {
    const paymentId = document.getElementById('status-payment-id').value.trim();
    run('status-output', () => sdk.getPaymentStatus(paymentId));
}

// Retrieve the current state of a specific charge attempt.
// Example:
//   const state = await sdk.getChargeState(paymentId);
//   if (state.action?.redirect_url) window.location.href = state.action.redirect_url;
export function runGetChargeState() {
    const paymentId = document
        .getElementById('charge-state-payment-id')
        .value.trim();
    run('charge-state-output', () => sdk.getChargeState(paymentId));
}

// Charge a payment using a payment instrument obtained from one of the payment flows
// (Google Pay, Apple Pay or card iframe).
// If result.action.redirect_url is present, redirect the customer there for 3DS verification.
// Example:
//   const result = await sdk.chargePayment(paymentId, { payment_instrument: instrument });
//   if (result.action?.redirect_url) window.location.href = result.action.redirect_url;
// browser_data comes from the browser SDK (see browserDataForCharge above) and is forwarded
// as-is, per the security checklist, rather than hand-rolled here.
export function runChargeEncrypted() {
    const paymentId = document
        .getElementById('charge-enc-payment-id')
        .value.trim();
    const payload = document.getElementById('charge-enc-payload').value.trim();

    run(
        'charge-enc-output',
        async () =>
            sdk.chargePayment(paymentId, {
                payment_instrument: {
                    payment_instrument: 'PAYMENT_CARD',
                    input: {
                        input_type: 'ENCRYPTED_CARD',
                        payload,
                    },
                    browser_data: await browserDataForCharge(),
                },
            }),
        (result) =>
            show3dsPrompt(
                document.getElementById('charge-enc-output'),
                result.action?.redirect_url,
            ),
    );
}

export function runCharge() {
    const paymentId = document.getElementById('charge-payment-id').value.trim();
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
        async () =>
            sdk.chargePayment(paymentId, {
                payment_instrument:
                    instrument?.payment_instrument === 'PAYMENT_CARD'
                        ? {
                              ...instrument,
                              browser_data: await browserDataForCharge(),
                          }
                        : instrument,
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
    if (output.nextElementSibling?.dataset.tds) {
        output.nextElementSibling.remove();
    }
}

export function runQRPaymentInfo() {
    const paymentId = document.getElementById('qr-payment-id').value.trim();
    const format = document.getElementById('qr-format').value || undefined;
    run('qr-output', () => sdk.getQRPaymentInfo(paymentId, format));
}

export function runGetGooglePayInfo() {
    const paymentId = document
        .getElementById('googlepay-payment-id')
        .value.trim();
    run('googlepay-output', () => sdk.getGooglePayInfo(paymentId));
}
