import { run } from './helpers.js';
import { sdk } from './sdk.js';

function prefillRefundId(result) {
    const id = result?.id;
    if (!id) {
        return;
    }
    const el = document.getElementById('refund-get-id');
    if (el) {
        el.value = id;
    }
}

export function runRefundPayment() {
    const paymentId = document.getElementById('refund-payment-id').value.trim();
    const rawAmount = document.getElementById('refund-amount').value.trim();
    if (!rawAmount) {
        document.getElementById('refund-create-output').textContent =
            'Amount is required.';
        return;
    }
    // parseInt would quietly accept "10.5" as 10 and "1e3" as 1, refunding a
    // different amount than was typed. The API requires a positive integer.
    const amount = Number(rawAmount);
    if (!Number.isInteger(amount) || amount < 1) {
        document.getElementById('refund-create-output').textContent =
            'Amount must be a positive whole number of cents.';
        return;
    }
    run(
        'refund-create-output',
        () => sdk.refundPayment(paymentId, { amount }),
        prefillRefundId,
    );
}

export function runListRefunds() {
    const paymentId = document
        .getElementById('refund-list-payment-id')
        .value.trim();
    run('refund-list-output', () => sdk.listRefunds(paymentId));
}

export function runGetRefund() {
    const refundId = document.getElementById('refund-get-id').value.trim();
    run('refund-get-output', () => sdk.getRefund(refundId));
}
