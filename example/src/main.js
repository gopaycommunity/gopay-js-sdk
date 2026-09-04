import './styles/main.css';
import './card-form-logger.js';
import './output-scroll.js';
import { SDK_VERSION as SERVER_SDK_VERSION } from '@gopaycz/gopay-js-sdk';
import { SDK_VERSION as BROWSER_SDK_VERSION } from '@gopaycz/gopay-js-sdk-browser';
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
    browserGetBrowserData,
    browserGetChargeState,
    browserGetStatus,
    browserQRPaymentInfo,
} from './browser-payments.js';
import { initBrowserSDK, runAttachPayment } from './browser-sdk.js';
import {
    cardPayExtSubmit,
    cardPayOpenIframe,
    cardPaySetFlow,
    cardPaySetLang,
    cardPaySetSubmitMode,
    cardPaySetTheme,
} from './card-pay.js';
import { prefillPaymentId, updateBrowserBadge } from './helpers.js';
import {
    runCreatePaymentLink,
    runDisablePaymentLink,
    runGetPaymentLink,
} from './links.js';
import {
    clearCharge,
    runCharge,
    runChargeEncrypted,
    runCreatePayment,
    runGetChargeState,
    runGetGooglePayInfo,
    runGetPaymentStatus,
    runQRPaymentInfo,
} from './payments.js';
import {
    runAwaitRefundState,
    runGetRefund,
    runListRefunds,
    runRefundPayment,
} from './refunds.js';
import {
    runDeleteCard,
    runGetCardDetails,
    runTokenizeEncryptedCard,
} from './saved-cards.js';
import {
    clientId,
    clientSecret,
    environment,
    goid,
    sdk,
    sdkConfig,
    shareableKey,
} from './sdk.js';

// -----------------------------------------------------------------------
// Pre-populate return/notification URL fields from the current href
// -----------------------------------------------------------------------
// Query and hash are stripped deliberately. The gateway appends ?id=&charge_id=
// to whatever return URL it was given, so reusing the full href would send that
// pair back out as part of the next return URL and accumulate a duplicate on
// every round trip (?id=..&charge_id=..&id=..&charge_id=..).
const selfUrl = `${window.location.origin}${window.location.pathname}`;
for (const id of ['create-return-url', 'link-return-url']) {
    const el = document.getElementById(id);
    if (el) {
        el.value = selfUrl;
    }
}
for (const id of ['create-notification-url', 'link-notification-url']) {
    const el = document.getElementById(id);
    if (el) {
        el.value = `${window.location.origin}/notify`;
    }
}

// -----------------------------------------------------------------------
// Returning from the gateway (3DS challenge or hosted flow)
// -----------------------------------------------------------------------
// The gateway sends the customer back to ?id=<payment_id>&charge_id=<charge_id>.
// Prefill the payment ID everywhere so getPaymentStatus() and getChargeState()
// are one click away instead of a copy-paste out of the address bar.
{
    const params = new URLSearchParams(window.location.search);
    // Last occurrence wins — a URL captured before the strip above can still
    // carry a stale pair ahead of the one the gateway just appended.
    const returnedPaymentId = params.getAll('id').at(-1);
    const returnedChargeId = params.getAll('charge_id').at(-1);

    if (returnedPaymentId) {
        prefillPaymentId({ id: returnedPaymentId });

        // getChargeState() is addressed by payment ID alone, so charge_id has no
        // field of its own — surface it here rather than dropping it silently.
        const chargeStateOutput = document.getElementById(
            'charge-state-output',
        );
        if (chargeStateOutput) {
            chargeStateOutput.textContent = [
                `Returned from the gateway with payment ${returnedPaymentId}`,
                returnedChargeId ? ` (charge ${returnedChargeId})` : '',
                '.\nPayment ID is prefilled below and in the getPaymentStatus panel — run either to see where it landed.',
            ].join('');
        }
    }
}

// -----------------------------------------------------------------------
// Pre-populate auth fields from Vite env (sdk/.env) — fall back to empty
// -----------------------------------------------------------------------
if (clientId) {
    document.getElementById('auth-client-id').value = clientId;
}
if (clientSecret) {
    document.getElementById('auth-client-secret').value = clientSecret;
}
if (shareableKey) {
    document.getElementById('auth-shareable-key').value = shareableKey;
    document.getElementById('cardpay-shareable-key').value = shareableKey;
}
if (clientId) {
    document.getElementById('cardpay-client-id').value = clientId;
}

