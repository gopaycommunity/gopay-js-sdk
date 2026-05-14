// Apple Pay flow — two steps, three possible paths:
//
// Step 1 (applePayLoadInfo): call sdk.getApplePayInfo(paymentId) to fetch merchant
//   config (merchantIdentifier, applepayVersion, applePayPaymentRequest) from the GoPay API.
//
// Step 2 — choose one path based on the user's browser:
//
//   Path A — Native Safari (ApplePaySession):
//     Create an ApplePaySession, wire onpaymentauthorized, then call
//     sdk.startApplePaySession(paymentId, session) which handles merchant validation.
//     In onpaymentauthorized, extract { data, signature, version, header } from
//     event.payment.token.paymentData and pass them to sdk.chargePayment() as input_type: 'APPLE_PAY'.
//     Always call session.completePayment(STATUS_SUCCESS / STATUS_FAILURE) before the sheet closes.
//
//   Path B — PaymentRequest API (Chrome/Edge with QR cross-device):
//     Use the standard PaymentRequest API with supportedMethods: 'https://apple.com/apple-pay'.
//     Same token shape as Path A, extracted from paymentResponse.details.token.paymentData.
//     Call paymentResponse.complete('success'/'fail') after charging.
//
//   Path C — Dev mock (apple-pay-polyfill.js):
//     The polyfill adds window.MockApplePaySession (it does not touch window.ApplePaySession).
//     It simulates the full session lifecycle with a stub token for local testing.

import {
    buildApplePayPaymentMethod,
    buildPaymentDetails,
    extractApplePayInstrument,
    renderApplePayButtons,
} from './apple-pay-shared.js';
import { formatError, prefillCharge } from './helpers.js';
import { sdk } from './sdk.js';

// Holds the config fetched in step 1, consumed in step 2
let _applePayInfo = null;
let _applePaymentId = null;

export async function applePayLoadInfo() {
    const paymentId = document
        .getElementById('applepay-payment-id')
        .value.trim();
    const pre = document.getElementById('applepay-output');
    const container = document.getElementById('applepay-button-container');
    container.innerHTML = '';
    _applePayInfo = null;
    _applePaymentId = null;

    pre.textContent = 'Step 1: Fetching Apple Pay info…';
    try {
        _applePayInfo = await sdk.getApplePayInfo(paymentId);
        _applePaymentId = paymentId;
        pre.textContent = `── onSuccess (getApplePayInfo) ──\n${JSON.stringify(_applePayInfo, null, 2)}\n\nClick a button below to proceed.`;
    } catch (err) {
        pre.textContent = `── onError (getApplePayInfo) ──\n${formatError(err)}`;
        return;
    }

    await renderApplePayButtons({
        container,
        info: _applePayInfo,
        mockButtonId: 'applepay-mock-btn',
        onBeginSession: applePayBeginSession,
        onPaymentRequestFlow: applePayPaymentRequestFlow,
    });
}

async function applePayPaymentRequestFlow() {
    const pre = document.getElementById('applepay-output');
    if (!_applePayInfo || !_applePaymentId) return;

    pre.textContent += '\n\n── Step 2: PaymentRequest (cross-device QR) ──';
    let paymentResponse;
    try {
        const request = new PaymentRequest(
            [buildApplePayPaymentMethod(_applePayInfo)],
            buildPaymentDetails(_applePayInfo),
        );
        paymentResponse = await request.show();
    } catch (err) {
        pre.textContent += `\n\n── onCancel / onError (PaymentRequest) ──\n${formatError(err)}`;
        return;
    }

    const instrument = extractApplePayInstrument(
        paymentResponse.details.token.paymentData,
    );
    const returnUrl = document.getElementById('charge-return-url').value.trim();
    prefillCharge(_applePaymentId, instrument);
    try {
        const charge = await sdk.chargePayment(_applePaymentId, {
            payment_instrument: instrument,
            return_url: returnUrl,
        });
        await paymentResponse.complete('success');
        pre.textContent += `\n\n── onSuccess (charge) ──\n${JSON.stringify(charge, null, 2)}`;
        if (charge.action?.redirect_url) {
            pre.textContent += `\n\nRedirect to: ${charge.action.redirect_url}`;
        }
    } catch (err) {
        await paymentResponse.complete('fail');
        pre.textContent += `\n\n── onError (charge) ──\n${formatError(err)}`;
    }
}

function applePayBeginSession(SessionClass = window.ApplePaySession) {
    const pre = document.getElementById('applepay-output');
    if (!_applePayInfo || !_applePaymentId) return;

    const session = new SessionClass(
        _applePayInfo.applepayVersion,
        _applePayInfo.applePayPaymentRequest,
    );

    session.onpaymentauthorized = async (event) => {
        pre.textContent += '\n\n── onpaymentauthorized ──';
        const instrument = extractApplePayInstrument(
            event.payment.token.paymentData,
        );
        const returnUrl = document
            .getElementById('charge-return-url')
            .value.trim();
        prefillCharge(_applePaymentId, instrument);
        try {
            const charge = await sdk.chargePayment(_applePaymentId, {
                payment_instrument: instrument,
                return_url: returnUrl,
            });
            session.completePayment(SessionClass.STATUS_SUCCESS);
            pre.textContent += `\n\n── onSuccess (charge) ──\n${JSON.stringify(charge, null, 2)}`;
            if (charge.action?.redirect_url) {
                pre.textContent += `\n\nRedirect to: ${charge.action.redirect_url}`;
            }
        } catch (err) {
            session.completePayment(SessionClass.STATUS_FAILURE);
            pre.textContent += `\n\n── onError (charge) ──\n${formatError(err)}`;
        }
    };

    sdk.startApplePaySession(_applePaymentId, session, undefined, {
        oncancel: (event) => {
            const detail =
                event !== undefined
                    ? JSON.stringify(event, null, 2)
                    : '(no event data — session cancelled by browser)';
            pre.textContent += `\n\n── onCancel ──\n${detail}`;
        },
    });
}
