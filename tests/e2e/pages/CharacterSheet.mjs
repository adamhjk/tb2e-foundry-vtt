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
   * Click the Inventory tab in the sheet's tab navigation. The tab id is
   * "inventory" (see character-sheet.mjs TABS registration).
   */
  async openInventoryTab() {
    await this.root.locator('nav.sheet-tabs a[data-tab="inventory"]').click();
    await expect(this.root.locator('section[data-tab="inventory"].active')).toBeVisible();
  }

  /**
   * Slot-group container for a given slot key (e.g. "head", "hand-R",
   * "torso", "belt", "feet", "pocket", "neck"). Matches
   * `[data-slot-group="<key>"]` emitted by character-inventory.hbs.
   * @param {string} key
   */
  inventorySlotGroup(key) {
    return this.root.locator(`section[data-tab="inventory"] [data-slot-group="${key}"]`);
  }

  /**
   * Individual slot cell (0-indexed within the group) under the given slot
   * group. Matches `.inventory-slot[data-slot-key="<key>"][data-slot-index="<i>"]`.
   * @param {string} key
   * @param {number} index
   */
  inventorySlot(key, index = 0) {
    return this.root.locator(
      `section[data-tab="inventory"] .inventory-slot[data-slot-key="${key}"][data-slot-index="${index}"]`
    );
  }

  /**
   * The dropped-items section (only rendered when any item has dropped=true).
   */
  get droppedSection() {
    return this.root.locator('section[data-tab="inventory"] .inventory-dropped');
  }

  /**
   * The unassigned-items section (only rendered when any non-dropped item
   * has no slot assignment).
   */
  get unassignedSection() {
    return this.root.locator('section[data-tab="inventory"] .inventory-unassigned');
  }

  /**
   * Row for an item in the dropped section (either a flat dropped-item card
   * or a dropped container group). Scoped to top-level item cards only —
   * inner `data-item-id` attributes on placement buttons and action buttons
   * are excluded by only matching `.dropped-item` / `.dropped-container-group`.
   * @param {string} itemId
   */
  droppedItemRow(itemId) {
    return this.droppedSection.locator(
      `.dropped-item[data-item-id="${itemId}"], .dropped-container-group[data-item-id="${itemId}"]`
    );
  }

  /**
   * Row for an item in the unassigned section (either a flat unassigned-item
   * card or an unassigned container group). Scoped to the card container
   * elements — not the placement/action buttons inside.
   * @param {string} itemId
   */
  unassignedItemRow(itemId) {
    return this.unassignedSection.locator(
      `.unassigned-item[data-item-id="${itemId}"], .unassigned-container-group[data-item-id="${itemId}"]`
    );
  }

  /**
   * "Drop" action button for an item. Appears in the unassigned section's
   * per-item `.slot-actions` strip (see character-inventory.hbs) — the
   * button carries `data-action="dropItem" data-item-id="<id>"`. The slot-
   * mounted view has no drop button; drop is only offered for unassigned
   * items. For occupied slots, test flows should first removeFromSlot().
   * @param {string} itemId
   */
  dropItemButton(itemId) {
    return this.root.locator(
      `section[data-tab="inventory"] button[data-action="dropItem"][data-item-id="${itemId}"]`
    );
  }

  /**
   * "Pick up" action button for a dropped item. Appears in the dropped
   * section's per-item `.slot-actions` strip — the button carries
   * `data-action="pickUpItem" data-item-id="<id>"`.
   * @param {string} itemId
   */
  pickUpItemButton(itemId) {
    return this.root.locator(
      `section[data-tab="inventory"] button[data-action="pickUpItem"][data-item-id="${itemId}"]`
    );
  }

  /**
   * "Remove from slot" action button for an item currently placed in a slot.
   * Emitted as `.slot-actions button[data-action="removeFromSlot"]` in each
   * occupied slot cell.
   * @param {string} itemId
   */
  removeFromSlotButton(itemId) {
    return this.root.locator(
      `section[data-tab="inventory"] button[data-action="removeFromSlot"][data-item-id="${itemId}"]`
    );
  }

  /**
   * "Eat" (consume a portion) button for a food supply placed in a slot.
   * Food items render the action strip `.slot-food-qty > button.slot-consume-btn`
   * (see templates/actors/tabs/character-inventory.hbs). Only items with
   * `type="supply"` and `system.supplyType="food"` that are placed in a slot
   * get this button — unassigned supplies do NOT render it.
   * Wired to `consumePortion` data-action.
   * @param {string} itemId
   */
  consumePortionButton(itemId) {
    return this.root.locator(
      `section[data-tab="inventory"] button[data-action="consumePortion"][data-item-id="${itemId}"]`
    );
  }

  /**
   * "Drink" (drink a draught) button for a liquid container placed in a slot.
   * Rendered when the item is `type="container"` with a containerType flagged
   * `liquid: true` in CONFIG.TB2E.containerTypes (waterskin, bottle, jug, etc).
   * Wired to `drinkDraught` data-action.
   * @param {string} itemId
   */
  drinkDraughtButton(itemId) {
    return this.root.locator(
      `section[data-tab="inventory"] button[data-action="drinkDraught"][data-item-id="${itemId}"]`
    );
  }

  /**
   * "Use 1 turn" (consume a turn of light) button for a lit light supply
   * placed in a slot. Only appears when the supply has `lit: true` and
   * `supplyType: "light"`. Unlit / depleted / unassigned light items show
   * a different control (`lightSource` or the smoke icon). Wired to
   * `consumeLight` data-action.
   * @param {string} itemId
   */
  consumeLightButton(itemId) {
    return this.root.locator(
      `section[data-tab="inventory"] button[data-action="consumeLight"][data-item-id="${itemId}"]`
    );
  }

  /**
   * The numeric quantity input for a food supply's current portion count.
   * The template renders a pair of `<input type="number" class="slot-qty-input">`
   * inside `.slot-food-qty`; the first is `data-field="quantity"` (current),
   * the second is `data-field="quantityMax"`. Scoped by `data-item-id` so
   * this locator returns just the current-portions input.
   * @param {string} itemId
   */
  portionCounter(itemId) {
    return this.root.locator(
      `section[data-tab="inventory"] .slot-food-qty input.slot-qty-input[data-item-id="${itemId}"][data-field="quantity"]`
    );
  }

  /**
   * The numeric quantity input for a liquid container's current draught count.
   * Inside `.slot-liquid-qty`, the template emits an input without an explicit
   * `data-field` but scoped by `data-item-id`; the first such input is the
   * current-draughts value. We match the first `.slot-liquid-qty` input.
   * @param {string} itemId
   */
  draughtCounter(itemId) {
    return this.root.locator(
      `section[data-tab="inventory"] .slot-liquid-qty input.slot-qty-input[data-item-id="${itemId}"]`
    ).first();
  }

  /**
   * The numeric turns-remaining input for a light supply. Inside
   * `.slot-light-qty`, the template emits a single input whose sibling label
   * is the literal "t" (turns). Scoped by `data-item-id`.
   * @param {string} itemId
   */
  lightTurnsCounter(itemId) {
    return this.root.locator(
      `section[data-tab="inventory"] .slot-light-qty input.slot-qty-input[data-item-id="${itemId}"]`
    );
  }

  /**
   * The "spent" smoke icon that appears in a light supply's slot cell when
   * the item is depleted (not lit, turnsRemaining <= 0). Used to assert the
   * terminal state after consumeLight exhausts a torch.
   * @param {string} itemId
   */
  lightDepletedIcon(itemId) {
    const slot = this.root.locator(
      `section[data-tab="inventory"] .inventory-slot[data-item-id="${itemId}"]`
    );
    return slot.locator('.slot-depleted-icon');
  }

  /**
   * "Split one off" (scissors) button for a splittable bundle container
   * placed in a body slot. Rendered by character-inventory.hbs under
   * `.slot-bundle-qty` when an item's `#itemSummary.isSplittableBundle`
   * is true — i.e. `type === "container"` AND `quantityMax > 1`. Wired
   * to the `splitBundle` data-action (character-sheet.mjs #onSplitBundle).
   *
   * The button is only emitted for items occupying a slot (occupied-slot
   * branch of the template). Unassigned container rows — even bundled
   * ones — render the edit/drop/delete strip only; they do NOT include
   * the split affordance. Scoped here to the `.slot-bundle-qty` ancestor
   * to avoid matching other `data-action="splitBundle"` buttons (there
   * are none today, but the class scope makes intent explicit).
   * @param {string} itemId
   */
  splitBundleButton(itemId) {
    return this.root.locator(
      `section[data-tab="inventory"] .slot-bundle-qty button[data-action="splitBundle"][data-item-id="${itemId}"]`
    );
  }

  /**
   * The bundle "quantity/quantityMax" text span rendered next to the
   * split button for splittable bundles. Template emits
   * `<span class="slot-qty-text">{{quantity}}/{{quantityMax}}</span>`
   * inside the owning `.inventory-slot[data-item-id="<id>"]`.
   * @param {string} itemId
   */
  bundleQtyText(itemId) {
    return this.root.locator(
      `section[data-tab="inventory"] .inventory-slot[data-item-id="${itemId}"] .slot-bundle-qty .slot-qty-text`
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
