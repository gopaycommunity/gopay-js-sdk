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
import { appendOutput } from './output-scroll.js';
import { sanitizeBody } from './sanitize.js';

let currentLang = 'en';
let currentTheme = 'default';
let currentSubmitMode = 'internal';
let currentFlow = 'return-payload';
let cardFormController = null;
let cardFormMounting = false;
/**
 * `cardFormController` exists only once `mountCardForm()` has resolved, and
 * that call fetches the card form URL first — so there is a window in which the
 * form is being mounted and there is nothing to unmount yet. A click in it is
 * remembered and taken when the mount lands, as the Apple Pay button does.
 */
let cardFormUnmountRequested = false;

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

/**
 * Tear the form down the way an integrator would when the shopper leaves the
 * step. `unmount()` otherwise never ran on this page — the form only went away
 * by being submitted or by the page unloading — so the teardown, what it does
 * to `result`, and the card form height summary it sends could not be tried.
 */
export function cardPayUnmount() {
    const pre = document.getElementById('cardpay-output');

    if (!cardFormController) {
        if (cardFormMounting) {
            cardFormUnmountRequested = true;
            appendOutput(
                pre,
                '\n\n── unmount() requested — mount still in flight, will tear down on arrival ──',
            );
            return;
        }
        pre.textContent =
            '── nothing mounted — click "Open Card Payment" first ──';
        return;
    }

    // Left in place rather than cleared: unmount() rejects `result`, and the
    // handler in cardPayOpenIframe only reports a rejection — and hides the
    // container — for the controller it still considers current.
    appendOutput(pre, '\n\n── unmount() — removing the card form ──');
    cardFormController.unmount();
}

export async function cardPayOpenIframe() {
    if (cardFormMounting || cardFormController) {
        return;
    }
    cardFormUnmountRequested = false;
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

        appendOutput(pre, '\n\nWaiting for card confirmation in iframe');
        if (isDirectCharge) {
            appendOutput(
                pre,
                '\nAfter card entry, the SDK charges the payment and handles 3DS if required.',
            );
        }

        if (cardFormUnmountRequested) {
            cardFormUnmountRequested = false;
            appendOutput(
                pre,
                '\n\n── unmount() — the mount landed after the click and was torn down at once ──',
            );
            // `result` rejects and is awaited below, so the catch reports it.
            controller.unmount();
        }

        const result = await controller.result;
        if (cardFormController !== controller) {
            return;
        }
        cardFormController = null;
        container.style.display = 'none';
        appendOutput(
            pre,
            `\n\n── onSuccess ──\n${JSON.stringify(sanitizeBody(result), null, 2)}`,
        );
        if (!isDirectCharge) {
            appendOutput(
                pre,
                '\n\nEncrypted payload auto-filled in the Server charge, Browser charge and Cards · tokenize sections.',
            );
            prefillServerChargeEncrypted(result.encryptedPayload);
            prefillBrowserCharge(result.encryptedPayload);
            prefillTokenize(result.encryptedPayload);
        }
    } catch (err) {
        cardFormMounting = false;
        cardFormUnmountRequested = false;
        if (controller !== null && cardFormController !== controller) {
            // A newer mountCardForm call has taken over; don't disrupt its state.
            return;
        }
        cardFormController = null;
        container.style.display = 'none';
        appendOutput(pre, `\n\n── onError ──\n${formatError(err)}`);
    }
}
