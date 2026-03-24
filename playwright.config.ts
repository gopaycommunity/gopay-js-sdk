import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './sdk/tests/browser',
    reporter: [
        ['list'],
        ['junit', { outputFile: 'test-results/junit.xml' }],
        ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ],
    use: {
        baseURL: 'https://localhost:3000',
        ignoreHTTPSErrors: true,
    },
    webServer: {
        command: 'yarn workspace gopay-js-sdk-example run dev',
        url: 'https://localhost:3000',
        ignoreHTTPSErrors: true,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
