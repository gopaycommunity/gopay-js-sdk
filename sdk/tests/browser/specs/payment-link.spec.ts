import type { components } from '../../../src/types/generated.js';
import {
    expandAllSections,
    expect,
    parseOutput,
    test,
} from '../fixtures/fixtures.js';

type LinkDetails = components['schemas']['Link-Details'];

const LINK_KEYS = [
    'id',
    'url',
    'active',
    'reusable',
] as const satisfies ReadonlyArray<keyof LinkDetails>;

test('sdk.createPaymentLink() returns a shareable link, then reads and disables it', async ({
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

    // Create the link
    await page.click('[onclick="runCreatePaymentLink()"]');
    const createOutput = page.locator('#link-create-output');
    await expect(createOutput).not.toHaveText('—', { timeout: 15_000 });
    await expect(createOutput).not.toHaveText('Running…', { timeout: 15_000 });

    const createText = (await createOutput.textContent()) ?? '';
    expect(
        createText,
        'sdk.createPaymentLink() should not have returned an error',
    ).not.toMatch(/^── onError/);

    const link = parseOutput<LinkDetails>(createText);
    for (const key of LINK_KEYS) {
        expect(link, `key "${key}" should be present`).toHaveProperty(key);
    }
    expect(link.active).toBe(true);

    // The example renders the URL as a real anchor, since that is what the
    // merchant actually hands to the customer.
    await expect(
        page.locator('#link-create-output + [data-link-url] a'),
    ).toHaveAttribute('href', link.url);

    // Read it back — the id and goid are auto-filled by the create panel, so
    // this also covers that wiring.
    await page.click('[onclick="runGetPaymentLink()"]');
    const getOutput = page.locator('#link-get-output');
    await expect(getOutput).not.toHaveText('—', { timeout: 15_000 });
    await expect(getOutput).not.toHaveText('Running…', { timeout: 15_000 });

    const read = parseOutput<LinkDetails>(
        (await getOutput.textContent()) ?? '',
    );
    expect(read.id).toBe(link.id);
    expect(read.active).toBe(true);

    // Disable it. The panel reports the follow-up read, which is where the
    // "not a delete" behaviour shows: the link is still there, just inactive.
    await page.click('[onclick="runDisablePaymentLink()"]');
    const disableOutput = page.locator('#link-disable-output');
    await expect(disableOutput).not.toHaveText('—', { timeout: 15_000 });
    await expect(disableOutput).not.toHaveText('Running…', { timeout: 15_000 });

    const disabled = parseOutput<{ disabled: boolean; link: LinkDetails }>(
        (await disableOutput.textContent()) ?? '',
    );
    expect(disabled.disabled).toBe(true);
    expect(disabled.link.id).toBe(link.id);
    expect(disabled.link.active).toBe(false);
    expect(disabled.link.stop_reason).toBe('FROM_API');
});
