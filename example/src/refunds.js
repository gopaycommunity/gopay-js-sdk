import { formatError, run } from './helpers.js';
import { sanitizeBody } from './sanitize.js';
import { sdk } from './sdk.js';

function prefillRefundId(result) {
    const id = result?.id;
    if (!id) {
        return;
    }
    for (const fieldId of ['refund-get-id', 'refund-await-id']) {
        const el = document.getElementById(fieldId);
        if (el) {
            el.value = id;
        }
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

export async function runAwaitRefundState() {
    const refundId = document.getElementById('refund-await-id').value.trim();
    const pre = document.getElementById('refund-await-output');
    pre.textContent = '\u2500\u2500 polling refund state \u2500\u2500';
    try {
        // Refunds are asynchronous: refundPayment only ever returns REQUESTED, so
        // this polls until the refund settles instead of making the caller loop.
        // timeoutMs is not optional in practice — without it the SDK keeps issuing
        // GET /refunds/{id} indefinitely and this panel would sit on "polling"
        // with no way to stop it.
        const settled = await sdk.awaitRefundState(refundId, {
            timeoutMs: 60_000,
            onStateChange: (state) => {
                pre.textContent += `\n${state.state}`;
            },
        });
        pre.textContent += `\n\n\u2500\u2500 ${settled.state} \u2500\u2500\n${JSON.stringify(sanitizeBody(settled), null, 2)}`;
    } catch (err) {
        if (err?.errorCode === 'CHARGE_TIMEOUT') {
            pre.textContent +=
                '\n\nPolling timed out — the refund is still processing, check it manually.';
        } else {
            pre.textContent += `\n\n\u2500\u2500 onError \u2500\u2500\n${formatError(err)}`;
        }
    }
}
