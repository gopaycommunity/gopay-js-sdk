import {
    DARK_CARD_FORM_THEME,
    DEFAULT_CARD_FORM_THEME,
    RED_CARD_FORM_THEME,
} from '@gopaycz/gopay-js-sdk-browser';
import { getBrowserSDK } from './browser-sdk.js';
import {
    formatError,
    prefillBrowserCharge,
    prefillServerChargeEncrypted,
    prefillTokenize,
} from './helpers.js';

let currentLang = 'en';
let currentTheme = 'default';
let currentSubmitMode = 'internal';
let currentFlow = 'return-payload';
let cardFormController = null;
let cardFormMounting = false;

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
    document
        .getElementById('cardpay-theme-red')
        .classList.toggle('js-btn-inactive', theme !== 'red');

    const themeMap = {
        dark: DARK_CARD_FORM_THEME,
        red: RED_CARD_FORM_THEME,
    };
    cardFormController?.setTheme(themeMap[theme] ?? DEFAULT_CARD_FORM_THEME);
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

export function cardPaySetFlow(flow) {
    currentFlow = flow;
    document
        .getElementById('cardpay-flow-return-payload')
        .classList.toggle('js-btn-inactive', flow !== 'return-payload');
    document
        .getElementById('cardpay-flow-direct-charge')
        .classList.toggle('js-btn-inactive', flow !== 'direct-charge');
}

export function cardPayExtSubmit() {
    cardFormController?.submit();
}

export async function cardPayOpenIframe() {
    if (cardFormMounting || cardFormController) {
        return;
    }
    const pre = document.getElementById('cardpay-output');
    const container = document.getElementById('cardpay-iframe-container');
    const extSubmitBtn = document.getElementById('cardpay-ext-submit');
    const extValidIndicator = document.getElementById('cardpay-ext-valid');

    const browserSdk = getBrowserSDK();
    if (!browserSdk) {
        pre.textContent =
            'Error: Browser SDK not initialized.\nRun auth.getBrowserKeys() or click "Initialize Browser SDK" first.';
        return;
    }

    const isExternal = currentSubmitMode === 'external';
    const isDirectCharge = currentFlow === 'direct-charge';
    container.style.display = 'block';

    if (isExternal) {
        extSubmitBtn.disabled = true;
        extSubmitBtn.classList.add('js-btn-disabled');
        extValidIndicator.textContent = 'false';
    }

    pre.textContent = 'Mounting card form…';

    const themeMap = {
        dark: DARK_CARD_FORM_THEME,
        red: RED_CARD_FORM_THEME,
    };
    const theme = themeMap[currentTheme] ?? DEFAULT_CARD_FORM_THEME;

    const baseOptions = {
        theme,
        locale: currentLang,
        submitMode: currentSubmitMode,
        onValidityChange: isExternal
            ? (isValid) => {
                  extValidIndicator.textContent = String(isValid);
                  extSubmitBtn.disabled = !isValid;
                  extSubmitBtn.classList.toggle('js-btn-disabled', !isValid);
              }
            : undefined,
        onLoadingStateChange: (state) => {
            if (state !== 'idle') {
                pre.textContent = `Loading… (${state})`;
            }
        },
        spinner: theme.submitBackgroundColor
            ? { color: theme.submitBackgroundColor }
            : undefined,
    };

    const options = isDirectCharge
        ? { ...baseOptions, flow: 'direct-charge' }
        : { ...baseOptions, flow: 'return-payload' };

    let controller = null;
    try {
        cardFormMounting = true;
        controller = await browserSdk.mountCardForm(container, options);
        cardFormMounting = false;
        cardFormController = controller;

        pre.textContent += '\n\nWaiting for card confirmation in iframe';
        if (isDirectCharge) {
            pre.textContent +=
                '\nAfter card entry, the SDK charges the payment and handles 3DS if required.';
        }

        const result = await controller.result;
        if (cardFormController !== controller) {
            return;
        }
        cardFormController = null;
        container.style.display = 'none';
        pre.textContent += `\n\n── onSuccess ──\n${JSON.stringify(result, null, 2)}`;
        if (!isDirectCharge) {
            pre.textContent +=
                '\n\nEncrypted payload auto-filled in the Server charge, Browser charge and Cards · tokenize sections.';
            prefillServerChargeEncrypted(result.encryptedPayload);
            prefillBrowserCharge(result.encryptedPayload);
            prefillTokenize(result.encryptedPayload);
        }
    } catch (err) {
        cardFormMounting = false;
        if (controller !== null && cardFormController !== controller) {
            // A newer mountCardForm call has taken over; don't disrupt its state.
            return;
        }
        cardFormController = null;
        container.style.display = 'none';
        pre.textContent += `\n\n── onError ──\n${formatError(err)}`;
    }
}
