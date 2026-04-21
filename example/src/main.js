import './styles/main.css';
import { applePayLoadInfo } from './apple-pay.js';
import {
    runAuthenticate,
    runIssueClientToken,
    runLogout,
    runSetClientTokenFlow,
    updateAuthBadge,
} from './auth.js';
import {
    cardPayExtSubmit,
    cardPayOpenIframe,
    cardPaySetLang,
    cardPaySetPermanent,
    cardPaySetSubmitMode,
    cardPaySetTheme,
} from './card-pay.js';
import { googlePayLoadInfo } from './google-pay.js';
import {
    clearCharge,
    runCharge,
    runCreatePayment,
    runGetChargeState,
    runGetPaymentStatus,
    runQRPaymentInfo,
} from './payments.js';
import { runDeleteCard, runGetCardDetails } from './saved-cards.js';
import { clientId, clientSecret, goid, hasProxy, sdk } from './sdk.js';

// -----------------------------------------------------------------------
// Pre-populate auth fields from Vite env (sdk/.env.e2e) — fall back to empty
// -----------------------------------------------------------------------
if (clientId) document.getElementById('auth-client-id').value = clientId;
if (clientSecret)
    document.getElementById('auth-client-secret').value = clientSecret;
if (goid) {
    document.getElementById('create-goid').value = goid;
}

// -----------------------------------------------------------------------
// SDK status badge
// -----------------------------------------------------------------------
const badge = document.getElementById('sdk-badge');
const sdkInfo = document.getElementById('sdk-info');
badge.textContent = 'LOADED';
badge.className = 'badge ok';
sdkInfo.textContent = JSON.stringify(
    {
        baseUrl: hasProxy
            ? `${window.location.origin}/proxy`
            : '(sandbox default)',
        methods: Object.keys(sdk).filter((k) => typeof sdk[k] === 'function'),
    },
    null,
    2,
);

// -----------------------------------------------------------------------
// Log all GOPAY_ postMessages to the Card Pay output panel
// -----------------------------------------------------------------------
function logPostMessage(direction, data) {
    const pre = document.getElementById('cardpay-output');
    if (!pre) return;
    pre.textContent += `\n${direction} ${JSON.stringify(data)}`;
    pre.scrollTop = pre.scrollHeight;
}
const isGoPay = (data) =>
    typeof data?.type === 'string' && data.type.startsWith('GOPAY_');

// iframe → parent
window.addEventListener('message', (e) => {
    if (isGoPay(e.data)) logPostMessage('←', e.data);
});

// parent → iframe: patch contentWindow.postMessage once the iframe is mounted.
// Must use MutationObserver — patching Window.prototype in the parent realm has no effect
// on iframe.contentWindow.postMessage (different realm prototype).
//
// Patch immediately in the MutationObserver callback, NOT on the load event.
// MutationObserver fires as a microtask after appendChild() but BEFORE the SDK's next
// synchronous statement sets iframe.onload. By patching the initial about:blank
// contentWindow now (same-origin, reused across navigation), the patch is in place
// before GOPAY_CARD_FORM_INIT is sent.
const iframeContainer = document.getElementById('cardpay-iframe-container');
if (iframeContainer) {
    new MutationObserver((mutations) => {
        for (const { addedNodes } of mutations) {
            for (const node of addedNodes) {
                if (!(node instanceof HTMLIFrameElement)) continue;
                try {
                    const cw = node.contentWindow;
                    const orig = cw.postMessage.bind(cw);
                    cw.postMessage = (data, ...args) => {
                        if (isGoPay(data)) logPostMessage('→', data);
                        return orig(data, ...args);
                    };
                } catch (_) {}
            }
        }
    }).observe(iframeContainer, { childList: true });
}

// -----------------------------------------------------------------------
// Auth badge initial state
// -----------------------------------------------------------------------
updateAuthBadge();

// -----------------------------------------------------------------------
// Expose functions to HTML onclick handlers
// -----------------------------------------------------------------------
window.runAuthenticate = runAuthenticate;
window.runLogout = runLogout;
window.runIssueClientToken = runIssueClientToken;
window.runSetClientTokenFlow = runSetClientTokenFlow;
window.runCreatePayment = runCreatePayment;
window.runCharge = runCharge;
window.clearCharge = clearCharge;
window.runQRPaymentInfo = runQRPaymentInfo;
window.googlePayLoadInfo = googlePayLoadInfo;
window.applePayLoadInfo = applePayLoadInfo;
window.cardPayOpenIframe = cardPayOpenIframe;
window.cardPaySetLang = cardPaySetLang;
window.cardPaySetTheme = cardPaySetTheme;
window.cardPaySetSubmitMode = cardPaySetSubmitMode;
window.cardPayExtSubmit = cardPayExtSubmit;
window.cardPaySetPermanent = cardPaySetPermanent;
window.runGetPaymentStatus = runGetPaymentStatus;
window.runGetChargeState = runGetChargeState;
window.runGetCardDetails = runGetCardDetails;
window.runDeleteCard = runDeleteCard;
