import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

/**
 * Smoke test for the published IIFE bundle.
 *
 * `@gopaycz/gopay-js-sdk-browser` ships `dist/gopay-browser-sdk.min.js`, which
 * unpkg consumers load with a plain `<script>` and reach through the
 * `window.GoPayBrowserSDK` global. That global's shape is a compatibility
 * commitment — CLAUDE.md lists changing it as consumer-facing, and those
 * consumers pin to `@1`.
 *
 * Nothing exercised it. The example app loads the workspace packages through
 * Vite aliases pointed at TypeScript source, so every other browser spec here
 * runs against `src/` and the bundle only had to compile, never to execute. This
 * one loads the built file itself, so a broken `globalName`, a bundling error or
 * a runtime failure that only shows up in the IIFE is caught before release
 * rather than by an integrator.
 */

const IIFE_BUNDLE = fileURLToPath(
    new URL(
        '../../../../browser-sdk/dist/gopay-browser-sdk.min.js',
        import.meta.url,
    ),
);

test.beforeAll(() => {
    // The bundle is a build output, so it is absent on a fresh checkout. Say so
    // rather than failing later on a bare ENOENT from addScriptTag.
    if (!existsSync(IIFE_BUNDLE)) {
        throw new Error(
            `IIFE bundle not built at ${IIFE_BUNDLE}. ` +
                'Run: yarn workspace @gopaycz/gopay-js-sdk-browser run build',
        );
    }
});

test('IIFE bundle exposes the GoPayBrowserSDK global', async ({ page }) => {
    await page.goto('about:blank');
    await page.addScriptTag({ path: IIFE_BUNDLE });

    const shape = await page.evaluate(() => {
        const g = (globalThis as unknown as { GoPayBrowserSDK?: unknown })
            .GoPayBrowserSDK;
        return {
            present: g != null,
            createIsFunction:
                typeof (g as { createGoPayBrowserSDK?: unknown })
                    ?.createGoPayBrowserSDK === 'function',
        };
    });

    expect(shape.present).toBe(true);
    expect(shape.createIsFunction).toBe(true);
});

test('IIFE bundle builds a working SDK instance', async ({ page }) => {
    await page.goto('about:blank');
    await page.addScriptTag({ path: IIFE_BUNDLE });

    // Constructing an instance issues no request — it is the cheapest proof that
    // the bundle runs rather than merely parses.
    const methods = await page.evaluate(() => {
        const { createGoPayBrowserSDK } = (
            globalThis as unknown as {
                GoPayBrowserSDK: {
                    createGoPayBrowserSDK: (c: unknown) => object;
                };
            }
        ).GoPayBrowserSDK;

        const sdk = createGoPayBrowserSDK({
            environment: 'sandbox',
            shareableKey: 'pk_test',
            clientId: 'cid_test',
        });

        return Object.keys(sdk).filter(
            (k) => typeof (sdk as Record<string, unknown>)[k] === 'function',
        );
    });

    // At least one per module, so a bundle that dropped a module fails here
    // rather than at the integrator's first call. `authenticate` is deliberately
    // absent: the browser SDK authenticates with a shareable key and
    // attachPayment, never with client credentials.
    expect(methods).toContain('isAuthenticated');
    expect(methods).toContain('logout');
    expect(methods).toContain('attachPayment');
    expect(methods).toContain('getBrowserData');
    expect(methods).toContain('chargePayment');
    expect(methods).toContain('mountCardForm');
    expect(methods).toContain('mountApplePayButton');
    expect(methods).toContain('mountGooglePayButton');
});

test('IIFE bundle exports the error types consumers branch on', async ({
    page,
}) => {
    await page.goto('about:blank');
    await page.addScriptTag({ path: IIFE_BUNDLE });

    const exported = await page.evaluate(() =>
        Object.keys(
            (globalThis as unknown as { GoPayBrowserSDK: object })
                .GoPayBrowserSDK,
        ),
    );

    // Documented in the README's monitoring recipe: onError handlers branch on
    // GoPayHTTPError, so it has to be reachable from the global too.
    expect(exported).toContain('GoPayHTTPError');
    expect(exported).toContain('GoPaySDKError');
    expect(exported).toContain('GoPayErrorCodes');
});
