import { expect, test } from '@playwright/test';

// Tests the full mock Apple Pay flow using the polyfill's MockApplePaySession.
// No real Apple device or Safari required — the mock session stubs merchant
// validation and payment authorization with fake-but-plausible token data.
test('mock Apple Pay flow completes merchant validation and authorises payment', async ({
    page,
}) => {
    await page.route(
        (url) => url.hostname !== 'localhost',
        async (route) => route.fulfill({ response: await route.fetch() }),
    );

    await page.goto('/');
    await expect(page.locator('#sdk-badge')).toHaveText('LOADED');

    // Authenticate
    await page.click('[onclick="runAuthenticate()"]');
    const authOutput = page.locator('#auth-output');
    await expect(authOutput).not.toHaveText('—', { timeout: 15_000 });
    await expect(authOutput).not.toHaveText('Running…', { timeout: 15_000 });
    expect(
        (await authOutput.textContent()) ?? '',
        'authenticate() should not have returned an error',
    ).not.toMatch(/^\[/);

    // Create a payment
    await page.click('[onclick="runCreatePayment()"]');
    const createOutput = page.locator('#payment-create-output');
    await expect(createOutput).not.toHaveText('—', { timeout: 15_000 });
    await expect(createOutput).not.toHaveText('Running…', { timeout: 15_000 });
    const createText = (await createOutput.textContent()) ?? '';
    expect(
        createText,
        'payments.create() should not have returned an error',
    ).not.toMatch(/^\[/);
    const paymentId = JSON.parse(createText).id as string;

    // Fill in the payment ID for Apple Pay
    await page.fill('#applepay-payment-id', paymentId);

    // Load Apple Pay config (step 1 — fetches from API and renders mock button)
    await page.click('[onclick="applePayLoadInfo()"]');
    const appleOutput = page.locator('#applepay-output');
    await expect(appleOutput).not.toHaveText(
        'Step 1: Fetching Apple Pay info…',
        { timeout: 15_000 },
    );
    expect(
        (await appleOutput.textContent()) ?? '',
        'getApplePayInfo() should not have returned an error',
    ).not.toMatch(/^\[Step 1 failed\]/);

    // The mock button should now be rendered
    await expect(page.locator('#applepay-mock-btn')).toBeVisible({
        timeout: 5_000,
    });

    // Click the mock button — triggers MockApplePaySession, shows modal
    await page.click('#applepay-mock-btn');

    // Wait for merchant validation to complete (Pay button becomes enabled)
    await expect(page.locator('#ap-polyfill-pay')).toBeEnabled({
        timeout: 15_000,
    });

    // Confirm payment in the polyfill modal
    await page.click('#ap-polyfill-pay');

    // Wait for the charge result to appear in the Apple Pay output
    await expect(appleOutput).toContainText('Charge result:', {
        timeout: 15_000,
    });

    const fullText = (await appleOutput.textContent()) ?? '';
    // Extract the charge JSON block after "Charge result:"
    const chargeMatch = fullText.match(/Charge result:\n([\s\S]+?)(?:\n\n|$)/);
    expect(chargeMatch, 'charge result JSON should be present').toBeTruthy();
    const charge = JSON.parse(chargeMatch?.[1] ?? 'null');
    expect(charge).toHaveProperty('id');
    expect(charge).toHaveProperty('state');
});
