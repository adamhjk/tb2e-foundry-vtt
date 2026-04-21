import { expect } from '@playwright/test';

/**
 * POM for the TB2E `GearSheet` — the shared ItemSheetV2 used for every
 * non-magic item type (weapon, armor, container, gear, supply, spellbook,
 * scroll, relic). Registered in `tb2e.mjs` line 88-92, class source at
 * `module/applications/item/gear-sheet.mjs` line 6.
 *
 * The underlying AppV2 application sets `classes: ["tb2e", "sheet", "item",
 * "gear-sheet"]` (gear-sheet.mjs line 9), with `application` prepended by
 * the AppV2 runtime (`foundry/client/applications/api/application.mjs`
 * line 407), and uses Foundry's default DocumentSheetV2 title format
 * `<TypeLabel>: <name>` (`document-sheet.mjs` line 89-93). The weapon type
 * label resolves to `"Weapon"` (lang/en.json line 6: `TYPES.Item.weapon`),
 * so the window title for a weapon sheet reads `Weapon: <name>`.
 *
 * `DEFAULT_OPTIONS.form.submitOnChange = true` (gear-sheet.mjs line 17), so
 * `.fill()` + blur auto-submits — the same pattern exercised by
 * `tests/e2e/sheet/npc-edit-basics.spec.mjs` and
 * `tests/e2e/sheet/edit-identity.spec.mjs`.
 *
 * Sized for reuse across §22 Items (Non-Magic): the common surface
 * (`root`, `nameInput`, `costInput`, `quantityInput`, `quantityMaxInput`,
 * `damagedCheckbox`, `valueDiceInput`, `descriptionTextarea`) covers every
 * item type, and subclass helpers extend it for type-specific fields
 * (weapon: wield/conflict bonuses/special rules; armor: protection/burden;
 * container: custom slots; supply: quality/portions).
 *
 * Selectors for all shared fields come from `templates/items/gear-sheet.hbs`.
 */
export class ItemSheet {
  /**
   * @param {import('@playwright/test').Page} page
   * @param {{ typeLabel: string, itemName: string }} opts
   *        typeLabel — the localized `TYPES.Item.<type>` string that prefixes
   *        the window title (e.g. `"Weapon"`, `"Armor"`). itemName — the
   *        current name shown in the title. Title format is
   *        `<typeLabel>: <itemName>` per DocumentSheetV2#title.
   */
  constructor(page, { typeLabel, itemName }) {
    this.page = page;
    this.typeLabel = typeLabel;
    this.itemName = itemName;
    this.root = page
      .locator('form.application.sheet.tb2e.item.gear-sheet')
      .filter({
        has: page.locator('.window-title', {
          hasText: `${typeLabel}: ${itemName}`,
        }),
      });

    // Shared fields — every item type renders these in gear-sheet.hbs.
    this.nameInput = this.root.locator('input[name="name"]');
    this.costInput = this.root.locator('input[name="system.cost"]');
    this.damagedCheckbox = this.root.locator('input[name="system.damaged"]');
    this.valueDiceInput = this.root.locator('input[name="system.value.dice"]');
    this.valueNegotiatedCheckbox = this.root.locator(
      'input[name="system.value.negotiated"]'
    );
    this.quantityInput = this.root.locator('input[name="system.quantity"]');
    this.quantityMaxInput = this.root.locator('input[name="system.quantityMax"]');
    this.descriptionTextarea = this.root.locator(
      'textarea[name="system.description"]'
    );
  }

  async expectOpen() {
    await expect(this.root).toBeVisible();
  }

  /** Close button in the window header (app frame). */
  async close() {
    await this.root.locator('header button[data-action="close"]').click();
    await expect(this.root).toHaveCount(0);
  }
}

