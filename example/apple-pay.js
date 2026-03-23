// Apple Pay flow — two steps, three possible paths:
//
// Step 1 (applePayLoadInfo): call sdk.payments.getApplePayInfo(paymentId) to fetch merchant
//   config (merchantIdentifier, applepayVersion, applePayPaymentRequest) from the GoPay API.
//
// Step 2 — choose one path based on the user's browser:
//
//   Path A — Native Safari (ApplePaySession):
//     Create an ApplePaySession, wire onpaymentauthorized, then call
//     sdk.payments.startApplePaySession(paymentId, session) which handles merchant validation.
//     In onpaymentauthorized, extract { data, signature, version, header } from
//     event.payment.token.paymentData and pass them to sdk.payments.charge() as input_type: 'APPLE_PAY'.
//     Always call session.completePayment(STATUS_SUCCESS / STATUS_FAILURE) before the sheet closes.
//
//   Path B — PaymentRequest API (Chrome/Edge with QR cross-device):
//     Use the standard PaymentRequest API with supportedMethods: 'https://apple.com/apple-pay'.
//     Same token shape as Path A, extracted from paymentResponse.details.token.paymentData.
//     Call paymentResponse.complete('success'/'fail') after charging.
//
//   Path C — Dev mock (apple-pay-polyfill.js):
//     A polyfill replaces ApplePaySession in non-Safari browsers for local testing.
//     It simulates the full session lifecycle with a stub token.

import { prefillCharge } from './helpers.js';
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
        _applePayInfo = await sdk.payments.getApplePayInfo(paymentId);
        _applePaymentId = paymentId;
        pre.textContent = `── API response (getApplePayInfo) ──\n${JSON.stringify(_applePayInfo, null, 2)}\n\nClick a button below to proceed.`;
    } catch (err) {
        pre.textContent = `[Step 1 failed] ${err?.message ?? String(err)}`;
        return;
    }

    // Mock button — always shown, uses the polyfill stub
    if (window.MockApplePaySession) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'applepay-mock-btn';
        btn.textContent = ' Pay (Mock — dev only)';
        Object.assign(btn.style, {
            background: '#856404',
            color: '#fff',
            borderRadius: '6px',
            padding: '0.5rem 1.5rem',
            fontSize: '1rem',
            fontWeight: '600',
            letterSpacing: '-0.3px',
            border: '2px dashed #ffc107',
            cursor: 'pointer',
        });
        btn.onclick = () => applePayBeginSession(window.MockApplePaySession);
        container.appendChild(btn);
    }

    // Native Safari ApplePaySession button
    const hasNativeSession =
        window.ApplePaySession && !window.ApplePaySession.__isPolyfill;
    if (hasNativeSession) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = ' Pay (Safari native)';
        Object.assign(btn.style, {
            background: '#000',
            color: '#fff',
            borderRadius: '6px',
            padding: '0.5rem 1.5rem',
            fontSize: '1rem',
            fontWeight: '600',
            letterSpacing: '-0.3px',
            border: 'none',
            cursor: 'pointer',
        });
        btn.onclick = () => applePayBeginSession(window.ApplePaySession);
        container.appendChild(btn);
    }

    // PaymentRequest (cross-device QR) button — only on non-Apple browsers.
    // On Safari/WebKit, PaymentRequest just opens the same native sheet as ApplePaySession.
    if (
        !hasNativeSession &&
        (await supportsPaymentRequestApplePay(_applePayInfo))
    ) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = ' Pay (QR code)';
        Object.assign(btn.style, {
            background: '#1a1a2e',
            color: '#fff',
            borderRadius: '6px',
            padding: '0.5rem 1.5rem',
            fontSize: '1rem',
            fontWeight: '600',
            letterSpacing: '-0.3px',
            border: 'none',
            cursor: 'pointer',
        });
        btn.onclick = applePayPaymentRequestFlow;
        container.appendChild(btn);
    }
}

function buildApplePayPaymentMethod(info) {
    const pr = info.applePayPaymentRequest;
    return {
        supportedMethods: 'https://apple.com/apple-pay',
        data: {
            version: info.applepayVersion,
            merchantIdentifier: info.merchantIdentifier,
            merchantCapabilities: pr.merchantCapabilities,
            supportedNetworks: pr.supportedNetworks,
            countryCode: pr.countryCode,
        },
    };
}

function buildPaymentDetails(info) {
    const pr = info.applePayPaymentRequest;
    return {
        total: {
            label: pr.total.label,
            amount: {
                currency: pr.currencyCode,
                value: String(pr.total.amount),
            },
        },
    };
}

async function supportsPaymentRequestApplePay(info) {
    if (!window.PaymentRequest) return false;
    try {
        const req = new PaymentRequest(
            [buildApplePayPaymentMethod(info)],
            buildPaymentDetails(info),
        );
        return await req.canMakePayment();
    } catch {
        return false;
    }
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
        pre.textContent += `\nCancelled or failed: ${err?.message ?? String(err)}`;
        return;
    }

    const { data, signature, version, header } =
        paymentResponse.details.token.paymentData;
    const returnUrl = document.getElementById('charge-return-url').value.trim();
    const instrument = {
        payment_instrument: 'PAYMENT_CARD',
        input: { input_type: 'APPLE_PAY', data, signature, version, header },
    };
    prefillCharge(_applePaymentId, instrument);
    try {
        const charge = await sdk.payments.charge(_applePaymentId, {
            payment_instrument: instrument,
            return_url: returnUrl,
        });
        await paymentResponse.complete('success');
        pre.textContent += `\n\nCharge result:\n${JSON.stringify(charge, null, 2)}`;
        if (charge.action?.redirect_url) {
            pre.textContent += `\n\nRedirect to: ${charge.action.redirect_url}`;
        }
    } catch (err) {
        await paymentResponse.complete('fail');
        pre.textContent += `\nCharge failed: ${err?.message ?? String(err)}`;
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
        const { data, signature, version, header } =
            event.payment.token.paymentData;
        const returnUrl = document
            .getElementById('charge-return-url')
            .value.trim();
        const instrument = {
            payment_instrument: 'PAYMENT_CARD',
            input: {
                input_type: 'APPLE_PAY',
                data,
                signature,
                version,
                header,
            },
        };
        prefillCharge(_applePaymentId, instrument);
        try {
            const charge = await sdk.payments.charge(_applePaymentId, {
                payment_instrument: instrument,
                return_url: returnUrl,
            });
            session.completePayment(SessionClass.STATUS_SUCCESS);
            pre.textContent += `\n\nCharge result:\n${JSON.stringify(charge, null, 2)}`;
            if (charge.action?.redirect_url) {
                pre.textContent += `\n\nRedirect to: ${charge.action.redirect_url}`;
            }
        } catch (err) {
            session.completePayment(SessionClass.STATUS_FAILURE);
            pre.textContent += `\nCharge failed: ${err?.message ?? String(err)}`;
        }
    };

    session.oncancel = () => {
        pre.textContent += '\n\nApple Pay sheet closed. User cancelled.';
    };

    sdk.payments.startApplePaySession(_applePaymentId, session);
}
