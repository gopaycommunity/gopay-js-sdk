import { expect, test } from '@playwright/test';

test('SDK loads and initialises GoPaySDK', async ({ page }) => {
    await page.goto('/');

    const badge = page.locator('#sdk-badge');
    await expect(badge).toHaveText('LOADED');
    await expect(badge).toHaveClass(/ok/);
});

test('SDK exposes expected modules and methods', async ({ page }) => {
    await page.goto('/');

    const raw = await page.locator('#sdk-info').textContent();
    const info = JSON.parse(raw ?? '{}') as {
        modules: Array<{ name: string; methods: string[] }>;
    };

    const modules = Object.fromEntries(
        info.modules.map(({ name, methods }) => [name, methods]),
    );

    expect(modules.auth).toContain('authenticate');
    expect(modules.auth).toContain('issueClientToken');
    expect(modules.auth).toContain('setClientToken');
    expect(modules.payments).toContain('create');
    expect(modules.payments).toContain('charge');
    expect(modules.payments).toContain('getGooglePayInfo');
    expect(modules.payments).toContain('getApplePayInfo');
    expect(modules.payments).toContain('startApplePaySession');
    expect(modules.cards).toContain('createToken');
});
