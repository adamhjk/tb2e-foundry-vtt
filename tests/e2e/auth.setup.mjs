import { test as setup, expect } from '@playwright/test';
import { JoinPage } from './pages/JoinPage.mjs';
import { GameUI } from './pages/GameUI.mjs';

const PORT_BASE = Number(process.env.E2E_PORT_BASE ?? 30001);
const WORKERS = Number(process.env.E2E_WORKERS ?? 8);

setup.use({ viewport: { width: 1600, height: 900 } });

// Generous per-test timeout: N simultaneous logins all share the same wall
// clock. 180 s keeps headroom for 16 parallel Foundries on a cold cache.
setup.setTimeout(180_000);

async function authenticateWorker(browser, workerIndex) {
  const ctx = await browser.newContext({
    baseURL: `http://localhost:${PORT_BASE + workerIndex}`,
    viewport: { width: 1600, height: 900 },
  });
  try {
    const page = await ctx.newPage();
    const joinPage = new JoinPage(page);
    await joinPage.goto();
    await joinPage.joinAs('Gamemaster');

    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    const systemId = await page.evaluate(() => window.game.system.id);
    expect(systemId).toBe('tb2e');

    await ctx.storageState({ path: `tests/e2e/.auth/gm-${workerIndex}.json` });
  } finally {
    await ctx.close();
  }
}

setup('authenticate all workers', async ({ browser }) => {
  await Promise.all(
    Array.from({ length: WORKERS }, (_, i) => authenticateWorker(browser, i)),
  );
});
