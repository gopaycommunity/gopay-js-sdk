import { collectBrowserDataTolerantly } from './browser-sdk.js';
import {
    formatError,
    pollChargeState,
    prefillPaymentId,
    run,
    show3dsPrompt,
    state,
    TERMINAL_CHARGE_STATES,
} from './helpers.js';
import { appendOutput } from './output-scroll.js';
import { sanitizeBody } from './sanitize.js';
import { sdk } from './sdk.js';

// ip, user_agent and accept_header describe the connection the 3DS challenge
// runs on, so they have to be collected in the customer's browser. This page
// charges through the *server* SDK, which is exactly the flow where the values
// are collected in the browser and forwarded — a server that fills them in from
// its own request fails authentication.
//
// The Browser Data field is that hand-off made visible: sdk.getBrowserData() in
// the Browser SDK section fills it, and the charge sends what the field holds.
// An empty field collects the values on the spot, so the panel still works
// before anyone touches that section.
async function browserDataForCharge(fieldId) {
    const raw = document.getElementById(fieldId)?.value.trim();
    if (raw) {
        try {
            return JSON.parse(raw);
        } catch {
            throw new Error(
                'Browser Data is not valid JSON — re-run sdk.getBrowserData() in the Browser SDK section, or clear the field to collect it on the spot.',
            );
        }
    }
    const { data } = await collectBrowserDataTolerantly();
    return data;
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
// as-is rather than hand-rolled here: the values have to describe the customer's connection,
// not this page's guesses.
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
                    browser_data: await browserDataForCharge(
                        'charge-enc-browser-data',
                    ),
                },
            }),
        (result) =>
            show3dsPrompt(
                document.getElementById('charge-enc-output'),
                result.action?.redirect_url,
            ),
    );
}

// A 3DS challenge on a server charge is followed through here, not left as a
// dangling banner: POST /charge only starts the charge, and the outcome lands on
// GET /payments/{id}/charge once the customer finishes at the ACS. The browser
// panel already does this via the browser SDK's awaitChargeState; the server SDK
// exposes the same poller, so the two panels behave identically.
export async function runCharge() {
    const paymentId = document.getElementById('charge-payment-id').value.trim();
    const pre = document.getElementById('payment-charge-output');
    const instrument = state.pendingInstrument ?? {
        payment_instrument: 'PAYMENT_CARD',
        input: {
            input_type: 'CARD_TOKEN',
            card_token: document
                .getElementById('charge-card-token')
                .value.trim(),
        },
    };

    pre.textContent = '── charging ──';

    try {
        const result = await sdk.chargePayment(paymentId, {
            payment_instrument:
                instrument?.payment_instrument === 'PAYMENT_CARD'
                    ? {
                          ...instrument,
                          browser_data: await browserDataForCharge(
                              'charge-browser-data',
                          ),
                      }
                    : instrument,
        });

        appendOutput(pre, `\n${JSON.stringify(sanitizeBody(result), null, 2)}`);

        if (TERMINAL_CHARGE_STATES.has(result.state)) {
            return;
        }

        if (result.state === 'ACTION_REQUIRED' && result.action?.redirect_url) {
            show3dsPrompt(pre, result.action.redirect_url);
        }

        await pollChargeState(
            (opts) => sdk.awaitChargeState(paymentId, opts),
            pre,
        );
    } catch (err) {
        appendOutput(pre, `\n\n── onError ──\n${formatError(err)}`);
    }
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
    // showLinkBanner tags the node `data-banner="tds"`, so the old
    // `dataset.tds` check never matched and Clear left the prompt on screen.
    if (output.nextElementSibling?.dataset.banner === 'tds') {
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
