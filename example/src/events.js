import { run } from './helpers.js';
import { sdk } from './sdk.js';

function value(id) {
    return document.getElementById(id).value.trim();
}

function prefillEventId(page) {
    const id = page?.items?.[0]?.id;
    const el = document.getElementById('events-event-id');
    if (id && el) {
        el.value = id;
    }
}

export function runListEvents() {
    const paymentId = value('events-payment-id');
    const maxItems = Number(value('events-max-items'));
    const params = {
        ...(Number.isInteger(maxItems) && maxItems > 0
            ? { max_items: maxItems }
            : {}),
        ...(paymentId
            ? { related_type: 'payments', related_id: paymentId }
            : {}),
    };
    run(
        'events-list-output',
        () => sdk.listEvents(value('events-goid'), params),
        prefillEventId,
    );
}

export function runGetEvent() {
    run('events-get-output', () =>
        sdk.getEvent(value('events-goid'), value('events-event-id')),
    );
}

export function runVerifyWebhook() {
    // Not trimmed: the signature covers the body byte for byte, whitespace included.
    const body = document.getElementById('webhook-body').value;
    run('webhook-verify-output', () =>
        sdk.verifyWebhook(body, value('webhook-signature')),
    );
}

export function runGetWebhookPublicKeys() {
    run('webhook-keys-output', () => sdk.getWebhookPublicKeys());
}
