import { GoPayHTTPError, GoPaySDK, GoPaySDKError } from 'gopay-js-sdk';
import './main.css';

// -----------------------------------------------------------------------
// Initialise
// -----------------------------------------------------------------------
const badge = document.getElementById('sdk-badge');
const sdkInfo = document.getElementById('sdk-info');

let sdk;

// Pre-populate auth fields from Vite env (sdk/.env.e2e) — fall back to empty
const clientId = import.meta.env.GP_GW_JS_SDK_CLIENT_ID;
const clientSecret = import.meta.env.GP_GW_JS_SDK_CLIENT_SECRET;
const goid = import.meta.env.GP_GW_JS_SDK_GOID;
const hasProxy = Boolean(import.meta.env.GP_GW_JS_SDK_BASE_URL);

if (clientId) document.getElementById('auth-client-id').value = clientId;
if (clientSecret)
    document.getElementById('auth-client-secret').value = clientSecret;
if (goid) {
    document.getElementById('create-goid').value = goid;
    document.getElementById('set-client-token-goid').value = goid;
}

// When a base URL is configured, route SDK calls through the Vite proxy (/proxy → API).
const sdkConfig = hasProxy
    ? { baseUrl: `${window.location.origin}/proxy` }
    : { environment: 'sandbox' };

try {
    sdk = new GoPaySDK(sdkConfig);
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
} catch (err) {
    badge.textContent = 'NOT LOADED';
    badge.className = 'badge err';
    sdkInfo.textContent = `Failed to initialise GoPaySDK: ${err?.message ?? String(err)}`;
}

// -----------------------------------------------------------------------
// Auth badge
// -----------------------------------------------------------------------
const authBadge = document.getElementById('auth-badge');

function updateAuthBadge() {
    if (!sdk) return;
    const ok = sdk.auth.isAuthenticated();
    authBadge.textContent = ok ? 'authenticated' : 'not authenticated';
    authBadge.style.background = ok ? '#d4edda' : '#e2e3e5';
    authBadge.style.color = ok ? '#155724' : '#383d41';
}

// -----------------------------------------------------------------------
// Helper
// -----------------------------------------------------------------------
function show3dsPrompt(pre, redirectUrl) {
    if (pre.nextElementSibling?.dataset.tds) pre.nextElementSibling.remove();
    if (!redirectUrl) return;
    const div = document.createElement('div');
    div.dataset.tds = '1';
    Object.assign(div.style, {
        marginTop: '0.6rem',
        padding: '0.75rem 1rem',
        background: '#fff8e1',
        border: '1px solid #e0b840',
        borderRadius: '6px',
        display: 'flex',
        alignItems: 'center',
        gap: '1rem',
    });
    const msg = document.createElement('span');
    Object.assign(msg.style, {
        fontSize: '0.82rem',
        flex: '1',
        color: '#5a4200',
    });
    msg.textContent =
        '3DS authentication required — redirect the customer to complete verification.';
    const btn = document.createElement('a');
    btn.href = redirectUrl;
    btn.target = '_blank';
    btn.rel = 'noopener';
    btn.textContent = 'Open 3DS verification →';
    Object.assign(btn.style, {
        padding: '0.4rem 0.9rem',
        background: '#1a1a2e',
        color: '#fff',
        borderRadius: '5px',
        fontSize: '0.82rem',
        textDecoration: 'none',
        whiteSpace: 'nowrap',
    });
    div.appendChild(msg);
    div.appendChild(btn);
    pre.insertAdjacentElement('afterend', div);
}

async function run(outputId, fn, onSuccess) {
    const pre = document.getElementById(outputId);
    pre.textContent = 'Running…';
    try {
        const result = await fn();
        pre.textContent = JSON.stringify(result, null, 2);
        if (onSuccess) onSuccess(result);
    } catch (err) {
        if (err instanceof GoPayHTTPError) {
            pre.textContent = `[GoPayHTTPError] HTTP ${err.status}\n${JSON.stringify(err.body, null, 2)}`;
        } else if (err instanceof GoPaySDKError) {
            pre.textContent = `[GoPaySDKError] ${err.errorCode ? `(${err.errorCode}) ` : ''}${err.message}`;
        } else if (err instanceof Error) {
            pre.textContent = `[${err.constructor.name}] ${err.message}`;
        } else if (err === null || err === undefined) {
            pre.textContent = `[${typeof err}] ${String(err)}`;
        } else {
            let msg;
            try {
                msg = JSON.stringify(err);
            } catch {
                msg = String(err);
            }
            pre.textContent = `[${typeof err}] ${msg}`;
        }
    }
}

