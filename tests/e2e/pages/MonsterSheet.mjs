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

    // The Nature "row" on the monster body doubles as the roll surface:
    // templates/actors/monster-body.hbs line 7 —
    //   <div class="field-pair rollable" data-action="rollNature">
    // which wires to MonsterSheet.#onRollNature (monster-sheet.mjs line 177)
    // calling `rollTest({ actor, type: "ability", key: "nature" })`. We scope
    // to the element carrying the data-action so the locator stays tight to
    // the production contract.
    this.rollNatureSurface = this.root.locator('[data-action="rollNature"]');
    // The inner label carries the localized "Nature" text — preferable to
    // click over the sibling <input type="number">, which would otherwise
    // just receive focus (the AppV2 action fires on click regardless, but
    // clicking the label avoids any browser-level caret / focus side effects
    // that could race with the dialog opening).
    this.rollNatureLabel = this.rollNatureSurface.locator('.ability-name');
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

  /**
   * Click the Nature label on the monster body to trigger the "Roll Nature"
   * action (monster-sheet.mjs #onRollNature → rollTest). Opens the shared
   * roll dialog (`_showRollDialog` in module/dice/tb2e-roll.mjs).
   */
  async clickRollNature() {
    await expect(this.rollNatureLabel).toBeVisible();
    await this.rollNatureLabel.click();
  }
}
