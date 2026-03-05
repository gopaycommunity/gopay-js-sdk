import { expect, test } from '@playwright/test';

test('IIFE bundle loads GoPaySDK on window', async ({ page }) => {
    await page.goto('/example/index.html');

    const badge = page.locator('#sdk-badge');
    await expect(badge).toHaveText('LOADED');
    await expect(badge).toHaveClass(/ok/);
});

test('SDK exposes expected modules and methods', async ({ page }) => {
    await page.goto('/example/index.html');

    const raw = await page.locator('#sdk-info').textContent();
    const info = JSON.parse(raw ?? '{}') as {
        modules: Array<{ name: string; methods: string[] }>;
    };

    const modules = Object.fromEntries(
        info.modules.map(({ name, methods }) => [name, methods]),
    );

    expect(modules.auth).toContain('authenticate');
    expect(modules.payments).toContain('create');
    expect(modules.payments).toContain('charge');
    expect(modules.payments).toContain('getGooglePayInfo');
    expect(modules.payments).toContain('getApplePayInfo');
    expect(modules.payments).toContain('validateApplePayMerchant');
    expect(modules.encryption).toContain('fetchPublicKey');
    expect(modules.cards).toContain('createToken');
});
