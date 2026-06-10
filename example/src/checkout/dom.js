export function show(id) {
    document.getElementById(id)?.classList.remove('hidden');
}

export function hide(id) {
    document.getElementById(id)?.classList.add('hidden');
}

export function setPayButtonEnabled(enabled) {
    const btn = document.getElementById('pay-btn');
    if (!btn) {
        return;
    }
    btn.disabled = !enabled;
}

export function showCheckoutError() {
    show('checkout-error');
    hide('checkout-loading');
    hide('payment-content');
}

export function showPaymentErrorBanner() {
    show('payment-error-banner');
}

export function hidePaymentErrorBanner() {
    hide('payment-error-banner');
}

/**
 * Toggle a secondary payment panel (card / qr).
 * Passing the already-active method or null collapses all panels.
 */
let _activeMethod = null;

export function activateMethod(method) {
    const next = method === _activeMethod ? null : method;
    _activeMethod = next;

    for (const m of ['card', 'qr']) {
        const panel = document.getElementById(`panel-${m}`);
        const btn = document.getElementById(`method-${m}-btn`);
        const active = m === next;

        panel?.classList.toggle('hidden', !active);

        if (btn) {
            btn.classList.toggle('border-[#C8102E]', active);
            btn.classList.toggle('bg-[#FFF5F5]', active);
            btn.classList.toggle('text-[#C8102E]', active);
            btn.classList.toggle('border-[#E5E7EB]', !active);
            btn.classList.toggle('bg-white', !active);
            btn.classList.toggle('text-[#374151]', !active);
        }
    }
}

export function showStatusOverlay() {
    show('status-overlay');
}

export function showStatusSuccess() {
    show('status-overlay');
    hide('status-loading');
    show('status-success');
}

export function showStatusFailure() {
    show('status-overlay');
    hide('status-loading');
    show('status-failure');
}
