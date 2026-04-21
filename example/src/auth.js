// Auth flows
// ---------
// GoPay supports two authentication patterns:
//
// 1. Server-side (client_credentials): call sdk.authenticate() with your client_id +
//    client_secret. Store the resulting tokens on your server — never expose secrets to the browser.
//
// 2. Browser client: call sdk.issueClientToken() from your server (requires a server-side token
//    first), then pass the returned ClientToken to the browser and call sdk.setClientToken().
//    The browser SDK can then make payment calls directly without ever seeing your secret.

import { createGoPaySDK } from 'gopay-js-sdk';
import { run, state } from './helpers.js';
import { sdk, sdkConfig } from './sdk.js';

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
            .join(' ') || 'payment:create'
    );
}

function getSelectedBrowserScopes() {
    const el = document.getElementById('issue-client-token-scope');
    return (
        Array.from(el.selectedOptions)
            .map((o) => o.value)
            .join(' ') || 'payment:create'
    );
}

// Server-side auth — call once at startup or before any server-initiated payment.
// Scope controls which APIs the token can access; 'payment:create' is the minimum.
// IMPORTANT: in production this call must happen server-side only. Never expose
// client_secret or the resulting tokens to the browser.
// Example:
//   await sdk.authenticate({ grant_type: 'client_credentials', client_id, client_secret, scope: 'payment:create' });
export function runAuthenticate() {
    const client_id = document.getElementById('auth-client-id').value.trim();
    const client_secret = document
        .getElementById('auth-client-secret')
        .value.trim();
    const scope = getSelectedScopes();
    run(
        'auth-output',
        async () => {
            await sdk.authenticate({
                grant_type: 'client_credentials',
                client_id,
                client_secret,
                scope,
            });
            // authenticate() returns void — tokens are stored internally only
            // and never exposed to callers.
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

// Issue a short-lived browser token from your server (requires a valid server-side token).
// Returns { access_token, refresh_token, expires_in, refresh_expires_in }.
// Pass both tokens to the browser; the browser SDK uses them to authenticate API calls.
export function runIssueClientToken() {
    const scope = getSelectedBrowserScopes();
    run('issue-client-token-output', async () => {
        const token = await sdk.issueClientToken(scope || undefined);
        state.lastClientToken = token;
        document.getElementById('set-client-token-access').value =
            token.access_token;
        document.getElementById('set-client-token-refresh').value =
            token.refresh_token;
        return token;
    });
}

// Browser client demo: create a separate SDK instance and seed it with the browser token.
// In a real app, your server delivers the tokens (e.g. via a /session endpoint or inline HTML),
// and the browser calls sdk.setClientToken(token) once on page load.
// After setClientToken(), sdk.isAuthenticated() returns true and payment calls will work.
export function runSetClientTokenFlow() {
    const accessToken = document
        .getElementById('set-client-token-access')
        .value.trim();
    const refreshToken = document
        .getElementById('set-client-token-refresh')
        .value.trim();

    run('set-client-token-output', async () => {
        const browserSdk = createGoPaySDK(sdkConfig);
        // Use full ClientToken if available (preserves expires_in from server response),
        // otherwise fall back to defaults so manually pasted tokens still work.
        const clientToken =
            state.lastClientToken?.access_token === accessToken &&
            state.lastClientToken
                ? state.lastClientToken
                : {
                      access_token: accessToken,
                      refresh_token: refreshToken,
                      expires_in: 900,
                      refresh_expires_in: 86400,
                  };
        browserSdk.setClientToken(clientToken);
        updateAuthBadge();
        return { authenticated: browserSdk.isAuthenticated() };
    });
}