// -----------------------------------------------------------------------
// Demo calls
// -----------------------------------------------------------------------
function getSelectedScopes() {
    const el = document.getElementById('auth-scope');
    return (
        Array.from(el.selectedOptions)
            .map((o) => o.value)
            .join(' ') || 'payment:create'
    );
}

window.runAuthenticate = function runAuthenticate() {
    const client_id = document.getElementById('auth-client-id').value.trim();
    const client_secret = document
        .getElementById('auth-client-secret')
        .value.trim();
    const scope = getSelectedScopes();

    run(
        'auth-output',
        () =>
            sdk.auth.authenticate({
                grant_type: 'client_credentials',
                client_id,
                client_secret,
                scope,
            }),
        () => updateAuthBadge(),
    );
};

window.runLogout = function runLogout() {
    sdk.auth.logout();
    updateAuthBadge();
    document.getElementById('auth-output').textContent = 'Logged out.';
};

function getSelectedBrowserScopes() {
    const el = document.getElementById('issue-client-token-scope');
    return (
        Array.from(el.selectedOptions)
            .map((o) => o.value)
            .join(' ') || 'payment:create'
    );
}

// Stores the full ClientToken (including expires_in) from the last issueClientToken() call.
let _lastClientToken = null;

window.runIssueClientToken = function runIssueClientToken() {
    const scope = getSelectedBrowserScopes();
    run('issue-client-token-output', async () => {
        const token = await sdk.auth.issueClientToken(scope || undefined);
        _lastClientToken = token;
        document.getElementById('set-client-token-access').value =
            token.access_token;
        document.getElementById('set-client-token-refresh').value =
            token.refresh_token;
        return token;
    });
};

window.runSetClientTokenFlow = function runSetClientTokenFlow() {
    const goid = document.getElementById('set-client-token-goid').value.trim();
    const accessToken = document
        .getElementById('set-client-token-access')
        .value.trim();
    const refreshToken = document
        .getElementById('set-client-token-refresh')
        .value.trim();

    run('set-client-token-output', async () => {
        const browserSdk = new GoPaySDK(sdkConfig);
        // Use full ClientToken if available (preserves expires_in from server response),
        // otherwise fall back to defaults so manually pasted tokens still work.
        const clientToken =
            _lastClientToken?.access_token === accessToken && _lastClientToken
                ? _lastClientToken
                : {
                      access_token: accessToken,
                      refresh_token: refreshToken,
                      expires_in: 900,
                      refresh_expires_in: 86400,
                  };
        browserSdk.auth.setClientToken(clientToken);
        updateAuthBadge();

        return browserSdk.payments.create(goid, {
            amount: 1000,
            currency: 'CZK',
            order_number: 'ORDER-CT-TEST',
            customer: { email: 'test@example.com' },
            callback: {
                notification_url: 'https://yourshop.example.com/notify',
                return_url: 'https://yourshop.example.com/return',
            },
        });
    });
};

function prefillPaymentId(result) {
    const id = result?.id;
    if (!id) return;
    for (const fieldId of [
        'charge-payment-id',
        'googlepay-payment-id',
        'applepay-payment-id',
        'qr-payment-id',
        'cardpay-payment-id',
    ]) {
        const el = document.getElementById(fieldId);
        if (el) el.value = id;
    }
    _pendingInstrument = null;
    document.getElementById('charge-instrument-info').textContent = '';
    document.getElementById('charge-token-fields').style.display = '';
}

// Instrument prefilled by Google Pay / Apple Pay / Card Pay flows
let _pendingInstrument = null;

function prefillCharge(paymentId, instrument) {
    _pendingInstrument = instrument;
    if (paymentId)
        document.getElementById('charge-payment-id').value = paymentId;
    document.getElementById('charge-instrument-info').textContent =
        JSON.stringify(instrument, null, 2);
    document.getElementById('charge-token-fields').style.display = 'none';
}

