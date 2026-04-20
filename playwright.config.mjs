import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [['html', { open: 'never' }], ['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },

  globalSetup: './tests/e2e/global-setup.mjs',
  globalTeardown: './tests/e2e/global-teardown.mjs',

  use: {
    baseURL: 'http://localhost:30001',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    testIdAttribute: 'data-tb-testid',
  },

  projects: [
    { name: 'setup', testMatch: /auth\.setup\.mjs$/ },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'tests/e2e/.auth/gm.json',
      },
      dependencies: ['setup'],
    },
  ],
});
