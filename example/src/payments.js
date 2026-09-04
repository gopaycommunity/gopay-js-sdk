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
/**
 * The merchant's 3-D Secure preference for this charge, as a spread-able object.
 *
 * `AUTO` is the API default and is expressed by leaving the field out entirely,
 * so the empty option yields `{}` rather than `challenge_preference: 'AUTO'`.
 * Risk-based 3DS makes a challenge a coin flip from the merchant's side, which
 * makes an authentication path hard to reach on purpose; `CHALLENGE_PREFERRED`
 * asks for one so the flow can be exercised on demand.
 */
function challengePreference(fieldId) {
    const value = document.getElementById(fieldId)?.value;
    return value ? { challenge_preference: value } : {};
}

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
/**
 * Charge, then follow the charge through to a terminal state.
 *
 * POST /payments/{id}/charge only starts it. On production the ACS URL is not
 * even in that response — the charge comes back PROCESSING and the challenge
 * surfaces on a later GET /payments/{id}/charge — so a panel that prints the
 * POST response and stops never shows the customer the challenge at all.
 * awaitChargeState polls until a terminal state and raises the prompt when the
 * redirect URL appears, which is what the browser panel already did.
 */
async function chargeAndFollow(outputId, paymentId, buildInstrument) {
    const pre = document.getElementById(outputId);
    pre.textContent = '── charging ──';

    try {
        // Built inside the try on purpose: assembling the instrument reads the
        // Browser Data field and can call the browser SDK, so it throws on
        // ordinary mistakes — unparseable JSON, SDK not initialised. Resolved
        // in the caller's argument list those rejections were unhandled and the
        // panel simply did nothing.
        const result = await sdk.chargePayment(paymentId, {
            payment_instrument: await buildInstrument(),
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

export async function runChargeEncrypted() {
    const paymentId = document
        .getElementById('charge-enc-payment-id')
        .value.trim();
    const payload = document.getElementById('charge-enc-payload').value.trim();

    await chargeAndFollow('charge-enc-output', paymentId, async () => ({
        payment_instrument: 'PAYMENT_CARD',
        input: { input_type: 'ENCRYPTED_CARD', payload },
        browser_data: await browserDataForCharge('charge-enc-browser-data'),
        ...challengePreference('charge-enc-challenge-preference'),
    }));
}

export async function runCharge() {
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

    // Wallet instruments are PAYMENT_CARD too — Google Pay and Apple Pay differ
    // in the `input`, not the instrument — so browser_data applies to all of
    // them, exactly as the browser SDK's own chargePayment does.
    await chargeAndFollow('payment-charge-output', paymentId, async () => ({
        ...instrument,
        browser_data: await browserDataForCharge('charge-browser-data'),
        ...challengePreference('charge-challenge-preference'),
    }));
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
