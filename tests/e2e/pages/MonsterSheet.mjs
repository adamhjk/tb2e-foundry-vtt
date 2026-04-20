import { expect } from '@playwright/test';

/**
 * Minimal POM for the Monster actor sheet. Matches the `MonsterSheet`
 * ApplicationV2 class registered in `module/applications/actor/monster-sheet.mjs`,
 * which sets `classes: ["tb2e", "sheet", "actor", "monster"]` and relies on
 * Foundry's default window title format (`Monster: <name>`) derived from
 * `TYPES.Actor.monster` in `lang/en.json`.
 */
export class MonsterSheet {
  constructor(page, actorName) {
    this.page = page;
    this.actorName = actorName;
    this.root = page
      .locator('form.application.sheet.tb2e.actor.monster')
      .filter({ has: page.locator('.window-title', { hasText: `Monster: ${actorName}` }) });
  }

  async expectOpen() {
    await expect(this.root).toBeVisible();
  }
}
