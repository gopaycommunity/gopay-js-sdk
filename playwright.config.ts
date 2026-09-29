import { defineConfig, devices } from '@playwright/test';

// Specs that talk to the gateway. `e2e-on-env` runs --project=gateway so that a red run there
// means the chosen environment is broken - the rest assert bundle exports and output-panel
// scrolling, which pass identically against every environment and already run on each PR.
const GATEWAY_SPECS = [
    '**/specs/authenticate.spec.ts',
    '**/specs/auth-logout.spec.ts',
    '**/specs/card-form.spec.ts',
    '**/specs/payment-link.spec.ts',
    '**/specs/payments-create.spec.ts',
    '**/specs/qr-payment.spec.ts',
];

export default defineConfig({
    testDir: './sdk/tests/browser',
    reporter: [
        ['list'],
        ['junit', { outputFile: 'test-results/junit.xml' }],
        ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ],
    use: {
        baseURL: 'https://localhost:8080',
        ignoreHTTPSErrors: true,
    },
    webServer: {
        command: 'yarn workspace gopay-js-sdk-example run dev',
        url: 'https://localhost:8080',
        ignoreHTTPSErrors: true,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
    },
    projects: [
        {
            name: 'gateway',
            testMatch: GATEWAY_SPECS,
            use: { ...devices['Desktop Chrome'] },
        },
        // Complement rather than a second list: a spec added tomorrow lands here and runs on
        // every PR, instead of silently belonging to no project and never running at all.
        {
            name: 'local',
            testIgnore: GATEWAY_SPECS,
            use: { ...devices['Desktop Chrome'] },
        },
    ],
});
