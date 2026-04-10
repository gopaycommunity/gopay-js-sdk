import { expect, parseOutput, test } from '../fixtures/fixtures.js';

// JWT whose payload section (eyJzdWIiOiJBIn0=) decodes via atob() to {"sub":"A"}.
// Used so setClientToken() can extract the client_id without hitting the real API.
const MOCK_JWT = 'FAKEHEADER.eyJzdWIiOiJBIn0=.FAKESIG';

test('auth.issueClientToken() + auth.setClientToken() allows authenticated API calls without client credentials in browser', async ({
    page,
}) => {
    await page.goto('/');

    // Confirm the SDK loaded before interacting
    await expect(page.locator('#sdk-badge')).toHaveText('LOADED');

    // Authenticate the server SDK first (credentials are pre-filled by serve.js).
    // This is a real call to verify the credentials are valid.
    await page.click('[onclick="runAuthenticate()"]');
    const authOutput = page.locator('#auth-output');
    await expect(authOutput).not.toHaveText('—', { timeout: 15_000 });
    await expect(authOutput).not.toHaveText('Running…', { timeout: 15_000 });
    expect(
        (await authOutput.textContent()) ?? '',
        'authenticate() should not have returned an error',
    ).not.toMatch(/^── onError/);

    // After authenticate succeeds, stub issueClientToken() — same /oauth2/token
    // endpoint; can timeout under load.
    await page.route('**/oauth2/token', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                access_token: MOCK_JWT,
                refresh_token: 'MOCK_REFRESH_TOKEN',
                token_type: 'bearer',
                expires_in: 3600,
                refresh_expires_in: 86400,
            }),
        });
    });

    // Issue a client token using the server SDK (stubbed), then run the browser flow
    await page.click('[onclick="runIssueClientToken()"]');
    const issueOutput = page.locator('#issue-client-token-output');
    await expect(issueOutput).not.toHaveText('—', { timeout: 15_000 });
    await expect(issueOutput).not.toHaveText('Running…', { timeout: 15_000 });
    expect(
        (await issueOutput.textContent()) ?? '',
        'issueClientToken() should not have returned an error',
    ).not.toMatch(/^── onError/);

    // Browser flow: setClientToken() extracts client_id from the mock JWT's sub
    // claim and returns { authenticated: true }.
    await page.click('[onclick="runSetClientTokenFlow()"]');

    const output = page.locator('#set-client-token-output');
    await expect(output).not.toHaveText('—', { timeout: 15_000 });
    await expect(output).not.toHaveText('Running…', { timeout: 15_000 });

    const text = (await output.textContent()) ?? '';

    expect(
        text,
        'setClientToken() flow should not have returned an error',
    ).not.toMatch(/^── onError/);

    const json = parseOutput(text);
    expect(json).toEqual({ authenticated: true });
});
