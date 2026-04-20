import { expect } from '@playwright/test';

export class CharacterSheet {
  constructor(page, actorName) {
    this.page = page;
    this.actorName = actorName;
    this.root = page
      .locator('form.application.sheet.tb2e.actor.character')
      .filter({ has: page.locator('.window-title', { hasText: `Character: ${actorName}` }) });
    this.nameInput = this.root.locator('input[name="name"]');
    // Identity tab inputs — live inside the identity tab panel, which is
    // not visible until the Identity tab is activated. Selecting by
    // `name` attribute works regardless of tab visibility.
    this.levelInput = this.root.locator('input[name="system.level"]');
    this.homeInput = this.root.locator('input[name="system.home"]');
  }

  async expectOpen() {
    await expect(this.root).toBeVisible();
  }

  /**
   * Click the Identity tab in the sheet's tab navigation.
   */
  async openIdentityTab() {
    await this.root.locator('nav.sheet-tabs a[data-tab="identity"]').click();
    await expect(this.root.locator('section[data-tab="identity"].active')).toBeVisible();
  }

  /**
   * Click the Abilities tab in the sheet's tab navigation.
   */
  async openAbilitiesTab() {
    await this.root.locator('nav.sheet-tabs a[data-tab="abilities"]').click();
    await expect(this.root.locator('section[data-tab="abilities"].active')).toBeVisible();
  }

  /**
   * Click the Skills tab in the sheet's tab navigation.
   */
  async openSkillsTab() {
    await this.root.locator('nav.sheet-tabs a[data-tab="skills"]').click();
    await expect(this.root.locator('section[data-tab="skills"].active')).toBeVisible();
  }

  /**
   * Rating input for a given ability key (will, health, nature, circles, resources).
   * @param {string} key
   */
  abilityRating(key) {
    return this.root.locator(`input[name="system.abilities.${key}.rating"]`);
  }

  /**
   * Max input for a given ability key. Currently only `nature` exposes a max field.
   * @param {string} key
   */
  abilityMax(key) {
    return this.root.locator(`input[name="system.abilities.${key}.max"]`);
  }

  /**
   * Rating input for a given skill key (e.g. fighter, scholar, hunter).
   * Requires the Skills tab to be active.
   * @param {string} key
   */
  skillRating(key) {
    return this.root.locator(`input[name="system.skills.${key}.rating"]`);
  }

  /**
   * Click the Traits (Traits & Wises) tab in the sheet's tab navigation.
   */
  async openTraitsTab() {
    await this.root.locator('nav.sheet-tabs a[data-tab="traits"]').click();
    await expect(this.root.locator('section[data-tab="traits"].active')).toBeVisible();
  }

  /**
   * The "Add Trait" button in the traits tab. Requires the Traits tab to be active.
   * Wired to the `addTrait` data-action on the character sheet.
   */
  get addTraitButton() {
    return this.root.locator('section[data-tab="traits"] fieldset.traits-section button.btn-add[data-action="addTrait"]');
  }

  /**
   * Trait row for a given trait Item by id. The template emits
   * `.trait-row[data-item-id="<id>"]`.
   * @param {string} itemId
   */
  traitRow(itemId) {
    return this.root.locator(`.trait-row[data-item-id="${itemId}"]`);
  }

  /**
   * Name input for a given trait Item id (inline text input).
   * @param {string} itemId
   */
  traitNameInput(itemId) {
    return this.traitRow(itemId).locator('input.trait-name-input');
  }

  /**
   * Level bubble (pip) button for a trait row. `level` is 1, 2, or 3.
   * Clicking dispatches the `setTraitLevel` data-action.
   * @param {string} itemId
   * @param {number} level
   */
  traitLevelBubble(itemId, level) {
    return this.traitRow(itemId).locator(
      `button.level-pip[data-action="setTraitLevel"][data-level="${level}"]`
    );
  }

  /**
   * Delete button for a trait row (fires the `deleteTrait` data-action).
   * @param {string} itemId
   */
  deleteTraitButton(itemId) {
    return this.traitRow(itemId).locator('button.btn-icon[data-action="deleteTrait"]');
  }

