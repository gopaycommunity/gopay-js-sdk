import { GoPayHTTPError, GoPaySDKError } from '@gopaycz/gopay-js-sdk';
import { getBrowserSDK, isSdkAttached } from './browser-sdk.js';
import { appendOutput } from './output-scroll.js';
import { sanitizeBody } from './sanitize.js';
import { sdkConfig } from './sdk.js';

// Shared mutable state across modules
export const state = {
    pendingInstrument: null,
};

/**
 * Charge states that end the flow. Both the server and the browser charge
 * panels stop polling here, so the set lives in one place.
 */
export const TERMINAL_CHARGE_STATES = new Set(['SUCCEEDED', 'FAILED']);

/**
 * Render a one-line banner with a call-to-action link directly under `pre`,
 * replacing whatever banner of the same `kind` is already there.
 *
 * Two panels want this: the 3DS prompt and the payment link's shareable URL.
 * They differ only in wording and colour, so the DOM lives here once.
 *
 * `href` is validated as http(s): an anchor href is the one place in this page
 * where a hostile string arriving in an API response would become executable.
 */
export function showLinkBanner(pre, { kind, href, message, cta, palette }) {
    const existing = pre.nextElementSibling;
    if (existing?.dataset.banner === kind) {
        existing.remove();
    }
    if (!href) {
        return;
    }
    let parsed;
    try {
        parsed = new URL(href);
    } catch {
        return;
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return;
    }

    const wrap = document.createElement('div');
    wrap.dataset.banner = kind;
    Object.assign(wrap.style, {
        marginTop: '0.6rem',
        padding: '0.75rem 1rem',
        background: palette.background,
        border: `1px solid ${palette.border}`,
        borderRadius: '6px',
        display: 'flex',
        alignItems: 'center',
        gap: '1rem',
    });

    const msg = document.createElement('span');
    Object.assign(msg.style, {
        fontSize: '0.82rem',
        flex: '1',
        color: palette.text,
        wordBreak: 'break-all',
    });
    msg.textContent = message;

    const btn = document.createElement('a');
    btn.href = parsed.href;
    btn.target = '_blank';
    btn.rel = 'noopener';
    btn.textContent = cta;
    Object.assign(btn.style, {
        padding: '0.4rem 0.9rem',
        background: '#1a1a2e',
        color: '#fff',
        borderRadius: '5px',
        fontSize: '0.82rem',
        textDecoration: 'none',
        whiteSpace: 'nowrap',
    });

    wrap.appendChild(msg);
    wrap.appendChild(btn);
    pre.insertAdjacentElement('afterend', wrap);
}

/**
 * Drop the banner of `kind` sitting under `pre`, if there is one.
 *
 * Resetting `pre.textContent` does not touch it — the banner is a sibling — so
 * a charge that never reaches ACTION_REQUIRED would otherwise leave the
 * previous charge's 3DS link on screen, pointing at a dead ACS URL.
 */
export function clearLinkBanner(pre, kind) {
    if (pre?.nextElementSibling?.dataset.banner === kind) {
        pre.nextElementSibling.remove();
    }
}

export function show3dsPrompt(pre, redirectUrl) {
    showLinkBanner(pre, {
        kind: 'tds',
        href: redirectUrl,
        message:
            '3DS authentication required — redirect the customer to complete verification.',
        cta: 'Open 3DS verification →',
        palette: {
            background: '#fff8e1',
            border: '#e0b840',
            text: '#5a4200',
        },
    });
}

export async function run(outputId, fn, onSuccess) {
    const pre = document.getElementById(outputId);
    pre.textContent = 'Running…';
    try {
        const result = await fn();
        pre.textContent = `── onSuccess ──\n${JSON.stringify(sanitizeBody(result), null, 2)}`;
        if (onSuccess) {
            onSuccess(result);
        }
    } catch (err) {
        pre.textContent = `── onError ──\n${formatError(err)}`;
    }
}

export function formatError(err) {
    if (err instanceof GoPayHTTPError) {
        return `[GoPayHTTPError] HTTP ${err.status}\n${JSON.stringify(sanitizeBody(err.body), null, 2)}`;
    }
    if (err instanceof GoPaySDKError) {
        return `[GoPaySDKError] ${err.errorCode ? `(${err.errorCode}) ` : ''}${err.message}`;
    }
    if (err instanceof Error) {
        return `[${err.constructor.name}] ${err.message}`;
    }
    if (err === null || err === undefined) {
        return `[${typeof err}] ${String(err)}`;
    }
    try {
        return `[${typeof err}] ${JSON.stringify(err)}`;
    } catch {
        return `[${typeof err}] ${String(err)}`;
    }
}

export function updateBrowserBadge() {
    const badge = document.getElementById('browser-sdk-badge');
    if (!badge) {
        return;
    }
    const sdk = getBrowserSDK();
    if (!sdk) {
        badge.textContent = 'not initialized';
        badge.style.background = '#e2e3e5';
        badge.style.color = '#383d41';
    } else if (isSdkAttached()) {
        badge.textContent = 'payment attached';
        badge.style.background = '#d4edda';
        badge.style.color = '#155724';
    } else {
        badge.textContent = 'initialized';
        badge.style.background = '#cce5ff';
        badge.style.color = '#004085';
    }
    updateBrowserSdkInfo(sdk);
}