window.runCreatePayment = function runCreatePayment() {
    const goid = document.getElementById('create-goid').value.trim();
    const amount = parseInt(document.getElementById('create-amount').value, 10);
    const currency =
        document.getElementById('create-currency').value.trim() || 'CZK';
    const order_number = document
        .getElementById('create-order-number')
        .value.trim();
    const email = document.getElementById('create-customer-email').value.trim();
    const notification_url = document
        .getElementById('create-notification-url')
        .value.trim();
    const return_url = document
        .getElementById('create-return-url')
        .value.trim();

    run(
        'payment-create-output',
        () =>
            sdk.payments.create(goid, {
                amount,
                currency,
                order_number,
                customer: { email },
                callback: { notification_url, return_url },
            }),
        prefillPaymentId,
    );
};

window.runCharge = function runCharge() {
    const paymentId = document.getElementById('charge-payment-id').value.trim();
    const return_url = document
        .getElementById('charge-return-url')
        .value.trim();
    const instrument = _pendingInstrument ?? {
        payment_instrument: 'PAYMENT_CARD',
        input: {
            input_type: 'CARD_TOKEN',
            card_token: document
                .getElementById('charge-card-token')
                .value.trim(),
        },
    };

    run(
        'payment-charge-output',
        () =>
            sdk.payments.charge(paymentId, {
                payment_instrument: instrument,
                return_url,
            }),
        (result) =>
            show3dsPrompt(
                document.getElementById('payment-charge-output'),
                result.action?.redirect_url,
            ),
    );
};

window.clearCharge = function clearCharge() {
    _pendingInstrument = null;
    document.getElementById('charge-payment-id').value = '';
    document.getElementById('charge-card-token').value = '';
    document.getElementById('charge-instrument-info').textContent =
        'No instrument prefilled — complete a payment flow above, or enter a card token manually.';
    document.getElementById('charge-token-fields').style.display = '';
    document.getElementById('payment-charge-output').textContent = '—';
};

// Holds the config fetched in step 1, consumed in step 2
let _googlePayInfo = null;
let _googlePaymentId = null;

window.googlePayLoadInfo = async function googlePayLoadInfo() {
    const paymentId = document
        .getElementById('googlepay-payment-id')
        .value.trim();
    const pre = document.getElementById('googlepay-output');
    const container = document.getElementById('googlepay-button-container');
    container.innerHTML = '';
    _googlePayInfo = null;
    _googlePaymentId = null;

    if (!window.google) {
        pre.textContent =
            'Google Pay script not loaded yet — please wait a moment and try again.';
        return;
    }

    pre.textContent = 'Step 1: Fetching Google Pay info…';
    try {
        _googlePayInfo = await sdk.payments.getGooglePayInfo(paymentId);
        _googlePaymentId = paymentId;
        pre.textContent = `── API response (getGooglePayInfo) ──\n${JSON.stringify(_googlePayInfo, null, 2)}\n\nClick the Google Pay button to proceed.`;
    } catch (err) {
        pre.textContent = `[Step 1 failed] ${err?.message ?? String(err)}`;
        return;
    }

    // Render the Google Pay button — loadPaymentData must be called directly from its click
    const paymentsClient = new window.google.payments.api.PaymentsClient({
        environment: _googlePayInfo.environment,
    });
    const btn = paymentsClient.createButton({ onClick: googlePayOpenSheet });
    container.appendChild(btn);
};

async function googlePayOpenSheet() {
    const pre = document.getElementById('googlepay-output');
    if (!_googlePayInfo || !_googlePaymentId) return;

    const paymentsClient = new window.google.payments.api.PaymentsClient({
        environment: _googlePayInfo.environment,
    });

    let paymentData;
    try {
        pre.textContent += '\n\nOpening Google Pay sheet…';
        paymentData = await paymentsClient.loadPaymentData(
            _googlePayInfo.paymentDataRequest,
        );
    } catch (err) {
        pre.textContent += `\n\nGoogle Pay sheet closed.\n${err?.statusCode === 'CANCELED' ? 'User cancelled.' : String(err?.message ?? err)}`;
        return;
    }

    // tokenizationData.token is a JSON string: { protocolVersion, signature, signedMessage, ... }
    const tokenData = JSON.parse(
        paymentData.paymentMethodData.tokenizationData.token,
    );
    prefillCharge(_googlePaymentId, {
        payment_instrument: 'PAYMENT_CARD',
        input: {
            input_type: 'GOOGLE_PAY',
            protocolVersion: tokenData.protocolVersion,
            signature: tokenData.signature,
            signedMessage: tokenData.signedMessage,
        },
    });
    pre.textContent += '\n\nCharge section prefilled — scroll down to run.';
}

