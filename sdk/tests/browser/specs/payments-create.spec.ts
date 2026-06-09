import type { components } from '../../../src/types/generated.js';
import {
    expandAllSections,
    expect,
    parseOutput,
    test,
} from '../fixtures/fixtures.js';

type PaymentCreateResponse =
    components['responses']['Payment-Create-Response']['content']['application/json'];

const PAYMENT_KEYS = ['id', 'state', 'amount'] as const satisfies ReadonlyArray<
    keyof PaymentCreateResponse
>;

test('sdk.createPayment() returns a payment with all expected keys', async ({
    page,
}) => {
    await page.goto('/');
    await expect(page.locator('#sdk-badge')).toHaveText('LOADED');
    await expandAllSections(page);

    // Authenticate first
    await page.click('[onclick="runAuthenticate()"]');
    const authOutput = page.locator('#auth-output');
    await expect(authOutput).not.toHaveText('—', { timeout: 15_000 });
    await expect(authOutput).not.toHaveText('Running…', { timeout: 15_000 });
    expect(
        (await authOutput.textContent()) ?? '',
        'authenticate() should not have returned an error',
    ).not.toMatch(/^── onError/);

    // Create payment
    await page.click('[onclick="runCreatePayment()"]');
    const output = page.locator('#payment-create-output');
    await expect(output).not.toHaveText('—', { timeout: 15_000 });
    await expect(output).not.toHaveText('Running…', { timeout: 15_000 });

    const text = (await output.textContent()) ?? '';
    expect(
        text,
        'sdk.createPayment() should not have returned an error',
    ).not.toMatch(/^── onError/);

    const json = parseOutput(text);
    for (const key of PAYMENT_KEYS) {
        expect(json, `key "${key}" should be present`).toHaveProperty(key);
    }
});
