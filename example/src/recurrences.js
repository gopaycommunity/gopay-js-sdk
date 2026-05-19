import { run } from './helpers.js';
import { sdk } from './sdk.js';

export function prefillRecurrenceId(result) {
    const id = result?.id;
    if (!id) {
        return;
    }
    for (const fieldId of [
        'rec-status-id',
        'rec-stop-id',
        'rec-start-id',
        'rec-next-id',
    ]) {
        const el = document.getElementById(fieldId);
        if (el) {
            el.value = id;
        }
    }
}

export function runCreateRecurrence() {
    const goid = document.getElementById('rec-create-goid').value.trim();
    const type = document.getElementById('rec-create-type').value;
    const amount = parseInt(
        document.getElementById('rec-create-amount').value,
        10,
    );
    const currency =
        document.getElementById('rec-create-currency').value.trim() || 'CZK';
    const order_number = document
        .getElementById('rec-create-order-number')
        .value.trim();
    const email = document.getElementById('rec-create-email').value.trim();
    const notification_url = document
        .getElementById('rec-create-notification-url')
        .value.trim();
    const return_url = document
        .getElementById('rec-create-return-url')
        .value.trim();

    const params = {
        type,
        payment: {
            amount,
            currency,
            order_number,
            customer: { email },
            callback: { notification_url, return_url },
        },
    };

    run(
        'rec-create-output',
        () => sdk.createRecurrence(goid, params),
        prefillRecurrenceId,
    );
}

export function runRecurrenceStatus() {
    const recId = document.getElementById('rec-status-id').value.trim();
    run('rec-status-output', () => sdk.recurrenceStatus(recId));
}

export function runStartRecurrence() {
    const recId = document.getElementById('rec-start-id').value.trim();
    run('rec-start-output', () => sdk.startRecurrence(recId));
}

export function runRecurrenceNext() {
    const recId = document.getElementById('rec-next-id').value.trim();
    const amountRaw = document.getElementById('rec-next-amount').value.trim();
    const order_number = document
        .getElementById('rec-next-order-number')
        .value.trim();

    const params = {};
    if (amountRaw) {
        params.amount = parseInt(amountRaw, 10);
    }
    if (order_number) {
        params.order_number = order_number;
    }

    run('rec-next-output', () =>
        sdk.recurrenceNext(
            recId,
            Object.keys(params).length ? params : undefined,
        ),
    );
}

export function runStopRecurrence() {
    const recId = document.getElementById('rec-stop-id').value.trim();
    run('rec-stop-output', async () => {
        await sdk.stopRecurrence(recId);
        return { stopped: true, rec_id: recId };
    });
}
