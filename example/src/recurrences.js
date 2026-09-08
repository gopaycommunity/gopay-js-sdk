import {
    clearLinkBanner,
    formatError,
    run,
    showLinkBanner,
} from './helpers.js';
import { appendOutput } from './output-scroll.js';
import { sanitizeBody } from './sanitize.js';
import { sdk } from './sdk.js';

// Reads a field that must hold a positive whole number, or nothing at all.
// parseInt would quietly accept "10.5" as 10 and "1e3" as 1, creating a
// recurrence with different terms than were typed.
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

// recurrence_date_to is a plain calendar date, and the API rejects a past one
// with 400. An `input[type=date]` already guarantees the *shape* — its value is
// either a normalized yyyy-MM-dd string or empty — so the only thing left worth
// checking here is that the date has not gone by.
function readRecurrenceDateTo(outputId) {
    const raw = document.getElementById('rec-create-date-to').value.trim();
    if (!raw) {
        document.getElementById(outputId).textContent =
            'Recurrence date to is required.';
        return null;
    }
    if (raw <= new Date().toISOString().slice(0, 10)) {
        document.getElementById(outputId).textContent =
            'Recurrence date to must be in the future — the API rejects a past date with 400.';
        return null;
    }
    return raw;
}

// The panel's default has to be relative: a hardcoded date silently starts
// returning 400 the day it goes by. Two years out, as a plain yyyy-MM-dd.
export function initRecurrenceDateDefault() {
    const el = document.getElementById('rec-create-date-to');
    if (!el || el.value) {
        return;
    }
    const d = new Date();
    d.setFullYear(d.getFullYear() + 2);
    el.value = d.toISOString().slice(0, 10);
}

function prefillRecurrenceId(result) {
    if (!result?.id) {
        return;
    }
    for (const fieldId of [
        'rec-get-id',
        'rec-start-id',
        'rec-await-id',
        'rec-next-id',
        'rec-stop-id',
    ]) {
        const el = document.getElementById(fieldId);
        if (el) {
            el.value = result.id;
        }
    }
}

// The gateway URL of the payment a start/next call created. The customer pays
// there — and until they pay the *first* one, createNextPayment stays 409 — so
// render it as a real anchor instead of leaving it buried in the JSON.
function showGatewayUrl(outputId, payment) {
    const pre = document.getElementById(outputId);
    // Drop the previous run's banner first: it is a sibling of `pre`, so
    // rewriting the output text leaves it in place, and a 409 or a validation
    // bounce would otherwise show an error next to a live link to the *old*
    // payment. See clearLinkBanner in helpers.js.
    clearLinkBanner(pre, 'link-url');
    if (!payment?.gw_url) {
        return;
    }
    showLinkBanner(pre, {
        kind: 'link-url',
        href: payment.gw_url,
        message: payment.gw_url,
        cta: 'Pay this payment →',
        palette: {
            background: '#eef6ff',
            border: '#9dc3ec',
            text: '#1c3f61',
        },
    });
}

// Show the schedule fields only for AUTO: an ON_DEMAND recurrence must not send
// a schedule at all, and the API rejects one that does.
export function syncRecurrenceTypeFields() {
    const type = document.getElementById('rec-create-type').value;
    const scheduleRow = document.getElementById('rec-create-schedule-row');
    if (scheduleRow) {
        // style.display, not the hidden attribute: `.fields { display: flex }`
        // is an author rule and so beats the UA stylesheet's [hidden] no matter
        // the specificity. Same reason charge-token-fields toggles this way.
        scheduleRow.style.display = type === 'AUTO' ? '' : 'none';
    }
}

// Create a recurrence. Nothing is charged and no payment exists yet — this
// stores a payment template plus, for AUTO, the schedule GoPay creates payments on.
// Example:
//   const rec = await sdk.createRecurrence(goid, {
//     type: 'ON_DEMAND', recurrence_date_to: '2027-09-04', payment: {...},
//   });
export function runCreateRecurrence() {
    const goid = document.getElementById('rec-create-goid').value.trim();
    const type = document.getElementById('rec-create-type').value;
    const currency =
        document.getElementById('rec-create-currency').value.trim() || 'CZK';
    const order_number = document
        .getElementById('rec-create-order-number')
        .value.trim();
    const order_description = document
        .getElementById('rec-create-order-description')
        .value.trim();
    const email = document.getElementById('rec-create-email').value.trim();
    const notification_url = document
        .getElementById('rec-create-notification-url')
        .value.trim();
    const return_url = document
        .getElementById('rec-create-return-url')
        .value.trim();

    const amount = readOptionalPositiveInt(
        'rec-create-amount',
        'Amount',
        'rec-create-output',
    );
    if (amount === null) {
        return;
    }
    if (amount === undefined) {
        document.getElementById('rec-create-output').textContent =
            'Amount is required.';
        return;
    }

    const recurrence_date_to = readRecurrenceDateTo('rec-create-output');
    if (recurrence_date_to === null) {
        return;
    }

    const payment = {
        amount,
        currency,
        order_number,
        customer: { email },
        callback: { notification_url, return_url },
        ...(order_description ? { order_description } : {}),
    };

    // AUTO carries the schedule; ON_DEMAND must not send the field at all.
    let params;
    if (type === 'AUTO') {
        const cycle = readOptionalPositiveInt(
            'rec-create-cycle',
            'Cycle',
            'rec-create-output',
        );
        if (cycle === null) {
            return;
        }
        if (cycle === undefined) {
            document.getElementById('rec-create-output').textContent =
                'Cycle is required for an AUTO recurrence.';
            return;
        }
        params = {
            type: 'AUTO',
            schedule: {
                period: document.getElementById('rec-create-period').value,
                cycle,
            },
            recurrence_date_to,
            payment,
        };
    } else {
        params = { type: 'ON_DEMAND', recurrence_date_to, payment };
    }

    run(
        'rec-create-output',
        () => sdk.createRecurrence(goid, params),
        prefillRecurrenceId,
    );
}

