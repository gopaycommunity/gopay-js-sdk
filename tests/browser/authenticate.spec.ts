import { expect, test } from '@playwright/test';
import type { components } from '../../sdk/src/types/generated.js';

type TokenPair =
    components['responses']['Token-Pair-Response']['content']['application/json'];

// `satisfies` validates the keys against the generated type at compile time;
// it is erased at runtime so there is no dependency on the SDK source.
const TOKEN_KEYS = [
    'token_type',
    'access_token',
    'refresh_token',
    'scope',
    'expires_in',
    'refresh_expires_in',
] as const satisfies ReadonlyArray<keyof TokenPair>;

test('auth.authenticate() returns a token response with all expected keys', async ({
    page,
}) => {
    // Proxy all cross-origin requests through Playwright's Node.js fetch to
    // avoid CORS restrictions in the browser (mock server has no CORS headers).
    await page.route(
        (url) => url.hostname !== 'localhost',
        async (route) => route.fulfill({ response: await route.fetch() }),
    );

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

    for (const key of TOKEN_KEYS) {
        expect(json, `key "${key}" should be present`).toHaveProperty(key);
        expect(String(json[key]), `"${key}" should be non-empty`).not.toBe('');
    }
});
