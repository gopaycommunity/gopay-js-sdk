import { expect, test } from './fixtures.js';

test('auth.logout() clears authenticated state', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#sdk-badge')).toHaveText('LOADED');

    // Authenticate first
    await page.click('[onclick="runAuthenticate()"]');
    const authOutput = page.locator('#auth-output');
    await expect(authOutput).not.toHaveText('—', { timeout: 15_000 });
    await expect(authOutput).not.toHaveText('Running…', { timeout: 15_000 });
    expect(
        (await authOutput.textContent()) ?? '',
        'authenticate() should not have returned an error',
    ).not.toMatch(/^\[/);

    // Verify authenticated badge
    await expect(page.locator('#auth-badge')).toHaveText('authenticated');

    // Logout
    await page.click('[onclick="runLogout()"]');

    // Badge should revert and output should say "Logged out."
    await expect(page.locator('#auth-badge')).toHaveText('not authenticated');
    await expect(authOutput).toHaveText('Logged out.');
});
