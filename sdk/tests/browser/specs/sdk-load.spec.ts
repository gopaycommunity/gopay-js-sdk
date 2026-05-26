import { expect, test } from '@playwright/test';

test('SDK loads and initialises GoPaySDK', async ({ page }) => {
    await page.goto('/');

    const badge = page.locator('#sdk-badge');
    await expect(badge).toHaveText('LOADED');
    await expect(badge).toHaveClass(/ok/);
});

test('SDK exposes expected modules and methods', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('#sdk-badge')).toHaveText('LOADED');

    const raw = await page.locator('#sdk-info').textContent();
    const info = JSON.parse(raw ?? '{}') as {
        methods: string[];
    };

    expect(info.methods).toContain('authenticate');
    expect(info.methods).toContain('createPayment');
    expect(info.methods).toContain('chargePayment');
    expect(info.methods).toContain('getGooglePayInfo');
    expect(info.methods).toContain('getApplePayInfo');
    expect(info.methods).toContain('startApplePaySession');
    // mountCardForm lives on the browser SDK (gopay-js-sdk-browser) after the
    // server/client split; the server SDK exposes tokenizeEncryptedCard instead.
    expect(info.methods).toContain('tokenizeEncryptedCard');
});
