import { expect } from '@playwright/test';

/**
 * Minimal POM for the NPC actor sheet. Matches the `NPCSheet`
 * ApplicationV2 class registered in `module/applications/actor/npc-sheet.mjs`,
 * which sets `classes: ["tb2e", "sheet", "actor", "npc"]` and relies on
 * Foundry's default window title format (`NPC: <name>`) derived from
 * `TYPES.Actor.npc` in `lang/en.json`.
 */
export class NPCSheet {
  constructor(page, actorName) {
    this.page = page;
    this.actorName = actorName;
    this.root = page
      .locator('form.application.sheet.tb2e.actor.npc')
      .filter({ has: page.locator('.window-title', { hasText: `NPC: ${actorName}` }) });
  }

  async expectOpen() {
    await expect(this.root).toBeVisible();
  }
}
