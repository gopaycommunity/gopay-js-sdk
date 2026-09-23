import { getBrowserSDK, requireAttachedSDK } from './browser-sdk.js';
import { formatError } from './helpers.js';
import { appendOutput } from './output-scroll.js';
import { sanitizeBody } from './sanitize.js';

let _ctrl = null;

/**
 * `_ctrl` exists only once `mountApplePayButton()` has resolved, and that call
 * does network I/O — so there is a real window in which the button is being
 * mounted and there is nothing to unmount yet.
 *
 * Without these two, clicking Unmount inside that window reported "nothing
 * mounted" and was then overtaken by a button appearing anyway: the click did
 * nothing and said nothing, which is the fault this ticket exists to remove.
 */
let _mounting = false;
let _unmountRequested = false;

/**
 * Ask whether Apple Pay can be offered at all, before anything is mounted.
 *
 * Deliberately not `requireAttachedSDK`: answering without a payment is the
 * whole point of the call. A merchant showing several methods at once can
 * leave Apple Pay off the list entirely instead of drawing a button and
 * retracting it through `onUnavailable` a moment later.
 */
export async function browserApplePayCheckAvailability() {
    const pre = document.getElementById('bapplepay-output');
    const sdk = getBrowserSDK();

    if (!sdk) {
        pre.textContent =
            'Error: Browser SDK not initialized.\nRun auth.getBrowserKeys() or click "Initialize Browser SDK" first.';
        return;
    }

    pre.textContent = '── checking Apple Pay availability ──';

    try {
        const availability = await sdk.getApplePayAvailability();
        pre.textContent = `── getApplePayAvailability() ──\n${JSON.stringify(availability, null, 2)}`;
    } catch (err) {
        pre.textContent = `── onError (availability) ──\n${formatError(err)}`;
    }
}

export async function browserApplePayLoadInfo() {
    const pre = document.getElementById('bapplepay-output');
    const container = document.getElementById('bapplepay-button-container');

    _ctrl?.unmount();
    _ctrl = null;
    _unmountRequested = false;
    container.replaceChildren();

    const sdk = requireAttachedSDK(pre);
    if (!sdk) {
        return;
    }

    pre.textContent = '── mounting Apple Pay button ──';

    let ctrl;
    _mounting = true;
    try {
        ctrl = await sdk.mountApplePayButton(container, {
            onUnavailable: () => {
                pre.textContent =
                    '── Apple Pay not available on this device or browser ──';
            },
            onCancel: () => {
                appendOutput(
                    pre,
                    '\n\n── onCancel (user dismissed the Apple Pay sheet) ──',
                );
            },
        });
    } catch (err) {
        pre.textContent = `── onError (mount) ──\n${formatError(err)}`;
        return;
    } finally {
        _mounting = false;
    }

    if (_unmountRequested) {
        _unmountRequested = false;
        // Claimed before unmount(), which rejects `result` synchronously —
        // the handler below is never attached on this path, so the rejection
        // would otherwise go unhandled.
        ctrl.result.catch(() => {});
        ctrl.unmount();
        container.replaceChildren();
        pre.textContent =
            '── unmount() — the mount landed after the click and was torn down at once ──';
        return;
    }

    _ctrl = ctrl;

    pre.textContent =
        '── Apple Pay button mounted — click it to start payment ──';

    _ctrl.result.then(
        (chargeState) => {
            pre.textContent = `── onSuccess (charge) ──\n${JSON.stringify(sanitizeBody(chargeState), null, 2)}`;
        },
        (err) => {
            // Appended rather than replacing, like onCancel above: the line
            // that precedes it — "mounted", or the unmount below — is half the
            // story, and overwriting it hid which one led here.
            appendOutput(
                pre,
                `\n\n── onError (charge) ──\n${formatError(err)}`,
            );
        },
    );
}

/**
 * Tear the button down the way an integrator would when the shopper leaves the
 * step — and, since GPOMA-2668, abort an Apple Pay sheet they still have open.
 *
 * Worth a button of its own because there was no way to reach it by hand:
 * `unmount()` only ran implicitly on a re-mount, so the one path that aborts a
 * live session could not be tried, and what it does to `result` was invisible.
 */
export function browserApplePayUnmount() {
    const pre = document.getElementById('bapplepay-output');

    if (!_ctrl) {
        if (_mounting) {
            _unmountRequested = true;
            pre.textContent =
                '── unmount() requested — mount still in flight, will tear down on arrival ──';
            return;
        }
        pre.textContent =
            '── nothing mounted — click "Mount Apple Pay Button" first ──';
        return;
    }

    const ctrl = _ctrl;
    _ctrl = null;
    // Written before the call: unmount() rejects `result` synchronously, and
    // the handler above then appends its onError on the next microtask, so the
    // panel ends up showing the teardown and its consequence in order.
    pre.textContent =
        '── unmount() — aborting any open sheet and removing the button ──';
    ctrl.unmount();
}