// Read a recurrence's current state and the payment it carries.
// Example:
//   const rec = await sdk.getRecurrence(recId);
//   if (rec.state === 'STOPPED') console.log('ended:', rec.stop_reason);
export function runGetRecurrence() {
    const recId = document.getElementById('rec-get-id').value.trim();
    run('rec-get-output', () => sdk.getRecurrence(recId));
}

// Create the first payment. This moves the recurrence to REQUESTED and returns
// the payment; the customer still has to pay it at gw_url before the recurrence
// becomes STARTED. Starting twice is a 409.
// Example:
//   const payment = await sdk.startRecurrence(recId);
//   sendToCustomer(payment.gw_url);
export function runStartRecurrence() {
    const recId = document.getElementById('rec-start-id').value.trim();
    clearLinkBanner(document.getElementById('rec-start-output'), 'link-url');
    const amount = readOptionalPositiveInt(
        'rec-start-amount',
        'Amount',
        'rec-start-output',
    );
    if (amount === null) {
        return;
    }
    const override = amount === undefined ? undefined : { amount };
    run(
        'rec-start-output',
        () => sdk.startRecurrence(recId, override),
        (payment) => showGatewayUrl('rec-start-output', payment),
    );
}

// Create the next payment. Only valid once the recurrence is STARTED — before
// that the API answers 409, which is what the await panel above is for.
// Example:
//   const payment = await sdk.createNextPayment(recId, { amount: 2500 });
export function runCreateNextPayment() {
    const recId = document.getElementById('rec-next-id').value.trim();
    clearLinkBanner(document.getElementById('rec-next-output'), 'link-url');
    const order_number = document
        .getElementById('rec-next-order-number')
        .value.trim();
    const amount = readOptionalPositiveInt(
        'rec-next-amount',
        'Amount',
        'rec-next-output',
    );
    if (amount === null) {
        return;
    }

    // Overrides replace only the fields that are sent; an empty body keeps the
    // stored template as-is, so it is sent as undefined rather than {}.
    const override = {
        ...(amount === undefined ? {} : { amount }),
        ...(order_number ? { order_number } : {}),
    };

    run(
        'rec-next-output',
        () =>
            sdk.createNextPayment(
                recId,
                Object.keys(override).length ? override : undefined,
            ),
        (payment) => showGatewayUrl('rec-next-output', payment),
    );
}

// Stop a recurrence. Returns void (204 No Content), so this reads it back
// afterwards — which also shows that stopping is not a delete.
// Example:
//   await sdk.stopRecurrence(recId);
export function runStopRecurrence() {
    const recId = document.getElementById('rec-stop-id').value.trim();
    run('rec-stop-output', async () => {
        await sdk.stopRecurrence(recId);
        return {
            stopped: true,
            recurrence: await sdk.getRecurrence(recId),
        };
    });
}

// Wait for the recurrence to settle. startRecurrence leaves it REQUESTED and
// createNextPayment answers 409 until the customer pays that first payment, so
// this polls until it reaches STARTED (paid) or STOPPED.
export async function runAwaitRecurrenceState() {
    const recId = document.getElementById('rec-await-id').value.trim();
    const pre = document.getElementById('rec-await-output');
    pre.textContent = '── polling recurrence state ──';
    try {
        // timeoutMs is not optional in practice — without it the SDK keeps
        // issuing GET /recurrences/{id} indefinitely and this panel would sit on
        // "polling" with no way to stop it. A real integration would wait far
        // longer than 60s, since it is waiting on a human to pay.
        const settled = await sdk.awaitRecurrenceState(recId, {
            timeoutMs: 60_000,
            onStateChange: (rec) => {
                appendOutput(pre, `\n${rec.state}`);
            },
        });
        appendOutput(
            pre,
            `\n\n── ${settled.state} ──\n${JSON.stringify(sanitizeBody(settled), null, 2)}`,
        );
    } catch (err) {
        if (err?.errorCode === 'CHARGE_TIMEOUT') {
            appendOutput(
                pre,
                '\n\nPolling timed out — the customer has not paid the first payment yet. Check it manually.',
            );
        } else {
            appendOutput(pre, `\n\n── onError ──\n${formatError(err)}`);
        }
    }
}
