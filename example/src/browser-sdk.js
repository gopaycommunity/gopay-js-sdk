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
    if (Array.isArray(value)) return value.map(sanitizeBody);
    if (value !== null && typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            out[k] = SENSITIVE_KEYS.has(k) ? '[REDACTED]' : sanitizeBody(v);
        }
        return out;
    }
    if (typeof value === 'string' && PAN_PATTERN.test(value))
        return '[REDACTED]';
    return value;
}

function appendBrowserError(err) {
    const log = document.getElementById('browser-sdk-log');
    if (!log) return;
    const ts = new Date().toLocaleTimeString();
    let text;
    if (err instanceof GoPayHTTPError) {
        text = `[GoPayHTTPError] HTTP ${err.status}\n${JSON.stringify(sanitizeBody(err.body), null, 2)}`;
    } else if (err instanceof GoPaySDKError) {
        text = `[GoPaySDKError]${err.errorCode ? ` (${err.errorCode})` : ''} ${err.message}`;
    } else {
        text = String(err);
    }
    log.textContent += `${log.textContent ? '\n' : ''}[${ts}] ${text}`;
    log.hidden = false;
}

export function initBrowserSDK(publishableKey, clientId) {
    const log = document.getElementById('browser-sdk-log');
    if (log) {
        log.textContent = '';
        log.hidden = true;
    }
    _browserSdk = createGoPayBrowserSDK({
        ...sdkConfig,
        publishableKey,
        clientId,
        onError: appendBrowserError,
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
    if (!_browserSdk) return;
    await _browserSdk.attachPayment({ paymentId, paymentSecret });
    _attached = true;
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
