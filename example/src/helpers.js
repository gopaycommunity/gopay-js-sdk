import { GoPayHTTPError, GoPaySDKError } from 'gopay-js-sdk';

// Shared mutable state across modules
export const state = {
    lastClientToken: null,
    pendingInstrument: null,
};

export function show3dsPrompt(pre, redirectUrl) {
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

export async function run(outputId, fn, onSuccess) {
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

export function prefillPaymentId(result) {
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
    state.pendingInstrument = null;
    document.getElementById('charge-instrument-info').textContent = '';
    document.getElementById('charge-token-fields').style.display = '';
}

export function prefillCharge(paymentId, instrument) {
    state.pendingInstrument = instrument;
    if (paymentId)
        document.getElementById('charge-payment-id').value = paymentId;
    document.getElementById('charge-instrument-info').textContent =
        JSON.stringify(instrument, null, 2);
    document.getElementById('charge-token-fields').style.display = 'none';
}
