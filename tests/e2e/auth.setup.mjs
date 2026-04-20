import { test as setup, expect } from '@playwright/test';
import { JoinPage } from './pages/JoinPage.mjs';
import { GameUI } from './pages/GameUI.mjs';

const AUTH_FILE = 'tests/e2e/.auth/gm.json';

setup.use({ viewport: { width: 1600, height: 900 } });

setup('authenticate as Gamemaster', async ({ page }) => {
  const joinPage = new JoinPage(page);
  await joinPage.goto();
  await joinPage.joinAs('Gamemaster');

  const ui = new GameUI(page);
  await ui.waitForReady();
  await ui.dismissTours();

  const systemId = await page.evaluate(() => window.game.system.id);
  expect(systemId).toBe('tb2e');

  await page.context().storageState({ path: AUTH_FILE });
});