// Auto-init browser SDK if both keys are available from env
if (shareableKey && clientId) {
    initBrowserSDK(shareableKey, clientId);
}
if (goid) {
    for (const fieldId of ['create-goid', 'link-goid']) {
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
    `@gopaycz/gopay-js-sdk@${SERVER_SDK_VERSION} · @gopaycz/gopay-js-sdk-browser@${BROWSER_SDK_VERSION}`;

const badge = document.getElementById('sdk-badge');
const sdkInfo = document.getElementById('sdk-info');
badge.textContent = 'LOADED';
badge.className = 'badge ok';
sdkInfo.textContent = JSON.stringify(
    {
        environment,
        // Read the resolved config, not the build-time env: in the Docker path
        // the base URL arrives at runtime via /env.js, and reading import.meta
        // here would claim a default while the SDK talks to a custom endpoint.
        baseUrl: sdkConfig.baseUrl ?? `(${environment} default)`,
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
    const shareableKey = document
        .getElementById('cardpay-shareable-key')
        .value.trim();
    const clientId = document.getElementById('cardpay-client-id').value.trim();
    if (!shareableKey || !clientId) {
        alert(
            'Shareable Key and Client ID are required.\nRun auth.getBrowserKeys() first.',
        );
        return;
    }
    const threedsMode = document.querySelector(
        '#browser-sdk-threeDS-row [data-active="true"]',
    )?.dataset.mode;
    const threeDS =
        threedsMode === 'manual' ? { mode: 'manual' } : { mode: 'redirect' };
    initBrowserSDK(shareableKey, clientId, threeDS);
    updateBrowserBadge();
};

window.runAuthenticate = runAuthenticate;
window.runLogout = runLogout;
window.runGetBrowserKeys = runGetBrowserKeys;
window.runCreatePayment = runCreatePayment;
window.runChargeEncrypted = runChargeEncrypted;
window.runCharge = runCharge;
window.clearCharge = clearCharge;
window.runQRPaymentInfo = runQRPaymentInfo;
window.runGetGooglePayInfo = runGetGooglePayInfo;
window.cardPayOpenIframe = cardPayOpenIframe;
window.cardPaySetLang = cardPaySetLang;
window.cardPaySetTheme = cardPaySetTheme;
window.cardPaySetSubmitMode = cardPaySetSubmitMode;
window.cardPaySetFlow = cardPaySetFlow;
window.browserSDKSet3DSMode = (mode) => {
    const row = document.getElementById('browser-sdk-threeDS-row');
    if (!row) {
        return;
    }
    for (const btn of row.querySelectorAll('button[data-mode]')) {
        btn.dataset.active = btn.dataset.mode === mode ? 'true' : 'false';
        btn.classList.toggle('js-btn-inactive', btn.dataset.mode !== mode);
    }
};
window.cardPayExtSubmit = cardPayExtSubmit;
window.runBrowserCharge = runBrowserCharge;
window.browserGooglePayLoadInfo = browserGooglePayLoadInfo;
window.browserApplePayLoadInfo = browserApplePayLoadInfo;
window.browserQRPaymentInfo = browserQRPaymentInfo;
window.browserGetChargeState = browserGetChargeState;
window.browserGetStatus = browserGetStatus;
window.browserGetBrowserData = browserGetBrowserData;
window.runGetPaymentStatus = runGetPaymentStatus;
window.runGetChargeState = runGetChargeState;
window.runGetCardDetails = runGetCardDetails;
window.runDeleteCard = runDeleteCard;
window.runTokenizeEncryptedCard = runTokenizeEncryptedCard;
window.runRefundPayment = runRefundPayment;
window.runListRefunds = runListRefunds;
window.runGetRefund = runGetRefund;
window.runAwaitRefundState = runAwaitRefundState;
window.runCreatePaymentLink = runCreatePaymentLink;
window.runGetPaymentLink = runGetPaymentLink;
window.runDisablePaymentLink = runDisablePaymentLink;
