// Card payment via iframe tokenization — two steps:
//
// Step 1: call sdk.cards.mountCardForm(container, iframeSrc) to inject GoPay's card-entry
//   iframe into a container element on your page. The promise resolves when the customer
//   submits the form (or rejects if they cancel / an error occurs).
//   iframeSrc must point to the card-encrypt.html file served from your domain (or GoPay CDN).
//
// Step 2: mountCardForm resolves with { token, ... }. Pass the token to sdk.payments.charge()
//   as input_type: 'CARD_TOKEN'. The raw card number never touches your server.
//
// Example:
//   const { token } = await sdk.cards.mountCardForm(container, '/path/to/card-encrypt.html');
//   await sdk.payments.charge(paymentId, {
//     payment_instrument: { payment_instrument: 'PAYMENT_CARD', input: { input_type: 'CARD_TOKEN', card_token: token } },
//     return_url: 'https://yourshop.example.com/return',
//   });

import { GoPayHTTPError } from 'gopay-js-sdk';
import { prefillCharge } from './helpers.js';
import { sdk } from './sdk.js';

export async function cardPayOpenIframe() {
    const paymentId = document
        .getElementById('cardpay-payment-id')
        .value.trim();
    const pre = document.getElementById('cardpay-output');
    const container = document.getElementById('cardpay-iframe-container');
    container.style.display = 'block';
    pre.textContent = `── Step 1: iframe mounted ──\nPayment ID: ${paymentId || '(none)'}\n\nWaiting for card confirmation in iframe…`;

    try {
        const tokenResult = await sdk.cards.mountCardForm(
            container,
            '/sdk/src/iframe/card-encrypt.html',
        );
        container.style.display = 'none';
        pre.textContent += `\n\n── Step 2: card tokenized ──\n${JSON.stringify(tokenResult, null, 2)}`;
        prefillCharge(paymentId, {
            payment_instrument: 'PAYMENT_CARD',
            input: { input_type: 'CARD_TOKEN', card_token: tokenResult.token },
        });
        pre.textContent += '\n\nCharge section prefilled — scroll down to run.';
    } catch (err) {
        container.style.display = 'none';
        pre.textContent +=
            err instanceof GoPayHTTPError
                ? `\n\n[GoPayHTTPError] HTTP ${err.status}\n${JSON.stringify(err.body, null, 2)}`
                : `\n\n[Error] ${err?.message ?? String(err)}`;
    }
}
