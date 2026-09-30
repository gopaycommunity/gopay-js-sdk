import { createGoPayBrowserSDK } from '../../src/index.js';

/**
 * Harness for the browser-SDK E2E suites.
 *
 * The browser SDK never sees the merchant credentials: it authenticates with a
 * shareable key and a payment-scoped secret. So the harness does what a merchant
 * backend does - exchange client credentials for a token and create a payment -
 * over plain fetch, then hands the resulting id and secret to the SDK. Raw fetch
 * rather than the server SDK on purpose: browser-sdk does not depend on it, and a
 * test harness is a poor reason to add the dependency.
 */
type BrowserSdk = ReturnType<typeof createGoPayBrowserSDK>;

export type AttachedPayment = { sdk: BrowserSdk; paymentId: string };

/** Hosts the repo declares as production; these suites create payments. */
const PRODUCTION_HOSTS = ['gate.gopay.com', 'secure.gopay.com', 'lx.gopay.com'];

function required(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}

function gatewayBaseUrl(): string {
    const raw = required('GOPAY_PAYMENTS_V4_BASE_URL').replace(/\/+$/, '');
    // By parsed host, not by substring: `https://%67ate.gopay.com` and
    // `https://gate.gopay.com.` both reach production while containing neither.
    const host = new URL(raw).hostname.toLowerCase().replace(/\.$/, '');
    if (PRODUCTION_HOSTS.some((p) => host === p || host.endsWith(`.${p}`))) {
        throw new Error(
            `These E2E tests create payments and must not target production. GOPAY_PAYMENTS_V4_BASE_URL resolves to host '${host}'.`,
        );
    }
    return raw;
}

async function asJson(response: Response, what: string): Promise<unknown> {
    if (!response.ok) {
        const body = await response.text();
        throw new Error(
            `${what} failed with HTTP ${response.status}: ${body.slice(0, 300)}`,
        );
    }
    return response.json();
}

/** Create a payment the way a merchant backend would, and attach the SDK to it. */
export async function attachedBrowserSdk(): Promise<AttachedPayment> {
    const base = gatewayBaseUrl();
    const clientId = required('GOPAY_PAYMENTS_V4_CLIENT_ID');
    const clientSecret = required('GOPAY_PAYMENTS_V4_CLIENT_SECRET');
    const goid = required('GOPAY_PAYMENTS_V4_GOID');
    const shareableKey = required('GOPAY_PAYMENTS_V4_SHAREABLE_KEY');

    const credentials = btoa(`${clientId}:${clientSecret}`);
    const token = (await asJson(
        await fetch(`${base}/oauth2/token`, {
            method: 'POST',
            headers: {
                Authorization: `Basic ${credentials}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                grant_type: 'client_credentials',
                scope: 'payment:write payment:read',
            }),
        }),
        'Token exchange',
    )) as { access_token: string };

    const payment = (await asJson(
        await fetch(`${base}/eshops/${goid}/payments`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token.access_token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                amount: 100,
                currency: 'CZK',
                order_number: `browser-e2e-${Date.now()}`,
                customer: { email: 'john.doe@example.com' },
                callback: {
                    return_url: 'https://example.com/return',
                    notification_url: 'https://example.com/notify',
                },
            }),
        }),
        'Payment create',
    )) as { id: string; payment_secret: string };

    const sdk = createGoPayBrowserSDK({
        baseUrl: base,
        shareableKey,
        clientId,
    });
    await sdk.attachPayment({
        paymentId: String(payment.id),
        paymentSecret: payment.payment_secret,
    });
    return { sdk, paymentId: String(payment.id) };
}

/** An SDK with no payment attached, for the guards that must fire before any call. */
export function unattachedBrowserSdk(): BrowserSdk {
    return createGoPayBrowserSDK({
        baseUrl: gatewayBaseUrl(),
        shareableKey: required('GOPAY_PAYMENTS_V4_SHAREABLE_KEY'),
        clientId: required('GOPAY_PAYMENTS_V4_CLIENT_ID'),
    });
}
