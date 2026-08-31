import { expandAllSections, expect, test } from '../fixtures/fixtures.js';

/**
 * The output panels are capped and scrolled, and they follow their newest line
 * unless the reader has scrolled up. Everything here is DOM behaviour — the
 * content is written straight into the panel, so no call reaches the API.
 */

const LONG = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n');

test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#sdk-badge')).toHaveText('LOADED');
    await expandAllSections(page);
});

test('a long payload is capped rather than pushing the page down', async ({
    page,
}) => {
    const output = page.locator('#cardpay-output');
    await output.evaluate((el, text) => {
        el.textContent = text;
    }, LONG);

    const box = await output.evaluate((el) => ({
        client: el.clientHeight,
        scroll: el.scrollHeight,
        overflowY: getComputedStyle(el).overflowY,
    }));

    // 20rem at the default root size, plus the border box.
    expect(box.client).toBeLessThanOrEqual(340);
    expect(box.scroll).toBeGreaterThan(box.client);
    expect(box.overflowY).toBe('auto');
});

test('new content scrolls the panel to its newest line', async ({ page }) => {
    const output = page.locator('#cardpay-output');
    await output.evaluate((el, text) => {
        el.textContent = text;
    }, LONG);

    await expect
        .poll(() =>
            output.evaluate(
                (el) => el.scrollHeight - el.scrollTop - el.clientHeight,
            ),
        )
        .toBeLessThanOrEqual(24);
});

test('a panel the reader scrolled up in stays where they left it', async ({
    page,
}) => {
    const output = page.locator('#cardpay-output');
    await output.evaluate((el, text) => {
        el.textContent = text;
    }, LONG);
    await expect
        .poll(() => output.evaluate((el) => el.scrollTop))
        .toBeGreaterThan(0);

    // The reader goes back to the top, then more output arrives.
    await output.evaluate((el) => {
        el.scrollTop = 0;
        el.dispatchEvent(new Event('scroll'));
    });
    await output.evaluate((el) => {
        el.textContent += '\nline 200';
    });

    expect(await output.evaluate((el) => el.scrollTop)).toBe(0);
});

test('following resumes once the reader returns to the bottom', async ({
    page,
}) => {
    const output = page.locator('#cardpay-output');
    await output.evaluate((el, text) => {
        el.textContent = text;
    }, LONG);

    await output.evaluate((el) => {
        el.scrollTop = 0;
        el.dispatchEvent(new Event('scroll'));
    });
    await output.evaluate((el) => {
        el.scrollTop = el.scrollHeight;
        el.dispatchEvent(new Event('scroll'));
    });
    await output.evaluate((el) => {
        el.textContent += '\nline 200';
    });

    await expect
        .poll(() =>
            output.evaluate(
                (el) => el.scrollHeight - el.scrollTop - el.clientHeight,
            ),
        )
        .toBeLessThanOrEqual(24);
});

test('every output panel is capped, not just the card form log', async ({
    page,
}) => {
    const overflowing = await page.evaluate(() => {
        const out = [];
        for (const pre of document.querySelectorAll('pre[id$="-output"]')) {
            const style = getComputedStyle(pre);
            out.push({
                id: pre.id,
                maxHeight: style.maxHeight,
                overflowY: style.overflowY,
            });
        }
        return out;
    });

    expect(overflowing.length).toBeGreaterThan(5);
    for (const panel of overflowing) {
        expect(panel.maxHeight, panel.id).not.toBe('none');
        expect(panel.overflowY, panel.id).toBe('auto');
    }
});
