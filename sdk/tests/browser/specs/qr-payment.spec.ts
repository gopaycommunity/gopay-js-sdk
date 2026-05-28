import {
    expandAllSections,
    expect,
    parseOutput,
    test,
} from '../fixtures/fixtures.js';

const MOCK_QR_B64 = 'AAAA'; // minimal non-empty base64 placeholder

test('payments.getQRPaymentInfo() returns QR data and recipient info', async ({
    page,
}) => {
    // Stub payment creation and the QR info fetch so the test does not depend
    // on sandbox response time. authenticate() remains a real call.
    await page.route('**/eshops/*/payments', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                id: 'MOCK_QR_PAY',
                state: 'CREATED',
                amount: 100,
            }),
        });
    });
    await page.route('**/qr-payment/info**', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                amount: 100,
                currency: 'CZK',
                qr_code: { spayd: MOCK_QR_B64 },
            }),
        });
    });

    await page.goto('/');
    await expect(page.locator('#sdk-badge')).toHaveText('LOADED');
    await expandAllSections(page);

    // Authenticate (real call — verifies credentials)
    await page.click('[onclick="runAuthenticate()"]');
    const authOutput = page.locator('#auth-output');
    await expect(authOutput).not.toHaveText('—', { timeout: 15_000 });
    await expect(authOutput).not.toHaveText('Running…', { timeout: 15_000 });
    expect(
        (await authOutput.textContent()) ?? '',
        'authenticate() should not have returned an error',
    ).not.toMatch(/^── onError/);

    // Create a payment (stubbed) to obtain a payment ID
    await page.click('[onclick="runCreatePayment()"]');
    const createOutput = page.locator('#payment-create-output');
    await expect(createOutput).not.toHaveText('—', { timeout: 15_000 });
    await expect(createOutput).not.toHaveText('Running…', { timeout: 15_000 });
    const createText = (await createOutput.textContent()) ?? '';
    expect(
        createText,
        'payments.create() should not have returned an error',
    ).not.toMatch(/^── onError/);
    const paymentId = parseOutput<{ id: string }>(createText).id;

    // Fill the QR payment ID field (auto-filled by prefillPaymentId, but ensure)
    await page.fill('#qr-payment-id', paymentId);

    // Fetch QR info (stubbed)
    await page.click('[onclick="runQRPaymentInfo()"]');
    const output = page.locator('#qr-output');
    await expect(output).not.toHaveText('—', { timeout: 15_000 });
    await expect(output).not.toHaveText('Running…', { timeout: 15_000 });

    const text = (await output.textContent()) ?? '';
    expect(
        text,
        'getQRPaymentInfo() should not have returned an error',
    ).not.toMatch(/^── onError/);

    const json = parseOutput(text);
    // Response contains qr_code with currency-specific fields (spayd for CZK)
    expect(json).toHaveProperty('qr_code');
    const qrCode = json.qr_code as Record<string, string>;
    const nonEmpty = Object.values(qrCode).filter((v) => v?.length > 0);
    expect(
        nonEmpty.length,
        'qr_code should have at least one non-empty field',
    ).toBeGreaterThan(0);
});
