import { test as base } from '@playwright/test';

const PORT_BASE = Number(process.env.E2E_PORT_BASE ?? 30001);

/**
 * Per-worker Playwright fixtures. Each parallel worker gets its own Foundry
 * instance (spawned in global-setup.mjs) on PORT_BASE + parallelIndex, with
 * its own auth session at tests/e2e/.auth/gm-<parallelIndex>.json.
 *
 * parallelIndex (not workerIndex) is used because it's bounded to
 * [0, concurrency) and stable across worker restarts — so it maps 1:1 to
 * the Foundry instances we spawned up front.
 */
export const test = base.extend({
  baseURL: async ({}, use, testInfo) => {
    await use(`http://localhost:${PORT_BASE + testInfo.parallelIndex}`);
  },
  storageState: async ({}, use, testInfo) => {
    await use(`tests/e2e/.auth/gm-${testInfo.parallelIndex}.json`);
  },
});

export { expect } from '@playwright/test';
