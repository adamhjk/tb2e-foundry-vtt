import { expect } from '@playwright/test';
import { waitForGameReady } from '../helpers/game.mjs';

export class GameUI {
  constructor(page) {
    this.page = page;
    this.sidebar = page.locator('#sidebar');
  }

  async waitForReady() {
    await waitForGameReady(this.page);
    await expect(this.sidebar).toBeVisible();
  }

  async dismissTours() {
    await this.page.evaluate(() => {
      for (const tour of window.game?.tours?.contents ?? []) {
        try {
          tour.exit?.();
          tour.reset?.();
        } catch {}
      }
    });
  }

  async openSidebarTab(name) {
    await this.page.getByRole('tab', { name, exact: true }).click();
  }
}
