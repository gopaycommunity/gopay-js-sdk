import { expect, test } from '@playwright/test';
import type { components } from '../../sdk/src/types/generated.js';

type PaymentCreateResponse =
    components['responses']['Payment-Create-Response']['content']['application/json'];

const PAYMENT_KEYS = [
    'id',
    'state',
    'amount',
    'gw_url',
] as const satisfies ReadonlyArray<keyof PaymentCreateResponse>;

test('auth.issueClientToken() + auth.setClientToken() allows authenticated API calls without client credentials in browser', async ({
    page,
}) => {
    // Proxy all cross-origin requests through Playwright's Node.js fetch to
    // avoid CORS restrictions in the browser (mock server has no CORS headers).
    await page.route(
        (url) => url.hostname !== 'localhost',
        async (route) => route.fulfill({ response: await route.fetch() }),
    );

    await page.goto('/example/index.html');

    // Confirm the SDK loaded before interacting
    await expect(page.locator('#sdk-badge')).toHaveText('LOADED');

    // Authenticate the server SDK first (credentials are pre-filled by serve.js)
    await page.click('[onclick="runAuthenticate()"]');
    const authOutput = page.locator('#auth-output');
    await expect(authOutput).not.toHaveText('—', { timeout: 15_000 });
    await expect(authOutput).not.toHaveText('Running…', { timeout: 15_000 });
    expect(
        (await authOutput.textContent()) ?? '',
        'authenticate() should not have returned an error',
    ).not.toMatch(/^\[/);

    // Issue a client token using the server SDK, then run the browser flow
    await page.click('[onclick="runIssueClientToken()"]');
    const issueOutput = page.locator('#issue-client-token-output');
    await expect(issueOutput).not.toHaveText('—', { timeout: 15_000 });
    await expect(issueOutput).not.toHaveText('Running…', { timeout: 15_000 });
    expect(
        (await issueOutput.textContent()) ?? '',
        'issueClientToken() should not have returned an error',
    ).not.toMatch(/^\[/);

    await page.click('[onclick="runSetClientTokenFlow()"]');

    const output = page.locator('#set-client-token-output');
    await expect(output).not.toHaveText('—', { timeout: 15_000 });
    await expect(output).not.toHaveText('Running…', { timeout: 15_000 });

    const text = (await output.textContent()) ?? '';

    // The run() helper formats errors as "[ClassName] message".
    // Assert it is not an error before attempting to parse JSON.
    expect(
        text,
        'setClientToken() flow should not have returned an error',
    ).not.toMatch(/^\[/);

    const json = JSON.parse(text);

    for (const key of PAYMENT_KEYS) {
        expect(json, `key "${key}" should be present`).toHaveProperty(key);
    }
});
