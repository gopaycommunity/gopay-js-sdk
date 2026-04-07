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

import { DARK_CARD_FORM_THEME, DEFAULT_CARD_FORM_THEME } from 'gopay-js-sdk';
import { formatError, prefillCharge } from './helpers.js';
import { sdk } from './sdk.js';

let currentLang = 'en';
let currentTheme = 'default';
let currentSubmitMode = 'internal';
let cardFormController = null;

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

    cardFormController?.setLocale(lang);
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

    cardFormController?.setTheme(
        theme === 'dark' ? DARK_CARD_FORM_THEME : DEFAULT_CARD_FORM_THEME,
    );
}

export function cardPaySetSubmitMode(mode) {
    currentSubmitMode = mode;
    document
        .getElementById('cardpay-submit-internal')
        .classList.toggle('!bg-[#F2F4F7]', mode !== 'internal');
    document
        .getElementById('cardpay-submit-internal')
        .classList.toggle('!text-[#2D3643]', mode !== 'internal');
    document
        .getElementById('cardpay-submit-internal')
        .classList.toggle('![box-shadow:none]', mode !== 'internal');
    document
        .getElementById('cardpay-submit-external')
        .classList.toggle('!bg-[#F2F4F7]', mode !== 'external');
    document
        .getElementById('cardpay-submit-external')
        .classList.toggle('!text-[#2D3643]', mode !== 'external');
    document
        .getElementById('cardpay-submit-external')
        .classList.toggle('![box-shadow:none]', mode !== 'external');

    const isExternal = mode === 'external';
    document
        .getElementById('cardpay-ext-submit')
        .classList.toggle('hidden', !isExternal);
    document
        .getElementById('cardpay-ext-valid-row')
        .classList.toggle('hidden', !isExternal);
}

export function cardPayExtSubmit() {
    cardFormController?.submit();
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
    const extSubmitBtn = document.getElementById('cardpay-ext-submit');

    const extValidIndicator = document.getElementById('cardpay-ext-valid');

    const isExternal = currentSubmitMode === 'external';

    container.style.display = 'block';

    if (isExternal) {
        extSubmitBtn.disabled = true;
        extSubmitBtn.classList.add('opacity-50', 'cursor-not-allowed');
        extValidIndicator.textContent = 'false';
    }

    pre.textContent = `── Step 1: iframe mounted (submitMode: '${currentSubmitMode}') ──\nPayment ID: ${paymentId || '(none)'}\n\nWaiting for card confirmation in iframe…`;

    const theme =
        currentTheme === 'dark'
            ? DARK_CARD_FORM_THEME
            : DEFAULT_CARD_FORM_THEME;

    try {
        const iframeSrc = iframeOverride || '/iframe/index.html';

        cardFormController = sdk.cards.mountCardForm(container, iframeSrc, {
            theme,
            locale: currentLang,
            submitMode: currentSubmitMode,
            onValidityChange: isExternal
                ? (isValid) => {
                      extValidIndicator.textContent = String(isValid);
                      extSubmitBtn.disabled = !isValid;
                      extSubmitBtn.classList.toggle('opacity-50', !isValid);
                      extSubmitBtn.classList.toggle(
                          'cursor-not-allowed',
                          !isValid,
                      );
                  }
                : undefined,
        });

        const tokenResult = await cardFormController.result;
        cardFormController = null;
        container.style.display = 'none';
        pre.textContent += `\n\n── onSuccess (mountCardForm) ──\n${JSON.stringify(tokenResult, null, 2)}`;
        prefillCharge(paymentId, {
            payment_instrument: 'PAYMENT_CARD',
            input: { input_type: 'CARD_TOKEN', card_token: tokenResult.token },
        });
        pre.textContent += '\n\nCharge section prefilled — scroll down to run.';
    } catch (err) {
        cardFormController = null;
        container.style.display = 'none';
        pre.textContent += `\n\n── onError (mountCardForm) ──\n${formatError(err)}`;
    }
}
