// Card payment via iframe tokenization — two steps:
//
// Step 1: call sdk.cards.mountCardForm(container, iframeSrc) to inject GoPay's card-entry
//   iframe into a container element on your page. The promise resolves when the customer
//   submits the form (or rejects if they cancel / an error occurs).
//   iframeSrc comes from sdk.cards.getCardFormUrl() (GoPay API), or can be overridden
//   with a local URL for development (e.g. /iframe/index.html).
//
// Step 2: mountCardForm resolves with { token, ... }. Pass the token to sdk.payments.charge()
//   as input_type: 'CARD_TOKEN'. The raw card number never touches your server.
//
// Example:
//   const { token } = await sdk.cards.mountCardForm(container, await sdk.cards.getCardFormUrl());
//   await sdk.payments.charge(paymentId, {
//     payment_instrument: { payment_instrument: 'PAYMENT_CARD', input: { input_type: 'CARD_TOKEN', card_token: token } },
//     return_url: 'https://yourshop.example.com/return',
//   });

import {
    CARD_FORM_LABELS_CS,
    CARD_FORM_LABELS_EN,
    DARK_CARD_FORM_THEME,
    DEFAULT_CARD_FORM_THEME,
    GoPayHTTPError,
} from 'gopay-js-sdk';
import { prefillCharge } from './helpers.js';
import { sdk } from './sdk.js';

let currentLang = 'en';
let currentTheme = 'default';

function getMountedIframe() {
    return document
        .getElementById('cardpay-iframe-container')
        ?.querySelector('iframe');
}

function postToIframe(iframe, data) {
    const origin = new URL(iframe.src, location.href).origin;
    iframe.contentWindow?.postMessage(data, origin);
}

export function cardPaySetLang(lang) {
    currentLang = lang;
    document
        .getElementById('cardpay-lang-en')
        .classList.toggle('!bg-[#F2F4F7]', lang !== 'en');
    document
        .getElementById('cardpay-lang-en')
        .classList.toggle('!text-[#2D3643]', lang !== 'en');
    document
        .getElementById('cardpay-lang-en')
        .classList.toggle('![box-shadow:none]', lang !== 'en');
    document
        .getElementById('cardpay-lang-cs')
        .classList.toggle('!bg-[#F2F4F7]', lang !== 'cs');
    document
        .getElementById('cardpay-lang-cs')
        .classList.toggle('!text-[#2D3643]', lang !== 'cs');
    document
        .getElementById('cardpay-lang-cs')
        .classList.toggle('![box-shadow:none]', lang !== 'cs');

    const iframe = getMountedIframe();
    if (iframe) {
        const labels =
            lang === 'cs' ? CARD_FORM_LABELS_CS : CARD_FORM_LABELS_EN;
        postToIframe(iframe, { type: 'GOPAY_CARD_SET_LABELS', labels });
    }
}

export function cardPaySetTheme(theme) {
    currentTheme = theme;
    document
        .getElementById('cardpay-theme-default')
        .classList.toggle('!bg-[#F2F4F7]', theme !== 'default');
    document
        .getElementById('cardpay-theme-default')
        .classList.toggle('!text-[#2D3643]', theme !== 'default');
    document
        .getElementById('cardpay-theme-default')
        .classList.toggle('![box-shadow:none]', theme !== 'default');
    document
        .getElementById('cardpay-theme-dark')
        .classList.toggle('!bg-[#F2F4F7]', theme !== 'dark');
    document
        .getElementById('cardpay-theme-dark')
        .classList.toggle('!text-[#2D3643]', theme !== 'dark');
    document
        .getElementById('cardpay-theme-dark')
        .classList.toggle('![box-shadow:none]', theme !== 'dark');

    const iframe = getMountedIframe();
    if (iframe) {
        const theme2 =
            theme === 'dark' ? DARK_CARD_FORM_THEME : DEFAULT_CARD_FORM_THEME;
        postToIframe(iframe, { type: 'GOPAY_CARD_SET_THEME', theme: theme2 });
    }
}

export async function cardPayOpenIframe() {
    const paymentId = document
        .getElementById('cardpay-payment-id')
        .value.trim();
    const iframeOverride = document
        .getElementById('cardpay-iframe-override')
        ?.value.trim();
    const pre = document.getElementById('cardpay-output');
    const container = document.getElementById('cardpay-iframe-container');
    container.style.display = 'block';
    pre.textContent = `── Step 1: iframe mounted ──\nPayment ID: ${paymentId || '(none)'}\n\nWaiting for card confirmation in iframe…`;

    const theme =
        currentTheme === 'dark'
            ? DARK_CARD_FORM_THEME
            : DEFAULT_CARD_FORM_THEME;
    const labels =
        currentLang === 'cs' ? CARD_FORM_LABELS_CS : CARD_FORM_LABELS_EN;

    try {
        const iframeSrc = iframeOverride || '/iframe/index.html';

        const tokenResult = await sdk.cards.mountCardForm(
            container,
            iframeSrc,
            {
                theme,
                labels,
            },
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
