import { expect, test } from './fixtures.js';

test('payments.getQRPaymentInfo() returns QR data and recipient info', async ({
    page,
}) => {
    await page.goto('/');
    await expect(page.locator('#sdk-badge')).toHaveText('LOADED');

    // Authenticate
    await page.click('[onclick="runAuthenticate()"]');
    const authOutput = page.locator('#auth-output');
    await expect(authOutput).not.toHaveText('—', { timeout: 15_000 });
    await expect(authOutput).not.toHaveText('Running…', { timeout: 15_000 });
    expect(
        (await authOutput.textContent()) ?? '',
        'authenticate() should not have returned an error',
    ).not.toMatch(/^\[/);

    // Create a payment first to get a valid payment ID
    await page.click('[onclick="runCreatePayment()"]');
    const createOutput = page.locator('#payment-create-output');
    await expect(createOutput).not.toHaveText('—', { timeout: 15_000 });
    await expect(createOutput).not.toHaveText('Running…', { timeout: 15_000 });
    const createText = (await createOutput.textContent()) ?? '';
    expect(
        createText,
        'payments.create() should not have returned an error',
    ).not.toMatch(/^\[/);
    const paymentId = JSON.parse(createText).id as string;

    // Fill the QR payment ID field (auto-filled by prefillPaymentId, but ensure)
    await page.fill('#qr-payment-id', paymentId);

    // Fetch QR info
    await page.click('[onclick="runQRPaymentInfo()"]');
    const output = page.locator('#qr-output');
    await expect(output).not.toHaveText('—', { timeout: 15_000 });
    await expect(output).not.toHaveText('Running…', { timeout: 15_000 });

    const text = (await output.textContent()) ?? '';
    expect(
        text,
        'getQRPaymentInfo() should not have returned an error',
    ).not.toMatch(/^\[/);

    const json = JSON.parse(text);
    // Response contains qr_code with currency-specific fields (spayd for CZK)
    expect(json).toHaveProperty('qr_code');
    const qrCode = json.qr_code as Record<string, string>;
    const nonEmpty = Object.values(qrCode).filter((v) => v?.length > 0);
    expect(
        nonEmpty.length,
        'qr_code should have at least one non-empty field',
    ).toBeGreaterThan(0);
});