/**
 * Weapon-specific POM extension. Adds selectors for the `#if isWeapon`
 * fieldset (gear-sheet.hbs lines 66-107):
 *   - `wield` (select) — `system.wield`, NumberField 1|2 (weapon.mjs line 15).
 *   - `conflictBonuses.<action>.type` (select) — per-action "dice"/"success"
 *     variant (weapon.mjs lines 8-11, 16-21).
 *   - `conflictBonuses.<action>.value` (number) — per-action numeric bonus.
 *   - `specialRules` (textarea) — `system.specialRules` (weapon.mjs line 27).
 *
 * NOTE: TB2E weapons do NOT have a `damage` or `weight` field. The rules
 * model weapon capability via conflict-action bonuses (attack/defend/feint/
 * maneuver; DH p.116) and slot `cost` (burden; DH pp.72-74). `conflictBonuses
 * .attack.value` is the closest analog to "damage"; `cost` / wield is the
 * closest analog to "weight". The TEST_PLAN checkbox wording is generic;
 * this spec adapts it to the actual TB2E weapon schema.
 */
export class WeaponItemSheet extends ItemSheet {
  constructor(page, itemName) {
    super(page, { typeLabel: 'Weapon', itemName });

    this.wieldSelect = this.root.locator('select[name="system.wield"]');
    this.specialRulesTextarea = this.root.locator(
      'textarea[name="system.specialRules"]'
    );
  }

  /** Locator for a specific conflict-action's bonus value input (attack, defend, feint, maneuver). */
  conflictBonusValueInput(action) {
    return this.root.locator(
      `input[name="system.conflictBonuses.${action}.value"]`
    );
  }

  /** Locator for a specific conflict-action's bonus type select (dice|success). */
  conflictBonusTypeSelect(action) {
    return this.root.locator(
      `select[name="system.conflictBonuses.${action}.type"]`
    );
  }
}

/**
 * Armor-specific POM extension. Targets the `#if isArmor` fieldset in
 * `templates/items/gear-sheet.hbs` lines 110-132:
 *   - `armorType` (select) — `system.armorType`, StringField with choices
 *     leather|chain|plate|helmet|shield (`module/data/item/armor.mjs` lines
 *     10-13; enum labelled via `CONFIG.TB2E.armorTypes`, `module/config.mjs`
 *     lines 100-106).
 *   - `absorbs` (number) — `system.absorbs`, NumberField (armor.mjs line 14).
 *     This is TB2E's "protection" stat (SG p.149, DH p.112: armor rating =
 *     success rolls absorbed when hit in conflict). Per DH p.112: "Armor has
 *     a rating (1s to 3s) that absorbs successes from opponents' attacks."
 *   - `specialRules` (textarea) — `system.specialRules` (armor.mjs line 15).
 *
 * Burden is modelled on TB2E armor via the shared `system.cost` field
 * (`module/data/item/_fields.mjs` line 27) — slot cost from the Buyer's
 * Guide (DH p.72-74). TB2E has no separate numeric "burden" field; per-slot
 * costs are captured in `system.slotOptions`. For a single-value "burden"
 * analog the `cost` input is the correct target (same usage as the weapon
 * spec, `weapon-sheet.spec.mjs` lines 56-58).
 */
export class ArmorItemSheet extends ItemSheet {
  constructor(page, itemName) {
    super(page, { typeLabel: 'Armor', itemName });

    this.armorTypeSelect = this.root.locator('select[name="system.armorType"]');
    this.absorbsInput = this.root.locator('input[name="system.absorbs"]');
    this.specialRulesTextarea = this.root.locator(
      'textarea[name="system.specialRules"]'
    );
  }
}

/**
 * Container-specific POM extension. Targets the `#if isContainer` fieldset in
 * `templates/items/gear-sheet.hbs` lines 135-168:
 *   - `containerType` (select) — `system.containerType`, StringField with
 *     choices backpack|satchel|largeSack|smallSack|pouch|quiver|waterskin|
 *     bottle|jug|framePack|barrel|cask|chestSmall|seaChest|clayPot|purse|
 *     woodenCanteen (`module/data/item/container.mjs` lines 12-17).
 *   - `containerSlots` (number) — `system.containerSlots`, NumberField
 *     (initial 6, min 0, integer; `container.mjs` line 11). This is the
 *     number of sub-slots the container provides when equipped on the
 *     character (DH pp.71-74 — a backpack provides Pack slots, a quiver
 *     provides Quiver slots, etc.). The character sheet reads this at
 *     `module/applications/actor/character-sheet.mjs` line 442 and renders
 *     that many cells under the container's dynamic slot group.
 *   - `containerKey` (text) — `system.containerKey`, StringField (initial
 *     "", line 10). The slot-group key used when children reference this
 *     container as their `slot`. When empty, the sheet falls back to the
 *     item's id as the key (`character-sheet.mjs` line 438).
 *
 * Note: the `containerSlots` + `containerKey` inputs are rendered only in
 * the non-liquid branch (template lines 157-164) — liquid containers
 * (waterskin/bottle/jug) expose a `liquidType` select instead and don't
 * provide slot groups at all (`character-sheet.mjs` line 437 skips them).
 */
