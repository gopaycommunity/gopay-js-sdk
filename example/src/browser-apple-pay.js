import {
    buildApplePayPaymentMethod,
    buildPaymentDetails,
    extractApplePayInstrument,
    renderApplePayButtons,
} from './apple-pay-shared.js';
import { requireAttachedSDK } from './browser-sdk.js';
import { formatError, pollChargeState, show3dsPrompt } from './helpers.js';

let _apInfo = null;
let _apBrowserSdk = null;

export async function browserApplePayLoadInfo() {
    const pre = document.getElementById('bapplepay-output');
    const container = document.getElementById('bapplepay-button-container');
    container.innerHTML = '';
    _apInfo = null;
    _apBrowserSdk = null;

    const browserSdk = requireAttachedSDK(pre);
    if (!browserSdk) {
        return;
    }

    pre.textContent = '── fetching Apple Pay info ──';
    try {
        _apInfo = await browserSdk.getApplePayInfo();
        _apBrowserSdk = browserSdk;
        pre.textContent = `── onSuccess (getApplePayInfo) ──\n${JSON.stringify(_apInfo, null, 2)}\n\nClick a button below to proceed.`;
    } catch (err) {
        pre.textContent = `── onError ──\n${formatError(err)}`;
        return;
    }

    await renderApplePayButtons({
        container,
        info: _apInfo,
        onBeginSession: _browserApplePayBeginSession,
        onPaymentRequestFlow: _browserApplePayPaymentRequestFlow,
    });
}

async function _browserApplePayPaymentRequestFlow() {
    const pre = document.getElementById('bapplepay-output');
    if (!_apBrowserSdk || !_apInfo) {
        return;
    }

    pre.textContent += '\n\n── Step 2: PaymentRequest (cross-device QR) ──';
    let paymentResponse;
    try {
        const request = new PaymentRequest(
            [buildApplePayPaymentMethod(_apInfo)],
            buildPaymentDetails(_apInfo),
        );
        paymentResponse = await request.show();
    } catch (err) {
        pre.textContent += `\n\n── onCancel / onError (PaymentRequest) ──\n${formatError(err)}`;
        return;
    }

    const instrument = extractApplePayInstrument(
        paymentResponse.details.token.paymentData,
    );
    try {
        const chargeResult = await _apBrowserSdk.chargePayment({
            payment_instrument: instrument,
        });
        await paymentResponse.complete('success');
        pre.textContent += `\n\n── onSuccess (charge) ──\n${JSON.stringify(chargeResult, null, 2)}`;

        if (
            chargeResult.state === 'ACTION_REQUIRED' &&
            chargeResult.action?.redirect_url
        ) {
            show3dsPrompt(pre, chargeResult.action.redirect_url);
        }

        if (
            chargeResult.state !== 'SUCCEEDED' &&
            chargeResult.state !== 'FAILED'
        ) {
            await pollChargeState(
                (opts) => _apBrowserSdk.awaitChargeState(null, opts),
                pre,
            );
        }
    } catch (err) {
        await paymentResponse.complete('fail');
        pre.textContent += `\n\n── onError (charge) ──\n${formatError(err)}`;
    }
}

function _browserApplePayBeginSession(SessionClass = window.ApplePaySession) {
    const pre = document.getElementById('bapplepay-output');
    if (!_apBrowserSdk || !_apInfo) {
        return;
    }

    const session = new SessionClass(
        _apInfo.applepayVersion,
        _apInfo.applePayPaymentRequest,
    );

    session.onpaymentauthorized = async (event) => {
        pre.textContent += '\n\n── onpaymentauthorized ──';
        const instrument = extractApplePayInstrument(
            event.payment.token.paymentData,
        );
        try {
            const chargeResult = await _apBrowserSdk.chargePayment({
                payment_instrument: instrument,
            });
            session.completePayment(SessionClass.STATUS_SUCCESS);
            pre.textContent += `\n\n── onSuccess (charge) ──\n${JSON.stringify(chargeResult, null, 2)}`;

            if (
                chargeResult.state === 'ACTION_REQUIRED' &&
                chargeResult.action?.redirect_url
            ) {
                show3dsPrompt(pre, chargeResult.action.redirect_url);
            }

            if (
                chargeResult.state !== 'SUCCEEDED' &&
                chargeResult.state !== 'FAILED'
            ) {
                await pollChargeState(
                    (opts) => _apBrowserSdk.awaitChargeState(null, opts),
                    pre,
                );
            }
        } catch (err) {
            session.completePayment(SessionClass.STATUS_FAILURE);
            pre.textContent += `\n\n── onError (charge) ──\n${formatError(err)}`;
        }
    };

    _apBrowserSdk.startApplePaySession(session, undefined, {
        oncancel: (event) => {
            const detail =
                event !== undefined
                    ? JSON.stringify(event, null, 2)
                    : '(no event data — session cancelled by browser)';
            pre.textContent += `\n\n── onCancel ──\n${detail}`;
        },
    });
}