  /**
   * The "Add Wise" button in the traits tab. Requires the Traits tab to be active.
   * Wired to the generic `addRow` data-action with `data-array="wises"` on the
   * character sheet (module/applications/actor/character-sheet.mjs #onAddRow).
   * The button is only rendered when fewer than 4 wises exist (SG/DH slot cap).
   */
  get addWiseButton() {
    return this.root.locator(
      'section[data-tab="traits"] fieldset.wises-section button.btn-add[data-action="addRow"][data-array="wises"]'
    );
  }

  /**
   * Wise row located by its array index. Wises are an actor-field array
   * (`system.wises`), not embedded Items, so rows are identified by index,
   * not by id. The template emits inputs named `system.wises.<index>.name`
   * and a delete button with `data-array="wises" data-index="<index>"`.
   * @param {number} index
   */
  wiseRow(index) {
    return this.root.locator('section[data-tab="traits"] fieldset.wises-section .wise-row').nth(index);
  }

  /**
   * All wise rows under the Traits & Wises tab.
   */
  get wiseRows() {
    return this.root.locator('section[data-tab="traits"] fieldset.wises-section .wise-row');
  }

  /**
   * Name input for the wise at a given index. Matches the named input the
   * template emits, which is updated by the sheet's form submission flow.
   * @param {number} index
   */
  wiseNameInput(index) {
    return this.root.locator(`input[name="system.wises.${index}.name"]`);
  }

  /**
   * Delete button for the wise at a given index. Fires the generic
   * `deleteRow` data-action (removes the entry from `system.wises`).
   * @param {number} index
   */
  deleteWiseButton(index) {
    return this.root.locator(
      `section[data-tab="traits"] fieldset.wises-section .wise-row button.btn-icon[data-action="deleteRow"][data-array="wises"][data-index="${index}"]`
    );
  }

  /**
   * "New Session" button in the sheet header toolbar. Wired to the
   * `resetSession` data-action (module/applications/actor/character-sheet.mjs),
   * which calls `resetTraitsForSession` from module/session.mjs after a
   * confirm dialog. Always visible (lives in character-header.hbs, not in
   * a tab panel).
   */
  get resetSessionButton() {
    return this.root.locator('button.session-reset-btn[data-action="resetSession"]');
  }

  /**
   * Beneficial-uses input for a given trait Item id. `system.beneficial`
   * tracks the number of +1D uses REMAINING this session (not consumed).
   * L1 traits reset to 1, L2 to 2, L3 to 0 (unlimited, not counted) —
   * see module/session.mjs and module/data/item/trait.mjs.
   * @param {string} itemId
   */
  traitBeneficialInput(itemId) {
    return this.traitRow(itemId).locator('input.trait-beneficial-input');
  }

  /**
   * "Conserve Nature" button in the Nature row on the Abilities tab. Wired
   * to the `conserveNature` data-action (module/applications/actor/
   * character-sheet.mjs #onConserveNature), which opens a DialogV2.confirm
   * and — on Yes — decrements `system.abilities.nature.max` by 1, sets
   * `rating` to the new max, and zeroes pass/fail. Disabled by the template
   * when `canConserve === false` (i.e. `nature.max <= 1`).
   */
  get conserveNatureButton() {
    return this.root.locator(
      'section[data-tab="abilities"] .nature-ability-row button.nature-action-btn[data-action="conserveNature"]'
    );
  }

  /**
   * "Recover Nature" button in the Nature row on the Abilities tab. Wired
   * to the `recoverNature` data-action (module/applications/actor/
   * character-sheet.mjs #onRecoverNature), which — with no confirm dialog —
   * increments `system.abilities.nature.rating` by 1, up to `max`. Disabled
   * by the template when `canRecover === false` (i.e. `rating >= max`).
   */
  get recoverNatureButton() {
    return this.root.locator(
      'section[data-tab="abilities"] .nature-ability-row button.nature-action-btn[data-action="recoverNature"]'
    );
  }

  /**
   * Condition toggle button in the sheet's conditions strip.
   * The strip is rendered at the top of the sheet (see
   * templates/actors/character-conditions.hbs) and is always visible —
   * no tab switch required. Buttons carry `data-condition="<key>"`
   * matching the condition key (fresh, hungry, angry, afraid, exhausted,
   * injured, sick, dead).
   * @param {string} key
   */
  conditionToggle(key) {
    return this.root.locator(`nav.conditions-strip button.condition-btn[data-condition="${key}"]`);
  }
}