// Holds the config fetched in step 1, consumed in step 2
let _applePayInfo = null;
let _applePaymentId = null;

window.applePayLoadInfo = async function applePayLoadInfo() {
    const paymentId = document
        .getElementById('applepay-payment-id')
        .value.trim();
    const pre = document.getElementById('applepay-output');
    const container = document.getElementById('applepay-button-container');
    container.innerHTML = '';
    _applePayInfo = null;
    _applePaymentId = null;

    pre.textContent = 'Step 1: Fetching Apple Pay info…';
    try {
        _applePayInfo = await sdk.payments.getApplePayInfo(paymentId);
        _applePaymentId = paymentId;
        pre.textContent = `── API response (getApplePayInfo) ──\n${JSON.stringify(_applePayInfo, null, 2)}\n\nClick a button below to proceed.`;
    } catch (err) {
        pre.textContent = `[Step 1 failed] ${err?.message ?? String(err)}`;
        return;
    }

    // Mock button — always shown, uses the polyfill stub
    if (window.MockApplePaySession) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'applepay-mock-btn';
        btn.textContent = ' Pay (Mock — dev only)';
        Object.assign(btn.style, {
            background: '#856404',
            color: '#fff',
            borderRadius: '6px',
            padding: '0.5rem 1.5rem',
            fontSize: '1rem',
            fontWeight: '600',
            letterSpacing: '-0.3px',
            border: '2px dashed #ffc107',
            cursor: 'pointer',
        });
        btn.onclick = () => applePayBeginSession(window.MockApplePaySession);
        container.appendChild(btn);
    }

    // Native Safari ApplePaySession button
    const hasNativeSession =
        window.ApplePaySession && !window.ApplePaySession.__isPolyfill;
    if (hasNativeSession) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = ' Pay (Safari native)';
        Object.assign(btn.style, {
            background: '#000',
            color: '#fff',
            borderRadius: '6px',
            padding: '0.5rem 1.5rem',
            fontSize: '1rem',
            fontWeight: '600',
            letterSpacing: '-0.3px',
            border: 'none',
            cursor: 'pointer',
        });
        btn.onclick = () => applePayBeginSession(window.ApplePaySession);
        container.appendChild(btn);
    }

    // PaymentRequest (cross-device QR) button — only on non-Apple browsers.
    // On Safari/WebKit, PaymentRequest just opens the same native sheet as ApplePaySession.
    if (
        !hasNativeSession &&
        (await supportsPaymentRequestApplePay(_applePayInfo))
    ) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = ' Pay (QR code)';
        Object.assign(btn.style, {
            background: '#1a1a2e',
            color: '#fff',
            borderRadius: '6px',
            padding: '0.5rem 1.5rem',
            fontSize: '1rem',
            fontWeight: '600',
            letterSpacing: '-0.3px',
            border: 'none',
            cursor: 'pointer',
        });
        btn.onclick = applePayPaymentRequestFlow;
        container.appendChild(btn);
    }
};

function buildApplePayPaymentMethod(info) {
    const pr = info.applePayPaymentRequest;
    return {
        supportedMethods: 'https://apple.com/apple-pay',
        data: {
            version: info.applepayVersion,
            merchantIdentifier: info.merchantIdentifier,
            merchantCapabilities: pr.merchantCapabilities,
            supportedNetworks: pr.supportedNetworks,
            countryCode: pr.countryCode,
        },
    };
}

function buildPaymentDetails(info) {
    const pr = info.applePayPaymentRequest;
    return {
        total: {
            label: pr.total.label,
            amount: {
                currency: pr.currencyCode,
                value: String(pr.total.amount),
            },
        },
    };
}