export class ContainerItemSheet extends ItemSheet {
  constructor(page, itemName) {
    super(page, { typeLabel: 'Container', itemName });

    this.containerTypeSelect = this.root.locator(
      'select[name="system.containerType"]'
    );
    this.containerSlotsInput = this.root.locator(
      'input[name="system.containerSlots"]'
    );
    this.containerKeyInput = this.root.locator(
      'input[name="system.containerKey"]'
    );
    this.liquidTypeSelect = this.root.locator(
      'select[name="system.liquidType"]'
    );
  }
}

/**
 * Supply-specific POM extension. Targets the `#if isSupply` fieldset in
 * `templates/items/gear-sheet.hbs` lines 197-244:
 *   - `supplyType` (select) — `system.supplyType`, StringField with choices
 *     food|light|spellMaterial|sacramental|ammunition|other
 *     (`module/data/item/supply.mjs` lines 10-13; enum labelled via
 *     `CONFIG.TB2E.supplyTypes`, `module/config.mjs` lines 147-154).
 *   - `turnsRemaining` (number) — `system.turnsRemaining`, NumberField
 *     (supply.mjs line 14). Only meaningful for light supplies (torches,
 *     lanterns — DH p.71), but the input renders for every supply.
 *   - `nameSingular` (text) — `system.nameSingular`, StringField (supply.mjs
 *     line 16). Display helper for bundled supplies (e.g. "Torch" for a
 *     bundle named "Torches").
 *   - `lit` (checkbox) — `system.lit`, BooleanField (supply.mjs line 15).
 *     Controls the consumeLight / lightSource button-rendering branch in
 *     the character sheet inventory (see `inventory-supplies.spec.mjs`).
 *
 * Portions are NOT a supply-specific field — they are the shared
 * `system.quantity` / `system.quantityMax` from `inventoryFields`
 * (`module/data/item/_fields.mjs` lines 30-31). The gear-sheet renders
 * these on every item type (template lines 53-63), and the base
 * `ItemSheet` POM already exposes `quantityInput` / `quantityMaxInput` for
 * them — RAW a "portion" in TB2E is one unit of `quantity` on a food supply
 * (DH pp.71-72: a supply's portions count is its `quantity`; when it runs
 * out, the supply is depleted).
 *
 * TB2E supplies have no "quality" field. The TEST_PLAN §22 checkbox
 * ("supply with multiple portions; consume one; verify counter decrement")
 * maps to `system.quantity` + `system.quantityMax` as the portion counters.
 * The sheet-side consumePortion flow is already covered in full by
 * `tests/e2e/sheet/inventory-supplies.spec.mjs` (§2 Character Sheet line
 * 122); this spec covers the complementary item-sheet edit surface — i.e.
 * setting a supply up with N portions via the GearSheet form and proving
 * the values round-trip through the data model.
 */
export class SupplyItemSheet extends ItemSheet {
  constructor(page, itemName) {
    super(page, { typeLabel: 'Supply', itemName });

    this.supplyTypeSelect = this.root.locator(
      'select[name="system.supplyType"]'
    );
    this.turnsRemainingInput = this.root.locator(
      'input[name="system.turnsRemaining"]'
    );
    this.nameSingularInput = this.root.locator(
      'input[name="system.nameSingular"]'
    );
    this.litCheckbox = this.root.locator('input[name="system.lit"]');
  }
}
