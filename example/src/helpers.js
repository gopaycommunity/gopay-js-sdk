import { GoPayHTTPError, GoPaySDKError } from 'gopay-js-sdk';
import { getBrowserSDK, isSdkAttached } from './browser-sdk.js';
import { sanitizeBody } from './sanitize.js';
import { sdkConfig } from './sdk.js';

// Shared mutable state across modules
export const state = {
    pendingInstrument: null,
};

export function show3dsPrompt(pre, redirectUrl) {
    if (pre.nextElementSibling?.dataset.tds) {
        pre.nextElementSibling.remove();
    }
    if (!redirectUrl) {
        return;
    }
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

export async function run(outputId, fn, onSuccess) {
    const pre = document.getElementById(outputId);
    pre.textContent = 'Running…';
    try {
        const result = await fn();
        pre.textContent = `── onSuccess ──\n${JSON.stringify(result, null, 2)}`;
        if (onSuccess) {
            onSuccess(result);
        }
    } catch (err) {
        pre.textContent = `── onError ──\n${formatError(err)}`;
    }
}

export function formatError(err) {
    if (err instanceof GoPayHTTPError) {
        return `[GoPayHTTPError] HTTP ${err.status}\n${JSON.stringify(sanitizeBody(err.body), null, 2)}`;
    }
    if (err instanceof GoPaySDKError) {
        return `[GoPaySDKError] ${err.errorCode ? `(${err.errorCode}) ` : ''}${err.message}`;
    }
    if (err instanceof Error) {
        return `[${err.constructor.name}] ${err.message}`;
    }
    if (err === null || err === undefined) {
        return `[${typeof err}] ${String(err)}`;
    }
    try {
        return `[${typeof err}] ${JSON.stringify(err)}`;
    } catch {
        return `[${typeof err}] ${String(err)}`;
    }
}

export function updateBrowserBadge() {
    const badge = document.getElementById('browser-sdk-badge');
    if (!badge) {
        return;
    }
    const sdk = getBrowserSDK();
    if (!sdk) {
        badge.textContent = 'not initialized';
        badge.style.background = '#e2e3e5';
        badge.style.color = '#383d41';
    } else if (isSdkAttached()) {
        badge.textContent = 'payment attached';
        badge.style.background = '#d4edda';
        badge.style.color = '#155724';
    } else {
        badge.textContent = 'initialized';
        badge.style.background = '#cce5ff';
        badge.style.color = '#004085';
    }
    updateBrowserSdkInfo(sdk);
}

function updateBrowserSdkInfo(sdk) {
    const pre = document.getElementById('browser-sdk-info');
    if (!pre) {
        return;
    }
    if (!sdk) {
        pre.textContent = 'not initialized';
        return;
    }
    pre.textContent = JSON.stringify(
        {
            version: sdk.version,
            baseUrl:
                sdkConfig.baseUrl ?? `(${sdkConfig.environment ?? 'sandbox'})`,
            methods: Object.keys(sdk).filter(
                (k) => typeof sdk[k] === 'function',
            ),
        },
        null,
        2,
    );
}

export function prefillPaymentId(result) {
    const id = result?.id;
    if (!id) {
        return;
    }
    for (const fieldId of [
        'charge-payment-id',
        'status-payment-id',
        'charge-state-payment-id',
        'googlepay-payment-id',
        'qr-payment-id',
        'refund-payment-id',
        'refund-list-payment-id',
    ]) {
        const el = document.getElementById(fieldId);
        if (el) {
            el.value = id;
        }
    }
    const attachIdEl = document.getElementById('browser-attach-payment-id');
    if (attachIdEl) {
        attachIdEl.value = id;
    }
    const attachSecretEl = document.getElementById(
        'browser-attach-payment-secret',
    );
    if (attachSecretEl) {
        attachSecretEl.value = result?.payment_secret ?? '';
    }
    updateBrowserBadge();
    state.pendingInstrument = null;
    document.getElementById('charge-instrument-info').textContent = '';
    document.getElementById('charge-token-fields').style.display = '';
}

/**
 * Drive a charge-state poll loop via a browser SDK `awaitChargeState` call,
 * writing intermediate states and the terminal result into `pre`.
 *
 * `awaitFn` should be a partially-applied SDK method:
 *   `(opts) => browserSdk.awaitChargeState(opts)`
 */
export async function pollChargeState(awaitFn, pre) {
    pre.textContent += '\n── polling charge state ──';
    try {
        await awaitFn({
            onStateChange: (state) => {
                if (state.state === 'SUCCEEDED' || state.state === 'FAILED') {
                    pre.textContent += `\n\n── ${state.state} ──\n${JSON.stringify(state, null, 2)}`;
                } else {
                    pre.textContent += `\n${state.state}`;
                }
            },
            onActionRequired: (url) => show3dsPrompt(pre, url),
        });
    } catch (err) {
        if (err?.errorCode === 'CHARGE_FAILED') {
            // terminal state already shown by onStateChange
        } else if (err?.errorCode === 'CHARGE_TIMEOUT') {
            pre.textContent +=
                '\n\nPolling timed out — check charge state manually.';
        } else {
            pre.textContent += `\n\n── onError ──\n${formatError(err)}`;
        }
    }
}

export function prefillBrowserCharge(encryptedPayload) {
    const el = document.getElementById('bcharge-encrypted-payload');
    if (el && encryptedPayload) {
        el.value = encryptedPayload;
    }
}

export function prefillTokenize(encryptedPayload) {
    const el = document.getElementById('tokenize-payload');
    if (el && encryptedPayload) {
        el.value = encryptedPayload;
    }
}

export function prefillCharge(paymentId, instrument) {
    state.pendingInstrument = instrument;
    if (paymentId) {
        document.getElementById('charge-payment-id').value = paymentId;
    }
    document.getElementById('charge-instrument-info').textContent =
        JSON.stringify(instrument, null, 2);
    document.getElementById('charge-token-fields').style.display = 'none';
}
