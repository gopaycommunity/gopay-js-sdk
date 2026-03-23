import './main.css';
import { applePayLoadInfo } from './apple-pay.js';
import {
    runAuthenticate,
    runIssueClientToken,
    runLogout,
    runSetClientTokenFlow,
    updateAuthBadge,
} from './auth.js';
import { cardPayOpenIframe } from './card-pay.js';
import { googlePayLoadInfo } from './google-pay.js';
import {
    clearCharge,
    runCharge,
    runCreatePayment,
    runQRPaymentInfo,
} from './payments.js';
import { clientId, clientSecret, goid, hasProxy, sdk } from './sdk.js';

// -----------------------------------------------------------------------
// Pre-populate auth fields from Vite env (sdk/.env.e2e) — fall back to empty
// -----------------------------------------------------------------------
if (clientId) document.getElementById('auth-client-id').value = clientId;
if (clientSecret)
    document.getElementById('auth-client-secret').value = clientSecret;
if (goid) {
    document.getElementById('create-goid').value = goid;
    document.getElementById('set-client-token-goid').value = goid;
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
        class: sdk.constructor.name,
        baseUrl: hasProxy
            ? `${window.location.origin}/proxy`
            : '(sandbox default)',
        modules: ['auth', 'payments', 'cards'].map((m) => ({
            name: m,
            methods: Object.getOwnPropertyNames(
                Object.getPrototypeOf(sdk[m]),
            ).filter((n) => n !== 'constructor'),
        })),
    },
    null,
    2,
);

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
