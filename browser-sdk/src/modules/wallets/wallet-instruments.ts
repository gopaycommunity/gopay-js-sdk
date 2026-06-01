import { GoPayErrorCodes, GoPaySDKError } from '@gopay-internal/core';
import type { components } from '../../types/generated.js';

type ApplePayInput = components['schemas']['Apple-Pay-Input'];
type GooglePayInput = components['schemas']['Google-Pay-Input'];
// Omit browser_data — the browser SDK's chargePayment auto-collects and injects it.
type WalletChargeData = Omit<
    components['schemas']['Payment-Card-Charge-Data'],
    'browser_data'
>;

/** Raw `paymentData` object from `ApplePayPaymentToken.paymentData`. */
interface ApplePayPaymentData {
    data: string;
    signature: string;
    version: string;
    header: {
        ephemeralPublicKey: string;
        publicKeyHash: string;
        transactionId: string;
    };
}

/** Raw `paymentMethodData` from the Google Pay `PaymentData` response. */
interface GooglePayPaymentMethodData {
    tokenizationData: {
        /** JSON-encoded string — parsed internally. */
        token: string;
    };
}

/**
 * Build the `payment_instrument` charge payload from the Apple Pay token data
 * obtained in the `onpaymentauthorized` event.
 *
 * @param paymentData - `event.payment.token.paymentData` from the ApplePaySession.
 */
export function extractApplePayInstrument(
    paymentData: ApplePayPaymentData,
): WalletChargeData {
    const { data, signature, version, header } = paymentData;
    const input: ApplePayInput = {
        input_type: 'APPLE_PAY',
        data,
        signature,
        version,
        header,
    };
    return {
        payment_instrument: 'PAYMENT_CARD',
        input,
    };
}

/**
 * Build the `payment_instrument` charge payload from the Google Pay `PaymentData`
 * obtained from `PaymentsClient.loadPaymentData()`.
 *
 * @param paymentMethodData - `paymentData.paymentMethodData` from the Google Pay response.
 */
export function extractGooglePayInstrument(
    paymentMethodData: GooglePayPaymentMethodData,
): WalletChargeData {
    let tokenData: {
        protocolVersion?: string;
        signature?: string;
        intermediateSigningKey?: { signedKey?: string; signatures?: string[] };
        signedMessage?: string;
    };
    try {
        tokenData = JSON.parse(paymentMethodData.tokenizationData.token);
    } catch {
        throw new GoPaySDKError(
            '[GoPayBrowserSDK] Google Pay: failed to parse payment token.',
            { errorCode: GoPayErrorCodes.WALLET_BUTTON_ERROR },
        );
    }

    const input: GooglePayInput = {
        input_type: 'GOOGLE_PAY',
        protocolVersion: tokenData.protocolVersion,
        signature: tokenData.signature,
        ...(tokenData.intermediateSigningKey && {
            intermediateSigningKey: tokenData.intermediateSigningKey,
        }),
        signedMessage: tokenData.signedMessage,
    };
    return {
        payment_instrument: 'PAYMENT_CARD',
        input,
    };
}
