import { expect } from '@playwright/test';

/**
 * POM for the Monster actor sheet. Matches the `MonsterSheet`
 * ApplicationV2 class registered in `module/applications/actor/monster-sheet.mjs`,
 * which sets `classes: ["tb2e", "sheet", "actor", "monster"]` and relies on
 * Foundry's default window title format (`Monster: <name>`) derived from
 * `TYPES.Actor.monster` in `lang/en.json`.
 *
 * Selectors for body fields come from templates/actors/monster-body.hbs —
 * form inputs use the data-model name attributes (`system.nature`,
 * `system.dispositions.<i>.conflictType`, `system.weapons.<i>.name`, etc.).
 *
 * Monsters do NOT have trait items (see module/data/actor/monster.mjs — the
 * schema is flat, no embedded `items`). The "loadout" analog on a monster is
 * the weapons array, so assertions targeting the "traits" concept should use
 * `weaponRows` / `weaponNameInput` instead.
 */
export class MonsterSheet {
  constructor(page, actorName) {
    this.page = page;
    this.actorName = actorName;
    this.root = page
      .locator('form.application.sheet.tb2e.actor.monster')
      .filter({ has: page.locator('.window-title', { hasText: `Monster: ${actorName}` }) });

    this.nameInput = this.root.locator('input[name="name"]');
    this.natureInput = this.root.locator('input[name="system.nature"]');
    this.mightInput = this.root.locator('input[name="system.might"]');
    this.precedenceInput = this.root.locator('input[name="system.precedence"]');
    this.instinctInput = this.root.locator('input[name="system.instinct"]');
    this.armorInput = this.root.locator('input[name="system.armor"]');

    // Disposition rows — 3 fixed slots per monster.mjs defaults (strength /
    // competency / weakness). Each row has a conflictType label input and an
    // hp numeric input.
    this.dispositionRows = this.root.locator('.dispositions-table .disposition-row');

    // Weapon rows — variable length from system.weapons array.
    this.weaponRows = this.root.locator('.weapons-table tbody tr');
  }

  async expectOpen() {
    await expect(this.root).toBeVisible();
  }

  /** Locator for the idx-th disposition row's conflictType input. */
  dispositionTypeInput(idx) {
    return this.root.locator(`input[name="system.dispositions.${idx}.conflictType"]`);
  }

  /** Locator for the idx-th disposition row's hp input. */
  dispositionHpInput(idx) {
    return this.root.locator(`input[name="system.dispositions.${idx}.hp"]`);
  }

  /** Locator for the idx-th weapon row's name input. */
  weaponNameInput(idx) {
    return this.root.locator(`input[name="system.weapons.${idx}.name"]`);
  }
}
