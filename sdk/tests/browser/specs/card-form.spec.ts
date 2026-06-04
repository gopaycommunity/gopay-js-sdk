import { expandAllSections, expect, test } from '../fixtures/fixtures.js';

test('cards.mountCardForm() mounts iframe and the container becomes visible', async ({
    page,
}) => {
    await page.goto('/');
    await expect(page.locator('#sdk-badge')).toHaveText('LOADED');
    await expandAllSections(page);

    // Authenticate and create a payment to get a payment ID
    await page.click('[onclick="runAuthenticate()"]');
    const authOutput = page.locator('#auth-output');
    await expect(authOutput).not.toHaveText('—', { timeout: 15_000 });
    await expect(authOutput).not.toHaveText('Running…', { timeout: 15_000 });
    expect(
        (await authOutput.textContent()) ?? '',
        'authenticate() should not have returned an error',
    ).not.toMatch(/^── onError/);

    // Initialize the browser SDK before creating the payment.
    // The shareable key field is pre-filled from GP_GW_JS_SDK_SHAREABLE_KEY when
    // that env var is set; fall back to a mock value so the test is self-contained.
    const pubKeyInput = page.locator('#cardpay-shareable-key');
    if (!(await pubKeyInput.inputValue())) {
        await pubKeyInput.fill('test-key');
    }
    await page.click('[onclick="runInitBrowserSDK()"]');
    await expect(page.locator('#browser-sdk-badge')).not.toHaveText(
        'not initialized',
        { timeout: 5_000 },
    );

    await page.click('[onclick="runCreatePayment()"]');
    const createOutput = page.locator('#payment-create-output');
    await expect(createOutput).not.toHaveText('—', { timeout: 15_000 });
    await expect(createOutput).not.toHaveText('Running…', { timeout: 15_000 });
    expect(
        (await createOutput.textContent()) ?? '',
        'payments.create() should not have returned an error',
    ).not.toMatch(/^── onError/);

    // The card iframe container starts hidden
    const container = page.locator('#cardpay-iframe-container');
    await expect(container).not.toBeVisible();

    // Open the card form — should mount the iframe and show the container
    await page.click('[onclick="cardPayOpenIframe()"]');

    // Container should become visible (iframe mounted)
    await expect(container).toBeVisible({ timeout: 10_000 });

    // The iframe element should exist inside the container
    const iframe = container.locator('iframe');
    await expect(iframe).toBeAttached({ timeout: 10_000 });

    // Output should show the "waiting" message
    await expect(page.locator('#cardpay-output')).toContainText(
        'Waiting for card confirmation in iframe',
    );
});
