import {
    createGoPayBrowserSDK,
    GoPayHTTPError,
    GoPaySDKError,
} from 'gopay-js-sdk-browser';
import { sdkConfig } from './sdk.js';

let _browserSdk = null;
let _attached = false;

// Keep in sync with gw-ui-cc-v4 manually — no shared package.
const SENSITIVE_KEYS = new Set([
    'card_number',
    'card_pan',
    'pan',
    'cardToken',
    'card_token',
    'token',
    'publishable_key',
    'cvv',
    'cvv2',
    'security_code',
    'expiry',
    'expiration',
    'exp_month',
    'exp_year',
    'account_number',
]);
const PAN_PATTERN = /^\d{16,}$/;

function sanitizeBody(value) {
    if (Array.isArray(value)) {
        return value.map(sanitizeBody);
    }
    if (value !== null && typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            out[k] = SENSITIVE_KEYS.has(k) ? '[REDACTED]' : sanitizeBody(v);
        }
        return out;
    }
    if (typeof value === 'string' && PAN_PATTERN.test(value)) {
        return '[REDACTED]';
    }
    return value;
}

function formatBrowserError(err) {
    if (err instanceof GoPayHTTPError) {
        return `[GoPayHTTPError] HTTP ${err.status}\n${JSON.stringify(sanitizeBody(err.body), null, 2)}`;
    }
    if (err instanceof GoPaySDKError) {
        return `[GoPaySDKError]${err.errorCode ? ` (${err.errorCode})` : ''} ${err.message}`;
    }
    if (err instanceof Error) {
        return `[${err.constructor.name}] ${err.message}`;
    }
    return String(err);
}

export function initBrowserSDK(publishableKey, clientId) {
    _browserSdk = createGoPayBrowserSDK({
        ...sdkConfig,
        publishableKey,
        clientId,
    });
    _attached = false;
}

export function getBrowserSDK() {
    return _browserSdk;
}

export function isSdkAttached() {
    return _attached;
}

export async function attachPaymentToSDK(paymentId, paymentSecret) {
    if (!_browserSdk) {
        return;
    }
    await _browserSdk.attachPayment({ paymentId, paymentSecret });
    _attached = true;
}

export async function runAttachPayment() {
    const pre = document.getElementById('battach-output');
    const paymentId = document
        .getElementById('browser-attach-payment-id')
        .value.trim();
    const paymentSecret = document
        .getElementById('browser-attach-payment-secret')
        .value.trim();

    if (!_browserSdk) {
        pre.textContent =
            'Error: Browser SDK not initialized.\nComplete Step 1 first.';
        return;
    }
    if (!paymentId || !paymentSecret) {
        pre.textContent =
            'Error: Payment ID and Payment Secret are required.\nRun payments.create() to auto-fill.';
        return;
    }

    pre.textContent = 'Attaching…';
    try {
        await attachPaymentToSDK(paymentId, paymentSecret);
        pre.textContent = `── attached ──\npaymentId: ${paymentId}`;
        const { updateBrowserBadge } = await import('./helpers.js');
        updateBrowserBadge();
    } catch (err) {
        pre.textContent = `── error ──\n${formatBrowserError(err)}`;
    }
}

export function requireAttachedSDK(pre) {
    if (!_browserSdk) {
        pre.textContent =
            'Error: Browser SDK not initialized.\nRun auth.getBrowserKeys() or click "Initialize Browser SDK" first.';
        return null;
    }
    if (!_attached) {
        pre.textContent =
            'Error: No payment attached.\nRun payments.create() first.';
        return null;
    }
    return _browserSdk;
}
