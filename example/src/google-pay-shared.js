import { formatError } from './helpers.js';

export function ensureGooglePayLoaded(pre) {
    if (window.google) {
        return true;
    }
    pre.textContent =
        'Google Pay script not loaded yet — please wait a moment and try again.';
    return false;
}

export function createGooglePayButton(info, onClick) {
    const paymentsClient = new window.google.payments.api.PaymentsClient({
        environment: info.environment,
    });
    return paymentsClient.createButton({ onClick });
}

export async function loadGooglePayData(info, pre) {
    const paymentsClient = new window.google.payments.api.PaymentsClient({
        environment: info.environment,
    });
    try {
        pre.textContent += '\n\nOpening Google Pay sheet…';
        return await paymentsClient.loadPaymentData(info.paymentDataRequest);
    } catch (err) {
        const isCancel =
            err?.statusCode === 'CANCELED' ||
            (err instanceof DOMException && err.name === 'AbortError');
        const label = isCancel ? 'onCancel' : 'onError';
        pre.textContent += `\n\n── ${label} (loadPaymentData) ──\n${formatError(err)}`;
        return null;
    }
}

export function extractGooglePayInstrument(paymentData) {
    const tokenData = JSON.parse(
        paymentData.paymentMethodData.tokenizationData.token,
    );
    return {
        payment_instrument: 'PAYMENT_CARD',
        input: {
            input_type: 'GOOGLE_PAY',
            protocolVersion: tokenData.protocolVersion,
            signature: tokenData.signature,
            ...(tokenData.intermediateSigningKey && {
                intermediateSigningKey: tokenData.intermediateSigningKey,
            }),
            signedMessage: tokenData.signedMessage,
        },
    };
}
