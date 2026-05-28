import {
    expandAllSections,
    expect,
    parseOutput,
    test,
} from '../fixtures/fixtures.js';

// Tests the full mock Apple Pay flow via the Browser SDK using the polyfill's
// MockApplePaySession. No real Apple device or Safari required — the mock
// session stubs merchant validation and payment authorization with
// fake-but-plausible token data.
//
// All payment-related API calls are stubbed so the test is deterministic and
// does not depend on the GoPay sandbox response time or test-card availability.
// The core behaviour under test is the browser SDK's startApplePaySession() wiring:
//   onvalidatemerchant → validateApplePayMerchant → completeMerchantValidation
//   onpaymentauthorized → chargePayment()

const MOCK_PAYMENT_ID = 'MOCK_PAY_APPLE_TEST';

test('mock Apple Pay flow completes merchant validation and authorises payment', async ({
    page,
}) => {
    // Stub payment creation — the test only needs a payment ID + secret.
    await page.route('**/eshops/*/payments', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                id: MOCK_PAYMENT_ID,
                payment_secret: 'MOCK_SECRET',
                state: 'CREATED',
                amount: 100,
                currency: 'CZK',
            }),
        });
    });

    // Stub the payment_credentials token exchange used by attachPayment().
    // Pass through client_credentials requests so authenticate() still works.
    await page.route('**/oauth2/token', async (route) => {
        if (
            !(route.request().postData() ?? '').includes('payment_credentials')
        ) {
            await route.fallback();
            return;
        }
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                access_token: 'mock-payment-token',
                token_type: 'bearer',
                expires_in: 900,
                scope: 'payment:read payment:charge',
            }),
        });
    });

    // Stub Apple Pay info — the polyfill ignores the values but the SDK needs
    // the response to render the mock button and call applePayBeginSession.
    await page.route('**/apple-pay/info', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                applepayVersion: 6,
                merchantIdentifier: 'MOCK_MERCHANT',
                applePayPaymentRequest: {
                    merchantCapabilities: ['supports3DS'],
                    supportedNetworks: ['visa'],
                    countryCode: 'CZ',
                    currencyCode: 'CZK',
                    requiredBillingContactFields: [],
                    requiredShippingContactFields: [],
                    total: {
                        label: 'GoPay Test',
                        amount: '1.00',
                        type: 'final',
                    },
                },
            }),
        });
    });

    // Stub merchant validation — the polyfill passes the response directly to
    // completeMerchantValidation(); the content is opaque to the client side.
    await page.route('**/apple-pay/validate', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                epochTimestamp: 1544566460679,
                expiresAt: 1541673444667,
                merchantSessionIdentifier: 'MOCK_MSI',
                nonce: 'deadbeef',
                merchantIdentifier: 'MOCK_MERCHANT',
                domainName: 'localhost',
                displayName: 'GoPay Test',
                signature: 'MOCK_SIG',
            }),
        });
    });

    // Stub the charge call — the polyfill produces a fake payment token that
    // the real sandbox would reject; stub to return SUCCEEDED to skip polling.
    await page.route('**/payments/*/charge', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ id: 'MOCK_CHARGE_123', state: 'SUCCEEDED' }),
        });
    });

    await page.goto('/');
    await expect(page.locator('#sdk-badge')).toHaveText('LOADED');
    await expandAllSections(page);

    // Initialize browser SDK
    const pubKeyInput = page.locator('#cardpay-publishable-key');
    if (!(await pubKeyInput.inputValue())) {
        await pubKeyInput.fill('test-key');
    }
    await page.click('[onclick="runInitBrowserSDK()"]');
    await expect(page.locator('#browser-sdk-badge')).not.toHaveText(
        'not initialized',
        { timeout: 5_000 },
    );

    // Authenticate (server SDK — needed for createPayment)
    await page.click('[onclick="runAuthenticate()"]');
    const authOutput = page.locator('#auth-output');
    await expect(authOutput).not.toHaveText('—', { timeout: 15_000 });
    await expect(authOutput).not.toHaveText('Running…', { timeout: 15_000 });
    expect(
        (await authOutput.textContent()) ?? '',
        'authenticate() should not have returned an error',
    ).not.toMatch(/^── onError/);

    // Create a payment (stubbed) — auto-fills the browser attach fields
    await page.click('[onclick="runCreatePayment()"]');
    const createOutput = page.locator('#payment-create-output');
    await expect(createOutput).not.toHaveText('—', { timeout: 15_000 });
    await expect(createOutput).not.toHaveText('Running…', { timeout: 15_000 });
    const createText = (await createOutput.textContent()) ?? '';
    expect(
        createText,
        'payments.create() should not have returned an error',
    ).not.toMatch(/^── onError/);
    expect(parseOutput<{ id: string }>(createText).id).toBe(MOCK_PAYMENT_ID);

    // Attach the payment to the browser SDK (uses stubbed payment_credentials token)
    await page.click('[onclick="runAttachPayment()"]');
    const attachOutput = page.locator('#battach-output');
    await expect(attachOutput).toContainText('── attached ──', {
        timeout: 15_000,
    });

    // Load Apple Pay config (step 1 — stubbed, renders mock button)
    await page.click('[onclick="browserApplePayLoadInfo()"]');
    const appleOutput = page.locator('#bapplepay-output');
    await expect(appleOutput).not.toHaveText('── fetching Apple Pay info ──', {
        timeout: 15_000,
    });
    expect(
        (await appleOutput.textContent()) ?? '',
        'getApplePayInfo() should not have returned an error',
    ).not.toMatch(/^── onError/);

    // The mock button should now be rendered
    await expect(page.locator('#bapplepay-mock-btn')).toBeVisible({
        timeout: 5_000,
    });

    // Click the mock button — triggers MockApplePaySession, shows modal
    await page.click('#bapplepay-mock-btn');

    // Wait for merchant validation to complete (stubbed → Pay button enables immediately)
    await expect(page.locator('#ap-polyfill-pay')).toBeEnabled({
        timeout: 15_000,
    });

    // Confirm payment in the polyfill modal
    await page.click('#ap-polyfill-pay');

    // Wait for the charge result to appear in the Apple Pay output (charge is stubbed)
    await expect(appleOutput).toContainText('── onSuccess (charge) ──', {
        timeout: 15_000,
    });

    const fullText = (await appleOutput.textContent()) ?? '';
    const chargeMatch = fullText.match(
        /── onSuccess \(charge\) ──\n([\s\S]+?)(?:\n\n|$)/,
    );
    expect(chargeMatch, 'charge result JSON should be present').toBeTruthy();
    const charge = JSON.parse(chargeMatch?.[1] ?? 'null');
    expect(charge).toHaveProperty('id');
    expect(charge).toHaveProperty('state');
});
