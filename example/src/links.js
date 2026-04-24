import { run } from './helpers.js';
import { sdk } from './sdk.js';

function prefillLinkId(result) {
    const id = result?.id;
    if (!id) return;
    for (const fieldId of ['link-status-id', 'link-disable-id']) {
        const el = document.getElementById(fieldId);
        if (el) el.value = id;
    }
    const urlEl = document.getElementById('link-create-url');
    if (urlEl && result.url) {
        urlEl.href = result.url;
        urlEl.textContent = result.url;
        urlEl.setAttribute('aria-label', result.url);
        urlEl.style.display = 'inline';
    }
}

export function runCreatePaymentLink() {
    const goid = document.getElementById('link-create-goid').value.trim();
    const reusable =
        document.getElementById('link-create-reusable').value === 'true';
    const expires_at =
        document.getElementById('link-create-expires-at').value.trim() ||
        undefined;
    const amount = parseInt(
        document.getElementById('link-create-amount').value,
        10,
    );
    const currency =
        document.getElementById('link-create-currency').value.trim() || 'CZK';
    const order_number = document
        .getElementById('link-create-order-number')
        .value.trim();
    const email = document.getElementById('link-create-email').value.trim();
    const notification_url = document
        .getElementById('link-create-notification-url')
        .value.trim();
    const return_url = document
        .getElementById('link-create-return-url')
        .value.trim();

    const params = {
        reusable,
        payment: {
            amount,
            currency,
            order_number,
            customer: { email },
            callback: { notification_url, return_url },
        },
    };
    if (expires_at) params.expires_at = expires_at;

    run(
        'link-create-output',
        () => sdk.createPaymentLink(goid, params),
        prefillLinkId,
    );
}

export function runLinkStatus() {
    const linkId = document.getElementById('link-status-id').value.trim();
    run('link-status-output', () => sdk.linkStatus(linkId));
}

export function runDisableLink() {
    const linkId = document.getElementById('link-disable-id').value.trim();
    run('link-disable-output', async () => {
        await sdk.disableLink(linkId);
        return { disabled: true, link_id: linkId };
    });
}
