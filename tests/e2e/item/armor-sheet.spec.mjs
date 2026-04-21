import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { CharacterSheet } from '../pages/CharacterSheet.mjs';
import { ArmorItemSheet } from '../pages/ItemSheet.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §22 Items (Non-Magic) — armor item sheet edit/persist.
 *
 * Opens an armor item sheet from a character's inventory (via the per-row
 * `editItem` data-action — `templates/actors/tabs/character-inventory.hbs`
 * line 319, handler `#onEditItem` in `module/applications/actor/character-
 * sheet.mjs` line 1725), edits armor-specific fields, and verifies the
 * values round-trip through the data model and back into the DOM after a
 * close + re-render.
 *
 * TB2E armor schema (`module/data/item/armor.mjs`):
 *   - `armorType`: StringField, choices leather|chain|plate|helmet|shield
 *     (lines 10-13; labelled via `CONFIG.TB2E.armorTypes`, `module/config.mjs`
 *     lines 100-106; SG p.149, DH p.112 — Buyer's Guide armor entries).
 *   - `absorbs`: NumberField, integer >= 0 (line 14). TB2E's "protection"
 *     stat (DH p.112 — "Armor has a rating (1s to 3s) that absorbs
 *     successes from opponents' attacks"). Leather=1, chain=2, plate=3 per
 *     DH p.74.
 *   - `specialRules`: StringField (line 15).
 *
 * TB2E has no separate numeric "burden" field on armor. Per RAW (DH pp.72-
 * 74), the burden of an item is its slot cost in the Buyer's Guide — leather
 * occupies Torso 1, chain Torso 2, plate Torso 3. This is captured two ways
 * in the data model:
 *   - `system.cost`: shared inventoryFields NumberField (`_fields.mjs` line
 *     27) — a single scalar cost displayed in the top-of-sheet fields block
 *     (`templates/items/gear-sheet.hbs` line 16). Closest single-value
 *     analog to "burden".
 *   - `system.slotOptions`: per-location slot costs (`_fields.mjs` lines 17-
 *     20, 26) — the actual RAW model for where armor can go and at what
 *     cost.
 * This spec edits `system.cost` as the "burden" field, matching the precedent
 * set by `tests/e2e/item/weapon-sheet.spec.mjs` (which used the same field
 * for the same reason; TEST_PLAN.md line 576). Slot-assignment + slot-cost
 * mechanics are covered separately by `tests/e2e/sheet/inventory-slots.
 * spec.mjs`.
 *
 * The TEST_PLAN §22 checkbox wording ("edit protection/burden") matches
 * TB2E terminology in spirit but not in field names. This spec adapts it:
 *   protection → `system.absorbs`
 *   burden     → `system.cost`
 *   + `armorType` enum + `specialRules` for coverage of the armor-only
 *     fieldset surface.
 *
 * Persistence model: `GearSheet.DEFAULT_OPTIONS.form.submitOnChange = true`
 * (`module/applications/item/gear-sheet.mjs` line 17). Fill + blur (or
 * `selectOption` for selects) auto-submits.
 */
test.describe('Armor item sheet — edit + persist', () => {
  test('edits armorType, absorbs (protection), cost (burden), and special rules; values round-trip', async ({
    page,
  }) => {
    const actorName = `E2E ArmorSheet ${Date.now()}`;
    const itemName = `${actorName} Leather Armor`;

    // Initial armor state — leather armor with absorbs=1 and cost=1 mirrors
    // a stock leather entry from the Buyer's Guide (DH p.74).
    const initial = {
      armorType: 'leather',
      absorbs: 1,
      cost: 1,
      specialRules: '',
    };

    // Target post-edit state — upgrade to chain (absorbs 2, cost 2) and add
    // special rules text. Values correspond to the chain entry (DH p.74).
    const updated = {
      armorType: 'chain',
      absorbs: 2,
      cost: 2,
      specialRules: 'Noisy. -1D to Scout when worn.',
    };

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    const { actorId, itemId } = await page.evaluate(
      async ({ actorName: n, itemName: iName, init }) => {
        const actor = await Actor.create({ name: n, type: 'character' });
        const [item] = await actor.createEmbeddedDocuments('Item', [
          {
            name: iName,
            type: 'armor',
            system: {
              // Unassigned — surfaces in the Unassigned strip where the
              // `editItem` button is rendered (character-inventory.hbs
              // line 319).
              slot: '',
              slotIndex: 0,
              armorType: init.armorType,
              absorbs: init.absorbs,
              cost: init.cost,
              specialRules: init.specialRules,
              // Allow placement on torso so the sheet round-trip is valid
              // even though we don't exercise placement here.
              slotOptions: { torso: 1 },
            },
          },
        ]);
        return { actorId: actor.id, itemId: item.id };
      },
      { actorName, itemName, init: initial }
    );
    expect(actorId).toBeTruthy();
    expect(itemId).toBeTruthy();

    try {
      // Open the character sheet via the API — avoids sidebar traversal.
      await page.evaluate((id) => {
        game.actors.get(id).sheet.render(true);
      }, actorId);

      const charSheet = new CharacterSheet(page, actorName);
      await charSheet.expectOpen();
      await charSheet.openInventoryTab();

      // Pre-state: item shows up in the unassigned strip.
      const unassignedRow = charSheet.unassignedItemRow(itemId);
      await expect(unassignedRow).toBeVisible();

      // Click the per-row Edit button — fires `editItem` data-action,
      // which invokes `item.sheet.render(true)` (character-sheet.mjs
      // line 1728).
      await unassignedRow
        .locator('button[data-action="editItem"][data-item-id="' + itemId + '"]')
        .click();

      const armorSheet = new ArmorItemSheet(page, itemName);
      await armorSheet.expectOpen();

      // Sanity-check the rendered initial values.
      await expect(armorSheet.nameInput).toHaveValue(itemName);
      await expect(armorSheet.armorTypeSelect).toHaveValue(initial.armorType);
      await expect(armorSheet.absorbsInput).toHaveValue(String(initial.absorbs));
      await expect(armorSheet.costInput).toHaveValue(String(initial.cost));
      await expect(armorSheet.specialRulesTextarea).toHaveValue(
        initial.specialRules
      );

      // --- 1. armorType (leather → chain; armor.mjs lines 10-13) ---
      await armorSheet.armorTypeSelect.selectOption(updated.armorType);

      await expect
        .poll(() =>
          page.evaluate(
            ({ aid, iid }) =>
              game.actors.get(aid).items.get(iid).system.armorType,
            { aid: actorId, iid: itemId }
          )
        )
        .toBe(updated.armorType);

      // --- 2. absorbs ("protection" analog; armor.mjs line 14) ---
      await armorSheet.absorbsInput.fill(String(updated.absorbs));
      await armorSheet.absorbsInput.blur();

      await expect
        .poll(() =>
          page.evaluate(
            ({ aid, iid }) =>
              game.actors.get(aid).items.get(iid).system.absorbs,
            { aid: actorId, iid: itemId }
          )
        )
        .toBe(updated.absorbs);

      // --- 3. cost ("burden" analog; _fields.mjs line 27) ---
      await armorSheet.costInput.fill(String(updated.cost));
      await armorSheet.costInput.blur();

      await expect
        .poll(() =>
          page.evaluate(
            ({ aid, iid }) =>
              game.actors.get(aid).items.get(iid).system.cost,
            { aid: actorId, iid: itemId }
          )
        )
        .toBe(updated.cost);

      // --- 4. specialRules (StringField; armor.mjs line 15) ---
      await armorSheet.specialRulesTextarea.fill(updated.specialRules);
      await armorSheet.specialRulesTextarea.blur();

      await expect
        .poll(() =>
          page.evaluate(
            ({ aid, iid }) =>
              game.actors.get(aid).items.get(iid).system.specialRules,
            { aid: actorId, iid: itemId }
          )
        )
        .toBe(updated.specialRules);

      // Close + re-render the item sheet to verify values persist in the DOM.
      await page.evaluate(
        ({ aid, iid }) => {
          game.actors.get(aid).items.get(iid).sheet.close();
        },
        { aid: actorId, iid: itemId }
      );
      await expect(armorSheet.root).toHaveCount(0);

      await page.evaluate(
        ({ aid, iid }) => {
          game.actors.get(aid).items.get(iid).sheet.render(true);
        },
        { aid: actorId, iid: itemId }
      );

      const rerendered = new ArmorItemSheet(page, itemName);
      await rerendered.expectOpen();
      await expect(rerendered.armorTypeSelect).toHaveValue(updated.armorType);
      await expect(rerendered.absorbsInput).toHaveValue(String(updated.absorbs));
      await expect(rerendered.costInput).toHaveValue(String(updated.cost));
      await expect(rerendered.specialRulesTextarea).toHaveValue(
        updated.specialRules
      );

      // Final authoritative check against the data model.
      const persisted = await page.evaluate(
        ({ aid, iid }) => {
          const it = game.actors.get(aid).items.get(iid);
          return {
            armorType: it.system.armorType,
            absorbs: it.system.absorbs,
            cost: it.system.cost,
            specialRules: it.system.specialRules,
          };
        },
        { aid: actorId, iid: itemId }
      );
      expect(persisted).toEqual(updated);
    } finally {
      await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
    }
  });
});
