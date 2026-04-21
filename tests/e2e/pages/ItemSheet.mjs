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
