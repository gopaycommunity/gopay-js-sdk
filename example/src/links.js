import { run, showLinkBanner } from './helpers.js';
import { sdk } from './sdk.js';

// Reads a field that must hold a positive whole number, or nothing at all.
// parseInt would quietly accept "10.5" as 10 and "1e3" as 1, creating a link
// with different terms than were typed.
function readOptionalPositiveInt(fieldId, label, outputId) {
    const raw = document.getElementById(fieldId).value.trim();
    if (!raw) {
        return undefined;
    }
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1) {
        document.getElementById(outputId).textContent =
            `${label} must be a positive whole number.`;
        return null;
    }
    return value;
}

function prefillLinkId(result) {
    const goid = document.getElementById('link-goid').value.trim();
    for (const fieldId of ['link-get-goid', 'link-disable-goid']) {
        const el = document.getElementById(fieldId);
        if (el) {
            el.value = goid;
        }
    }
    if (!result?.id) {
        return;
    }
    for (const fieldId of ['link-get-id', 'link-disable-id']) {
        const el = document.getElementById(fieldId);
        if (el) {
            el.value = result.id;
        }
    }
    if (result.url) {
        // The API returns the shareable URL as data; render it as a real anchor
        // rather than making the developer select it out of the JSON.
        showLinkBanner(document.getElementById('link-create-output'), {
            kind: 'link-url',
            href: result.url,
            message: result.url,
            cta: 'Open link →',
            palette: {
                background: '#eef6ff',
                border: '#9dc3ec',
                text: '#1c3f61',
            },
        });
    }
}

// Create a payment link. The link stores the payment data; the payment itself
// is created when a customer opens the URL.
// Example:
//   const link = await sdk.createPaymentLink(goid, { payment: {...} });
//   sendToCustomer(link.url);   // share this
//   await db.save({ linkId: link.id });  // keep this to manage the link later
export function runCreatePaymentLink() {
    const goid = document.getElementById('link-goid').value.trim();
    const currency =
        document.getElementById('link-currency').value.trim() || 'CZK';
    const order_number = document
        .getElementById('link-order-number')
        .value.trim();
    const email = document.getElementById('link-customer-email').value.trim();
    const notification_url = document
        .getElementById('link-notification-url')
        .value.trim();
    const return_url = document.getElementById('link-return-url').value.trim();

    const amount = readOptionalPositiveInt(
        'link-amount',
        'Amount',
        'link-create-output',
    );
    if (amount === null) {
        return;
    }
    if (amount === undefined) {
        document.getElementById('link-create-output').textContent =
            'Amount is required.';
        return;
    }
    const expires_in = readOptionalPositiveInt(
        'link-expires-in',
        'Expires in',
        'link-create-output',
    );
    if (expires_in === null) {
        return;
    }

    // reusable defaults to true server-side, so the default choice leaves the
    // field out of the body entirely rather than pinning it from this page.
    const reusableRaw = document.getElementById('link-reusable').value;
    const params = {
        payment: {
            amount,
            currency,
            order_number,
            customer: { email },
            callback: { notification_url, return_url },
        },
        ...(expires_in === undefined ? {} : { expires_in }),
        ...(reusableRaw === '' ? {} : { reusable: reusableRaw === 'true' }),
    };

    run(
        'link-create-output',
        () => sdk.createPaymentLink(goid, params),
        prefillLinkId,
    );
}

// Read a link's current state. Expiry is evaluated on read: an expired link is
// reported active: false / stop_reason: EXPIRED without anything being written.
// Example:
//   const link = await sdk.getPaymentLink(goid, linkId);
//   if (!link.active) console.log('no longer payable:', link.stop_reason);
export function runGetPaymentLink() {
    const goid = document.getElementById('link-get-goid').value.trim();
    const linkId = document.getElementById('link-get-id').value.trim();
    run('link-get-output', () => sdk.getPaymentLink(goid, linkId));
}

// Disable a link. Returns void (204 No Content), so this reads the link back
// afterwards — which also shows that disabling is not a delete.
// Example:
//   await sdk.disablePaymentLink(goid, linkId);
export function runDisablePaymentLink() {
    const goid = document.getElementById('link-disable-goid').value.trim();
    const linkId = document.getElementById('link-disable-id').value.trim();
    run('link-disable-output', async () => {
        await sdk.disablePaymentLink(goid, linkId);
        return {
            disabled: true,
            link: await sdk.getPaymentLink(goid, linkId),
        };
    });
}