async function supportsPaymentRequestApplePay(info) {
    if (!window.PaymentRequest) return false;
    try {
        const req = new PaymentRequest(
            [buildApplePayPaymentMethod(info)],
            buildPaymentDetails(info),
        );
        return await req.canMakePayment();
    } catch {
        return false;
    }
}

async function applePayPaymentRequestFlow() {
    const pre = document.getElementById('applepay-output');
    if (!_applePayInfo || !_applePaymentId) return;

    pre.textContent += '\n\n── Step 2: PaymentRequest (cross-device QR) ──';
    let paymentResponse;
    try {
        const request = new PaymentRequest(
            [buildApplePayPaymentMethod(_applePayInfo)],
            buildPaymentDetails(_applePayInfo),
        );
        paymentResponse = await request.show();
    } catch (err) {
        pre.textContent += `\nCancelled or failed: ${err?.message ?? String(err)}`;
        return;
    }

    const { data, signature, version, header } =
        paymentResponse.details.token.paymentData;
    const returnUrl = document.getElementById('charge-return-url').value.trim();
    const instrument = {
        payment_instrument: 'PAYMENT_CARD',
        input: { input_type: 'APPLE_PAY', data, signature, version, header },
    };
    prefillCharge(_applePaymentId, instrument);
    try {
        const charge = await sdk.payments.charge(_applePaymentId, {
            payment_instrument: instrument,
            return_url: returnUrl,
        });
        await paymentResponse.complete('success');
        pre.textContent += `\n\nCharge result:\n${JSON.stringify(charge, null, 2)}`;
        if (charge.action?.redirect_url) {
            pre.textContent += `\n\nRedirect to: ${charge.action.redirect_url}`;
        }
    } catch (err) {
        await paymentResponse.complete('fail');
        pre.textContent += `\nCharge failed: ${err?.message ?? String(err)}`;
    }
}

function applePayBeginSession(SessionClass = window.ApplePaySession) {
    const pre = document.getElementById('applepay-output');
    if (!_applePayInfo || !_applePaymentId) return;

    const session = new SessionClass(
        _applePayInfo.applepayVersion,
        _applePayInfo.applePayPaymentRequest,
    );

    session.onpaymentauthorized = async (event) => {
        const { data, signature, version, header } =
            event.payment.token.paymentData;
        const returnUrl = document
            .getElementById('charge-return-url')
            .value.trim();
        const instrument = {
            payment_instrument: 'PAYMENT_CARD',
            input: {
                input_type: 'APPLE_PAY',
                data,
                signature,
                version,
                header,
            },
        };
        prefillCharge(_applePaymentId, instrument);
        try {
            const charge = await sdk.payments.charge(_applePaymentId, {
                payment_instrument: instrument,
                return_url: returnUrl,
            });
            session.completePayment(SessionClass.STATUS_SUCCESS);
            pre.textContent += `\n\nCharge result:\n${JSON.stringify(charge, null, 2)}`;
            if (charge.action?.redirect_url) {
                pre.textContent += `\n\nRedirect to: ${charge.action.redirect_url}`;
            }
        } catch (err) {
            session.completePayment(SessionClass.STATUS_FAILURE);
            pre.textContent += `\nCharge failed: ${err?.message ?? String(err)}`;
        }
    };

    session.oncancel = () => {
        pre.textContent += '\n\nApple Pay sheet closed. User cancelled.';
    };

    sdk.payments.startApplePaySession(_applePaymentId, session);
}

window.runQRPaymentInfo = function runQRPaymentInfo() {
    const paymentId = document.getElementById('qr-payment-id').value.trim();
    const format = document.getElementById('qr-format').value || undefined;
    run('qr-output', () => sdk.payments.getQRPaymentInfo(paymentId, format));
};

window.cardPayOpenIframe = async function cardPayOpenIframe() {
    const paymentId = document
        .getElementById('cardpay-payment-id')
        .value.trim();
    const pre = document.getElementById('cardpay-output');
    const container = document.getElementById('cardpay-iframe-container');
    container.style.display = 'block';
    pre.textContent = `── Step 1: iframe mounted ──\nPayment ID: ${paymentId || '(none)'}\n\nWaiting for card confirmation in iframe…`;

    try {
        const tokenResult = await sdk.cards.mountCardForm(
            container,
            '/sdk/src/iframe/card-encrypt.html',
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
};
