import { test, expect } from './test.mjs';
import { JoinPage } from './pages/JoinPage.mjs';
import { GameUI } from './pages/GameUI.mjs';
import { getSystemId } from './helpers/game.mjs';

test.use({
  viewport: { width: 1600, height: 900 },
  storageState: { cookies: [], origins: [] },
});

test.describe('Login', () => {
  test('Gamemaster can join the world', async ({ page }) => {
    const joinPage = new JoinPage(page);
    await joinPage.goto();
    await expect(joinPage.joinButton).toBeVisible();

    await joinPage.joinAs('Gamemaster');

    const ui = new GameUI(page);
    await ui.waitForReady();

    expect(await getSystemId(page)).toBe('tb2e');
  });
});