function updateBrowserSdkInfo(sdk) {
    const pre = document.getElementById('browser-sdk-info');
    if (!pre) {
        return;
    }
    if (!sdk) {
        pre.textContent = 'not initialized';
        return;
    }
    pre.textContent = JSON.stringify(
        {
            version: sdk.version,
            baseUrl:
                sdkConfig.baseUrl ?? `(${sdkConfig.environment ?? 'sandbox'})`,
            methods: Object.keys(sdk).filter(
                (k) => typeof sdk[k] === 'function',
            ),
        },
        null,
        2,
    );
}

export function prefillPaymentId(result) {
    const id = result?.id;
    if (!id) {
        return;
    }
    for (const fieldId of [
        'charge-enc-payment-id',
        'charge-payment-id',
        'status-payment-id',
        'charge-state-payment-id',
        'googlepay-payment-id',
        'qr-payment-id',
        'refund-payment-id',
        'refund-list-payment-id',
    ]) {
        const el = document.getElementById(fieldId);
        if (el) {
            el.value = id;
        }
    }
    const attachIdEl = document.getElementById('browser-attach-payment-id');
    if (attachIdEl) {
        attachIdEl.value = id;
    }
    const attachSecretEl = document.getElementById(
        'browser-attach-payment-secret',
    );
    if (attachSecretEl) {
        attachSecretEl.value = result?.payment_secret ?? '';
    }
    updateBrowserBadge();
    state.pendingInstrument = null;
    document.getElementById('charge-instrument-info').textContent = '';
    document.getElementById('charge-token-fields').style.display = '';
}

/**
 * Drive a charge-state poll loop via a browser SDK `awaitChargeState` call,
 * writing intermediate states and the terminal result into `pre`.
 *
 * `awaitFn` should be a partially-applied SDK method:
 *   `(opts) => browserSdk.awaitChargeState(opts)`
 */
export async function pollChargeState(awaitFn, pre) {
    appendOutput(pre, '\n── polling charge state ──');
    try {
        await awaitFn({
            onStateChange: (state) => {
                if (state.state === 'SUCCEEDED' || state.state === 'FAILED') {
                    appendOutput(
                        pre,
                        `\n\n── ${state.state} ──\n${JSON.stringify(sanitizeBody(state), null, 2)}`,
                    );
                } else {
                    appendOutput(pre, `\n${state.state}`);
                }
            },
            onActionRequired: (url) => show3dsPrompt(pre, url),
        });
    } catch (err) {
        if (err?.errorCode === 'CHARGE_FAILED') {
            // terminal state already shown by onStateChange
        } else if (err?.errorCode === 'CHARGE_TIMEOUT') {
            appendOutput(
                pre,
                '\n\nPolling timed out — check charge state manually.',
            );
        } else {
            appendOutput(pre, `\n\n── onError ──\n${formatError(err)}`);
        }
    }
}

function prefillField(id, value) {
    const el = document.getElementById(id);
    if (el && value) {
        el.value = value;
    }
}

export function prefillBrowserCharge(encryptedPayload) {
    prefillField('bcharge-encrypted-payload', encryptedPayload);
}

export function prefillServerChargeEncrypted(encryptedPayload) {
    prefillField('charge-enc-payload', encryptedPayload);
}

export function prefillTokenize(encryptedPayload) {
    prefillField('tokenize-payload', encryptedPayload);
}

export function prefillCharge(paymentId, instrument) {
    state.pendingInstrument = instrument;
    if (paymentId) {
        document.getElementById('charge-payment-id').value = paymentId;
    }
    document.getElementById('charge-instrument-info').textContent =
        JSON.stringify(instrument, null, 2);
    document.getElementById('charge-token-fields').style.display = 'none';
}

/**
 * Route a freshly minted permanent card token into the tokenized-charge panel.
 *
 * The charge field takes `token` — the value charge requests accept — not
 * `card_id`, which only addresses the token in the cards endpoints. `token` is
 * redacted in the rendered output, so this prefill is the only way to get it
 * into the charge panel; the info line names the card_id instead of echoing it.
 *
 * A saved card token and a wallet instrument compete for the same panel, so
 * this clears any pending wallet instrument and reveals the token field again —
 * otherwise `runCharge()` would keep charging the stale instrument.
 */
export function prefillCardToken(card) {
    const token = card?.token;
    if (!token) {
        return;
    }
    state.pendingInstrument = null;
    document.getElementById('charge-card-token').value = token;
    document.getElementById('charge-token-fields').style.display = '';
    document.getElementById('charge-instrument-info').textContent =
        `Card token for card_id ${card.card_id} prefilled from sdk.tokenizeEncryptedCard().`;
}
