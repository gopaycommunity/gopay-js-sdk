// Card payment via iframe tokenization — two steps:
//
// Step 1: call sdk.mountCardForm(container) to inject GoPay's card-entry iframe into
//   a container element on your page. The SDK fetches the hosted iframe URL automatically
//   from GET /encryption/card-form-url. The returned promise resolves when the customer
//   submits the form (or rejects if they cancel / an error occurs).
//
// Step 2: mountCardForm resolves with { token, ... }. Pass the token to sdk.chargePayment()
//   as input_type: 'CARD_TOKEN'. The raw card number never touches your server.
//
// Example:
//   const cardForm = await sdk.mountCardForm(container);
//   const { token } = await cardForm.result;
//   await sdk.chargePayment(paymentId, {
//     payment_instrument: { payment_instrument: 'PAYMENT_CARD', input: { input_type: 'CARD_TOKEN', card_token: token } },
//     return_url: 'https://yourshop.example.com/return',
//   });

import { DARK_CARD_FORM_THEME, DEFAULT_CARD_FORM_THEME } from 'gopay-js-sdk';
import { formatError, prefillCharge } from './helpers.js';
import { sdk } from './sdk.js';

let currentLang = 'en';
let currentTheme = 'default';
let currentSubmitMode = 'internal';
let currentPermanent = false;
let cardFormController = null;

export function cardPaySetLang(lang) {
    currentLang = lang;
    document
        .getElementById('cardpay-lang-en')
        .classList.toggle('js-btn-inactive', lang !== 'en');
    document
        .getElementById('cardpay-lang-cs')
        .classList.toggle('js-btn-inactive', lang !== 'cs');

    cardFormController?.setLocale(lang);
}

export function cardPaySetTheme(theme) {
    currentTheme = theme;
    document
        .getElementById('cardpay-theme-default')
        .classList.toggle('js-btn-inactive', theme !== 'default');
    document
        .getElementById('cardpay-theme-dark')
        .classList.toggle('js-btn-inactive', theme !== 'dark');

    cardFormController?.setTheme(
        theme === 'dark' ? DARK_CARD_FORM_THEME : DEFAULT_CARD_FORM_THEME,
    );
}

export function cardPaySetSubmitMode(mode) {
    currentSubmitMode = mode;
    document
        .getElementById('cardpay-submit-internal')
        .classList.toggle('js-btn-inactive', mode !== 'internal');
    document
        .getElementById('cardpay-submit-external')
        .classList.toggle('js-btn-inactive', mode !== 'external');

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

export function cardPaySetPermanent(permanent) {
    currentPermanent = permanent;
    document
        .getElementById('cardpay-permanent-off')
        .classList.toggle('js-btn-inactive', permanent);
    document
        .getElementById('cardpay-permanent-on')
        .classList.toggle('js-btn-inactive', !permanent);
}

export async function cardPayOpenIframe() {
    const paymentId = document
        .getElementById('cardpay-payment-id')
        .value.trim();
    const pre = document.getElementById('cardpay-output');
    const container = document.getElementById('cardpay-iframe-container');
    const extSubmitBtn = document.getElementById('cardpay-ext-submit');

    const extValidIndicator = document.getElementById('cardpay-ext-valid');

    const isExternal = currentSubmitMode === 'external';

    container.style.display = 'block';

    if (isExternal) {
        extSubmitBtn.disabled = true;
        extSubmitBtn.classList.add('js-btn-disabled');
        extValidIndicator.textContent = 'false';
    }

    pre.textContent = `── Step 1: iframe mounted (submitMode: '${currentSubmitMode}') ──\nPayment ID: ${paymentId || '(none)'}\n\nWaiting for card confirmation in iframe…`;

    const theme =
        currentTheme === 'dark'
            ? DARK_CARD_FORM_THEME
            : DEFAULT_CARD_FORM_THEME;

    try {
        cardFormController = await sdk.mountCardForm(container, {
            theme,
            locale: currentLang,
            submitMode: currentSubmitMode,
            permanent: currentPermanent,
            onValidityChange: isExternal
                ? (isValid) => {
                      extValidIndicator.textContent = String(isValid);
                      extSubmitBtn.disabled = !isValid;
                      extSubmitBtn.classList.toggle(
                          'js-btn-disabled',
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
