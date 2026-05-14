import {
    DARK_CARD_FORM_THEME,
    DEFAULT_CARD_FORM_THEME,
} from 'gopay-js-sdk-browser';
import { getBrowserSDK } from './browser-sdk.js';
import { formatError, prefillBrowserCharge } from './helpers.js';

let currentLang = 'en';
let currentTheme = 'default';
let currentSubmitMode = 'internal';
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

export async function cardPayOpenIframe() {
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
    container.style.display = 'block';

    if (isExternal) {
        extSubmitBtn.disabled = true;
        extSubmitBtn.classList.add('js-btn-disabled');
        extValidIndicator.textContent = 'false';
    }

    pre.textContent = 'Mounting card form…';

    const theme =
        currentTheme === 'dark'
            ? DARK_CARD_FORM_THEME
            : DEFAULT_CARD_FORM_THEME;

    try {
        cardFormController = await browserSdk.mountCardForm(container, {
            flow: 'return-payload',
            theme,
            locale: currentLang,
            submitMode: currentSubmitMode,
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

        pre.textContent += '\n\nWaiting for card entry…';

        const result = await cardFormController.result;
        cardFormController = null;
        container.style.display = 'none';
        pre.textContent += `\n\n── onSuccess ──\n${JSON.stringify(result, null, 2)}`;
        pre.textContent +=
            '\n\nEncrypted payload auto-filled in the Browser charge section below.';
        prefillBrowserCharge(result.encryptedPayload);
    } catch (err) {
        cardFormController = null;
        container.style.display = 'none';
        pre.textContent += `\n\n── onError ──\n${formatError(err)}`;
    }
}
