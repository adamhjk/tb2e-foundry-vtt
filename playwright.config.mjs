import { defineConfig, devices } from '@playwright/test';

// Default to 8 parallel workers — proven stable on a 64-thread / 125 GB box
// at ~3 min wall clock (down from ~10 min serial). Crank higher via
// E2E_WORKERS=12/16 if the host has the headroom; going past ~16 hits the
// longest-test floor (~40 s) and yields no more speedup.
const WORKERS = Number(process.env.E2E_WORKERS ?? 8);

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  workers: WORKERS,
  forbidOnly: !!process.env.CI,
  // One local retry absorbs transient flakes that surface under parallel
  // contention (typically Foundry-side races that don't reproduce on a
  // fresh run). CI retries more aggressively.
  retries: process.env.CI ? 2 : 1,
  reporter: [['html', { open: 'never' }], ['list']],
  // Default test timeout. Tests are fast in isolation (longest ~40 s) but
  // Foundry + Chromium can stall briefly under heavy N-worker contention,
  // so the timeout is generous. Bumping this is cheaper than reducing N.
  timeout: 120_000,
  expect: { timeout: 10_000 },

  globalSetup: './tests/e2e/global-setup.mjs',
  globalTeardown: './tests/e2e/global-teardown.mjs',

  // baseURL and storageState are set per-worker in tests/e2e/test.mjs
  // (each worker gets its own Foundry on PORT_BASE + parallelIndex).
  use: {
    // trace: 'on' so the Playwright UI mode timeline always shows actions
    // (clicks, fills, assertions) — 'retain-on-failure' leaves the Actions
    // panel empty for passing tests in UI mode. Artifact cost is small
    // since local runs auto-delete test-results between runs.
    trace: 'on',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    testIdAttribute: 'data-tb-testid',
  },

  projects: [
    { name: 'setup', testMatch: /auth\.setup\.mjs$/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },
  ],
});
