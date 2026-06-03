import './styles/main.css';
import './card-form-logger.js';
import { SDK_VERSION as SERVER_SDK_VERSION } from 'gopay-js-sdk';
import { SDK_VERSION as BROWSER_SDK_VERSION } from 'gopay-js-sdk-browser';
import {
    runAuthenticate,
    runGetBrowserKeys,
    runLogout,
    updateAuthBadge,
} from './auth.js';
import { browserApplePayLoadInfo } from './browser-apple-pay.js';
import { runBrowserCharge } from './browser-charge.js';
import { browserGooglePayLoadInfo } from './browser-google-pay.js';
import {
    browserGetChargeState,
    browserGetStatus,
    browserQRPaymentInfo,
} from './browser-payments.js';
import { initBrowserSDK, runAttachPayment } from './browser-sdk.js';
import {
    cardPayExtSubmit,
    cardPayOpenIframe,
    cardPaySet3DSMode,
    cardPaySetFlow,
    cardPaySetLang,
    cardPaySetSubmitMode,
    cardPaySetTheme,
} from './card-pay.js';
import { updateBrowserBadge } from './helpers.js';
import {
    runCreatePaymentLink,
    runDisableLink,
    runLinkStatus,
} from './links.js';
import {
    clearCharge,
    runCharge,
    runCreatePayment,
    runGetChargeState,
    runGetGooglePayInfo,
    runGetPaymentStatus,
    runQRPaymentInfo,
} from './payments.js';
import {
    runCreateRecurrence,
    runRecurrenceNext,
    runRecurrenceStatus,
    runStartRecurrence,
    runStopRecurrence,
} from './recurrences.js';
import { runGetRefund, runListRefunds, runRefundPayment } from './refunds.js';
import {
    runDeleteCard,
    runGetCardDetails,
    runTokenizeEncryptedCard,
} from './saved-cards.js';
import { clientId, clientSecret, goid, publishableKey, sdk } from './sdk.js';

// -----------------------------------------------------------------------
// Pre-populate auth fields from Vite env (sdk/.env.e2e) — fall back to empty
// -----------------------------------------------------------------------
if (clientId) {
    document.getElementById('auth-client-id').value = clientId;
}
if (clientSecret) {
    document.getElementById('auth-client-secret').value = clientSecret;
}
if (publishableKey) {
    document.getElementById('auth-publishable-key').value = publishableKey;
    document.getElementById('cardpay-publishable-key').value = publishableKey;
}
if (clientId) {
    document.getElementById('cardpay-client-id').value = clientId;
}

// Auto-init browser SDK if both keys are available from env
if (publishableKey && clientId) {
    initBrowserSDK(publishableKey, clientId);
}
if (goid) {
    for (const fieldId of [
        'create-goid',
        'rec-create-goid',
        'link-create-goid',
    ]) {
        const el = document.getElementById(fieldId);
        if (el) {
            el.value = goid;
        }
    }
}

// -----------------------------------------------------------------------
// SDK status badge
// -----------------------------------------------------------------------
document.getElementById('sdk-versions').textContent =
    `gopay-js-sdk@${SERVER_SDK_VERSION} · gopay-js-sdk-browser@${BROWSER_SDK_VERSION}`;

const badge = document.getElementById('sdk-badge');
const sdkInfo = document.getElementById('sdk-info');
badge.textContent = 'LOADED';
badge.className = 'badge ok';
sdkInfo.textContent = JSON.stringify(
    {
        baseUrl: import.meta.env.GP_GW_JS_SDK_BASE_URL ?? '(sandbox default)',
        methods: Object.keys(sdk).filter((k) => typeof sdk[k] === 'function'),
    },
    null,
    2,
);

// -----------------------------------------------------------------------
// Auth badge initial state
// -----------------------------------------------------------------------
updateAuthBadge();
updateBrowserBadge();

// -----------------------------------------------------------------------
// Expose functions to HTML onclick handlers
// -----------------------------------------------------------------------
window.runAttachPayment = runAttachPayment;

window.runInitBrowserSDK = () => {
    const publishableKey = document
        .getElementById('cardpay-publishable-key')
        .value.trim();
    const clientId = document.getElementById('cardpay-client-id').value.trim();
    if (!publishableKey || !clientId) {
        alert(
            'Publishable Key and Client ID are required.\nRun auth.getBrowserKeys() first.',
        );
        return;
    }
    initBrowserSDK(publishableKey, clientId);
    updateBrowserBadge();
};

window.runAuthenticate = runAuthenticate;
window.runLogout = runLogout;
window.runGetBrowserKeys = runGetBrowserKeys;
window.runCreatePayment = runCreatePayment;
window.runCharge = runCharge;
window.clearCharge = clearCharge;
window.runQRPaymentInfo = runQRPaymentInfo;
window.runGetGooglePayInfo = runGetGooglePayInfo;
window.cardPayOpenIframe = cardPayOpenIframe;
window.cardPaySetLang = cardPaySetLang;
window.cardPaySetTheme = cardPaySetTheme;
window.cardPaySetSubmitMode = cardPaySetSubmitMode;
window.cardPaySetFlow = cardPaySetFlow;
window.cardPaySet3DSMode = cardPaySet3DSMode;
window.cardPayExtSubmit = cardPayExtSubmit;
window.runBrowserCharge = runBrowserCharge;
window.browserGooglePayLoadInfo = browserGooglePayLoadInfo;
window.browserApplePayLoadInfo = browserApplePayLoadInfo;
window.browserQRPaymentInfo = browserQRPaymentInfo;
window.browserGetChargeState = browserGetChargeState;
window.browserGetStatus = browserGetStatus;
window.runGetPaymentStatus = runGetPaymentStatus;
window.runGetChargeState = runGetChargeState;
window.runGetCardDetails = runGetCardDetails;
window.runDeleteCard = runDeleteCard;
window.runTokenizeEncryptedCard = runTokenizeEncryptedCard;
window.runCreateRecurrence = runCreateRecurrence;
window.runRecurrenceStatus = runRecurrenceStatus;
window.runStartRecurrence = runStartRecurrence;
window.runRecurrenceNext = runRecurrenceNext;
window.runStopRecurrence = runStopRecurrence;
window.runRefundPayment = runRefundPayment;
window.runListRefunds = runListRefunds;
window.runGetRefund = runGetRefund;
window.runCreatePaymentLink = runCreatePaymentLink;
window.runLinkStatus = runLinkStatus;
window.runDisableLink = runDisableLink;
