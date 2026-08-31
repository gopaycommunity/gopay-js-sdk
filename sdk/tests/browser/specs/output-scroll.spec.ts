import { expandAllSections, expect, test } from '../fixtures/fixtures.js';

/**
 * Where an output panel sits after its content changes. Everything here is DOM
 * behaviour — the content is written straight into the panel, so no call
 * reaches the API.
 *
 * None of these dispatch a `scroll` event by hand. A real browser fires that
 * one during the rendering steps, well after the mutation the observer sees, so
 * a spec that synthesises it synchronously tests an ordering that never happens
 * — and would pass over a handler that reads a stale "at the bottom" flag.
 */

const LONG = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n');

/** Value and scroll position exactly as the browser holds them. */
function state(page: import('@playwright/test').Page, id: string) {
    return page.locator(`#${id}`).evaluate((el) => ({
        top: el.scrollTop,
        client: el.clientHeight,
        scroll: el.scrollHeight,
    }));
}

test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#sdk-badge')).toHaveText('LOADED');
    await expandAllSections(page);
});

test('a long payload is capped rather than pushing the page down', async ({
    page,
}) => {
    await page.locator('#cardpay-output').evaluate((el, text) => {
        el.textContent = text;
    }, LONG);

    const box = await state(page, 'cardpay-output');
    const overflowY = await page
        .locator('#cardpay-output')
        .evaluate((el) => getComputedStyle(el).overflowY);

    // 20rem at the default root size, plus the border box.
    expect(box.client).toBeLessThanOrEqual(340);
    expect(box.scroll).toBeGreaterThan(box.client);
    expect(overflowY).toBe('auto');
});

// This is what `run()` in helpers.js does to nearly every panel: it replaces
// the content outright. The reader wants the header and the first fields.
test('a replaced payload is read from the top', async ({ page }) => {
    await page.locator('#payment-create-output').evaluate((el, text) => {
        el.textContent = `── onSuccess ──\n${text}`;
    }, LONG);

    expect((await state(page, 'payment-create-output')).top).toBe(0);
});

test('a second response also starts at the top', async ({ page }) => {
    const output = page.locator('#payment-create-output');
    await output.evaluate((el, text) => {
        el.textContent = text;
    }, LONG);
    await output.evaluate((el) => {
        el.scrollTop = el.scrollHeight; // reader scrolled to the end of it
    });
    await output.evaluate((el, text) => {
        el.textContent = `── onSuccess ──\n${text}`;
    }, LONG);

    expect((await state(page, 'payment-create-output')).top).toBe(0);
});

// The postMessage log is the one panel that grows a line at a time.
test('an append follows the newest line', async ({ page }) => {
    const output = page.locator('#cardpay-output');
    await output.evaluate((el, text) => {
        el.textContent = text;
    }, LONG);
    await output.evaluate((el) => {
        el.scrollTop = el.scrollHeight;
    });
    await output.evaluate((el) => {
        el.textContent += '\n← GOPAY_CARD_ENCRYPT_RESULT';
    });

    const s = await state(page, 'cardpay-output');
    expect(s.scroll - s.top - s.client).toBeLessThanOrEqual(24);
});

// No synthetic scroll event: the position is set and the append lands in the
// same task, which is exactly the race a cached flag loses.
test('an append leaves a reader who scrolled up where they are', async ({
    page,
}) => {
    const output = page.locator('#cardpay-output');
    await output.evaluate((el, text) => {
        el.textContent = text;
    }, LONG);
    await output.evaluate((el) => {
        el.scrollTop = 0;
        el.textContent += '\n← GOPAY_CARD_ENCRYPT_RESULT';
    });

    expect((await state(page, 'cardpay-output')).top).toBe(0);
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
        el.textContent += '\nline A';
    });
    await output.evaluate((el) => {
        el.scrollTop = el.scrollHeight;
        el.textContent += '\nline B';
    });

    const s = await state(page, 'cardpay-output');
    expect(s.scroll - s.top - s.client).toBeLessThanOrEqual(24);
});

test('every output panel is capped, not just the card form log', async ({
    page,
}) => {
    const panels = await page.evaluate(() =>
        [...document.querySelectorAll('pre[id$="-output"]')].map((pre) => ({
            id: pre.id,
            maxHeight: getComputedStyle(pre).maxHeight,
            overflowY: getComputedStyle(pre).overflowY,
        })),
    );

    expect(panels.length).toBeGreaterThan(5);
    for (const panel of panels) {
        expect(panel.maxHeight, panel.id).not.toBe('none');
        expect(panel.overflowY, panel.id).toBe('auto');
    }
});
