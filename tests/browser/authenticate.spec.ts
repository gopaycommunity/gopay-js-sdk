import { expect, test } from './fixtures.js';

test('auth.authenticate() authenticates the SDK without exposing tokens', async ({
    page,
}) => {
    await page.goto('/');

    // Confirm the SDK loaded before interacting
    await expect(page.locator('#sdk-badge')).toHaveText('LOADED');

    await page.click('[onclick="runAuthenticate()"]');

    // Wait until the output is no longer the placeholder or the loading state
    const output = page.locator('#auth-output');
    await expect(output).not.toHaveText('—', { timeout: 15_000 });
    await expect(output).not.toHaveText('Running…', { timeout: 15_000 });

    const text = (await output.textContent()) ?? '';

    // The run() helper formats errors as "[ClassName] message".
    // Assert it is not an error before attempting to parse, so the failure
    // message shows the actual SDK error rather than a JSON SyntaxError.
    expect(
        text,
        'authenticate() should not have returned an error',
    ).not.toMatch(/^\[/);

    const json = JSON.parse(text);

    // authenticate() returns void — tokens are stored internally and must never
    // be exposed. The demo confirms success with a non-sensitive summary only.
    expect(json, 'should confirm authentication succeeded').toHaveProperty(
        'authenticated',
        true,
    );
    expect(json, 'should echo back the requested scope').toHaveProperty(
        'scope',
    );

    // Verify no token values leaked into the output
    expect(text).not.toContain('access_token');
    expect(text).not.toContain('refresh_token');

    // Verify the auth badge reflects the authenticated state
    await expect(page.locator('#auth-badge')).toHaveText('authenticated');
});
