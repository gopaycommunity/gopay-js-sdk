import { test as base, expect, type Page } from '@playwright/test';

// Extends the base `test` with a `page` that proxies all cross-origin requests
// through Playwright's Node.js fetch to avoid CORS restrictions in the
// headless browser. Errors from in-flight requests during page teardown
// (e.g. Google Pay background XHRs racing against page.close()) are silently
// ignored to prevent spurious test failures.
export const test = base.extend<object>({
    page: async ({ page }, use) => {
        await page.route(
            (url) => url.hostname !== 'localhost',
            async (route) => {
                try {
                    await route.fulfill({ response: await route.fetch() });
                } catch {
                    // in-flight request after page close — safe to ignore
                }
            },
        );
        await use(page);
        await page.unrouteAll({ behavior: 'ignoreErrors' });
    },
});

export { expect };

/**
 * Strip the `── onSuccess ──\n` prefix added by the example's `run()` helper
 * and parse the remaining text as JSON.
 */
export function parseOutput<T = unknown>(text: string): T {
    return JSON.parse(text.replace(/^── onSuccess ──\n/, '')) as T;
}

/**
 * Open all <details> sections on the page so Playwright can interact with
 * buttons inside collapsible sections without visibility failures.
 */
export async function expandAllSections(page: Page): Promise<void> {
    await page.evaluate(() => {
        document.querySelectorAll('details').forEach((d) => {
            (d as HTMLDetailsElement).open = true;
        });
    });
}
