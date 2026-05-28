import { initBrowserSDK } from './browser-sdk.js';
import { run, updateBrowserBadge } from './helpers.js';
import { sdk } from './sdk.js';

const authBadge = document.getElementById('auth-badge');

export function updateAuthBadge() {
    const ok = sdk.isAuthenticated();
    authBadge.textContent = ok ? 'authenticated' : 'not authenticated';
    authBadge.style.background = ok ? '#d4edda' : '#e2e3e5';
    authBadge.style.color = ok ? '#155724' : '#383d41';
}

function getSelectedScopes() {
    const el = document.getElementById('auth-scope');
    return (
        Array.from(el.selectedOptions)
            .map((o) => o.value)
            .join(' ') || 'payment:write'
    );
}

export function runAuthenticate() {
    const client_id = document.getElementById('auth-client-id').value.trim();
    const client_secret = document
        .getElementById('auth-client-secret')
        .value.trim();
    const publishable_key = document
        .getElementById('auth-publishable-key')
        .value.trim();
    const scope = getSelectedScopes();
    run(
        'auth-output',
        async () => {
            if (publishable_key) {
                sdk.setPublishableKey(publishable_key);
            }
            await sdk.authenticate({
                grant_type: 'client_credentials',
                client_id,
                client_secret,
                scope,
            });
            return { authenticated: true, scope };
        },
        () => updateAuthBadge(),
    );
}

export function runLogout() {
    sdk.logout();
    updateAuthBadge();
    document.getElementById('auth-output').textContent = 'Logged out.';
}

export function runGetBrowserKeys() {
    run('get-browser-keys-output', async () => {
        const keys = sdk.getBrowserKeys();
        document.getElementById('cardpay-publishable-key').value =
            keys.publishable_key;
        document.getElementById('cardpay-client-id').value = keys.client_id;
        initBrowserSDK(keys.publishable_key, keys.client_id);
        updateBrowserBadge();
        return keys;
    });
}
