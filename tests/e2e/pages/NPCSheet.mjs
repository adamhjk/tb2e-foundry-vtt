import { expect } from '@playwright/test';

/**
 * POM for the NPC actor sheet. Matches the `NPCSheet` ApplicationV2 class in
 * `module/applications/actor/npc-sheet.mjs`, which sets
 * `classes: ["tb2e", "sheet", "actor", "npc"]` and relies on Foundry's default
 * window title format (`NPC: <name>`) derived from `TYPES.Actor.npc` in
 * `lang/en.json`.
 *
 * Selectors for body fields come from `templates/actors/npc-body.hbs`, whose
 * form inputs bind directly to the NPC data-model paths defined in
 * `module/data/actor/npc.mjs` (e.g. `system.stock`, `system.goal`,
 * `system.abilities.<key>.rating`, `system.might`, `system.skills.<i>.rating`,
 * `system.wises.<i>`, `system.description`).
 *
 * Sized to be reusable by the next checkbox (npc-edit-basics.spec.mjs): the
 * "basics" there means name + notes / description, plus the identity strip
 * (stock / class / goal) the header summarizes.
 */
export class NPCSheet {
  constructor(page, actorName) {
    this.page = page;
    this.actorName = actorName;
    this.root = page
      .locator('form.application.sheet.tb2e.actor.npc')
      .filter({ has: page.locator('.window-title', { hasText: `NPC: ${actorName}` }) });

    // Header fields — npc-header.hbs.
    this.nameInput = this.root.locator('input[name="name"]');
    this.summaryLine = this.root.locator('.summary-line');

    // Identity fields — npc-body.hbs lines 4-17.
    this.stockInput = this.root.locator('input[name="system.stock"]');
    this.classInput = this.root.locator('input[name="system.class"]');
    this.goalInput = this.root.locator('input[name="system.goal"]');

    // Core stats — data-model defaults at data/actor/npc.mjs lines 13-35.
    this.natureInput = this.root.locator('input[name="system.abilities.nature.rating"]');
    this.willInput = this.root.locator('input[name="system.abilities.will.rating"]');
    this.healthInput = this.root.locator('input[name="system.abilities.health.rating"]');
    this.mightInput = this.root.locator('input[name="system.might"]');

    // Description textarea — the "GM notes" field per npc.mjs line 75.
    this.descriptionTextarea = this.root.locator('textarea[name="system.description"]');

    // List fieldsets — counts are asserted against the imported data.
    this.skillRows = this.root.locator('.npc-skills-list .skill-row');
    this.wiseRows = this.root.locator('.npc-wises-list .npc-wise-row');
    this.traitRows = this.root.locator('tbody tr[data-item-id]');
  }

  async expectOpen() {
    await expect(this.root).toBeVisible();
  }

  /** Locator for the idx-th skill row's rating input. */
  skillRatingInput(idx) {
    return this.root.locator(`input[name="system.skills.${idx}.rating"]`);
  }

  /** Locator for the idx-th skill row's key <select>. */
  skillKeySelect(idx) {
    return this.root.locator(`select[name="system.skills.${idx}.key"]`);
  }

  /** Locator for the idx-th wise input. */
  wiseInput(idx) {
    return this.root.locator(`input[name="system.wises.${idx}"]`);
  }
}
