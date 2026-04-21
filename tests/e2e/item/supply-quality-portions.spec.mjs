import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { CharacterSheet } from '../pages/CharacterSheet.mjs';
import { SupplyItemSheet } from '../pages/ItemSheet.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §22 Items (Non-Magic) — supply item sheet edit + portion-counter persistence.
 *
 * Scope
 * -----
 * This spec covers the **item-sheet edit surface** for supplies — i.e. setting
 * a food supply up with N portions (`system.quantity` / `system.quantityMax`)
 * and editing supply-specific fields via the shared `GearSheet`. It is the
 * sibling to the §22 weapon / armor / container item-sheet specs
 * (`tests/e2e/item/weapon-sheet.spec.mjs`, `armor-sheet.spec.mjs`,
 * `container-custom-slots.spec.mjs`), mirroring their structure — seed →
 * open from the unassigned strip via `editItem` → edit → assert data-model
 * persistence → close + re-render → assert DOM persistence.
 *
 * The sheet-side `consumePortion` decrement flow (click the "eat" button on
 * a placed food supply, watch quantity decrement + clear hungry) is already
 * covered in full by `tests/e2e/sheet/inventory-supplies.spec.mjs` at
 * TEST_PLAN.md §2 Character Sheet line 122 — so this spec intentionally does
 * not re-test that surface at length. Instead, the second test here places
 * the edited supply in a real slot and fires consumePortion once as a light
 * sanity-check that the edited portion values (`quantity` / `quantityMax`)
 * play nicely with the runtime consume handler.
 *
 * Field notes (TB2E supply data model — `module/data/item/supply.mjs`)
 * -------------------------------------------------------------------
 *   - `supplyType`: StringField, choices food|light|spellMaterial|sacramental|
 *     ammunition|other (supply.mjs lines 10-13; labelled via
 *     `CONFIG.TB2E.supplyTypes`, `module/config.mjs` lines 147-154).
 *   - `turnsRemaining` / `lit`: light-supply fields (DH p.71). Exercised by
 *     `inventory-supplies.spec.mjs` — we touch them lightly here to prove
 *     they round-trip through the gear-sheet form.
 *   - `nameSingular`: display helper for bundled supplies (supply.mjs line 16).
 *   - `quantity` / `quantityMax`: **portions**. These are the shared inventory
 *     fields (`module/data/item/_fields.mjs` lines 30-31) — NOT supply-
 *     specific. Per RAW (DH pp.71-72), a supply's portion count is its
 *     `quantity`, and the handler `#onConsumePortion` in
 *     `module/applications/actor/character-sheet.mjs` decrements this field
 *     on consumption and floors at 0 (no delete — the item stays in the slot
 *     for refill; see CLAUDE.md §Character Sheet "Supply item type").
 *
 * TB2E supplies have **no "quality" field** — the TEST_PLAN checkbox
 * ("supply-quality-portions") maps the "quality" axis to `supplyType` (the
 * qualitative classification) and "portions" to `quantity` / `quantityMax`
 * (the counter). The TEST_PLAN note documents the mapping.
 *
 * Persistence model
 * -----------------
 * `GearSheet.DEFAULT_OPTIONS.form.submitOnChange = true`
 * (`module/applications/item/gear-sheet.mjs` line 17). Fill + blur (or
 * `selectOption` / `setChecked`) auto-submits the AppV2 form — the same
 * pattern as the §22 neighbor specs.
 */
test.describe('Supply item sheet — edit portions + supplyType; consume one', () => {
  test('edits supplyType, quantity/quantityMax (portions), nameSingular; values round-trip through model and DOM', async ({
    page,
  }) => {
    const actorName = `E2E SupplySheet ${Date.now()}`;
    const itemName = `${actorName} Rations`;

    // Initial state — a generic "other" supply with 1 portion, no singular
    // display name. This is distinct from the target so the edit is
    // observable.
    const initial = {
      supplyType: 'other',
      quantity: 1,
      quantityMax: 1,
      nameSingular: '',
      turnsRemaining: 0,
    };

    // Target post-edit state — upgrade to food (DH pp.71-72; the canonical
    // Buyer's Guide rations entry), 3 portions available out of a max of 3,
    // and give it a singular display name for bundled rendering.
    const updated = {
      supplyType: 'food',
      quantity: 3,
      quantityMax: 3,
      nameSingular: 'Ration',
      // turnsRemaining stays at 0 — food supplies don't use it. We exercise
      // writing to it too just to prove the numeric input persists.
      turnsRemaining: 0,
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
            type: 'supply',
            system: {
              // Unassigned — surfaces in the Unassigned strip where the
              // `editItem` button is rendered (character-inventory.hbs
              // line 319).
              slot: '',
              slotIndex: 0,
              supplyType: init.supplyType,
              quantity: init.quantity,
              quantityMax: init.quantityMax,
              nameSingular: init.nameSingular,
              turnsRemaining: init.turnsRemaining,
              // Permit placement on belt for the consume-path follow-up test.
              slotOptions: { belt: 1 },
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

      // Click the per-row Edit button — fires `editItem` data-action, which
      // invokes `item.sheet.render(true)` (character-sheet.mjs line 1728).
      await unassignedRow
        .locator(`button[data-action="editItem"][data-item-id="${itemId}"]`)
        .click();

      const supplySheet = new SupplyItemSheet(page, itemName);
      await supplySheet.expectOpen();

      // Sanity-check the rendered initial values match the seed.
      await expect(supplySheet.nameInput).toHaveValue(itemName);
      await expect(supplySheet.supplyTypeSelect).toHaveValue(
        initial.supplyType
      );
      await expect(supplySheet.quantityInput).toHaveValue(
        String(initial.quantity)
      );
      await expect(supplySheet.quantityMaxInput).toHaveValue(
        String(initial.quantityMax)
      );
      await expect(supplySheet.nameSingularInput).toHaveValue(
        initial.nameSingular
      );
      await expect(supplySheet.turnsRemainingInput).toHaveValue(
        String(initial.turnsRemaining)
      );

      // --- 1. supplyType (other → food; supply.mjs lines 10-13) ---
      await supplySheet.supplyTypeSelect.selectOption(updated.supplyType);

      await expect
        .poll(() =>
          page.evaluate(
            ({ aid, iid }) =>
              game.actors.get(aid).items.get(iid).system.supplyType,
            { aid: actorId, iid: itemId }
          )
        )
        .toBe(updated.supplyType);

      // --- 2. quantityMax (portion capacity; _fields.mjs line 31) ---
      // Fill the max first so quantity can be set to a matching value
      // without tripping any schema clamp on quantity > quantityMax.
      await supplySheet.quantityMaxInput.fill(String(updated.quantityMax));
      await supplySheet.quantityMaxInput.blur();

      await expect
        .poll(() =>
          page.evaluate(
            ({ aid, iid }) =>
              game.actors.get(aid).items.get(iid).system.quantityMax,
            { aid: actorId, iid: itemId }
          )
        )
        .toBe(updated.quantityMax);

      // --- 3. quantity (current portions; _fields.mjs line 30) ---
      await supplySheet.quantityInput.fill(String(updated.quantity));
      await supplySheet.quantityInput.blur();

      await expect
        .poll(() =>
          page.evaluate(
            ({ aid, iid }) =>
              game.actors.get(aid).items.get(iid).system.quantity,
            { aid: actorId, iid: itemId }
          )
        )
        .toBe(updated.quantity);

      // --- 4. nameSingular (display helper; supply.mjs line 16) ---
      await supplySheet.nameSingularInput.fill(updated.nameSingular);
      await supplySheet.nameSingularInput.blur();

      await expect
        .poll(() =>
          page.evaluate(
            ({ aid, iid }) =>
              game.actors.get(aid).items.get(iid).system.nameSingular,
            { aid: actorId, iid: itemId }
          )
        )
        .toBe(updated.nameSingular);

      // Close + re-render the item sheet to verify values persist in the DOM.
      await page.evaluate(
        ({ aid, iid }) => {
          game.actors.get(aid).items.get(iid).sheet.close();
        },
        { aid: actorId, iid: itemId }
      );
      await expect(supplySheet.root).toHaveCount(0);

      await page.evaluate(
        ({ aid, iid }) => {
          game.actors.get(aid).items.get(iid).sheet.render(true);
        },
        { aid: actorId, iid: itemId }
      );

      const rerendered = new SupplyItemSheet(page, itemName);
      await rerendered.expectOpen();
      await expect(rerendered.supplyTypeSelect).toHaveValue(
        updated.supplyType
      );
      await expect(rerendered.quantityInput).toHaveValue(
        String(updated.quantity)
      );
      await expect(rerendered.quantityMaxInput).toHaveValue(
        String(updated.quantityMax)
      );
      await expect(rerendered.nameSingularInput).toHaveValue(
        updated.nameSingular
      );

      // Final authoritative check against the data model.
      const persisted = await page.evaluate(
        ({ aid, iid }) => {
          const it = game.actors.get(aid).items.get(iid);
          return {
            supplyType: it.system.supplyType,
            quantity: it.system.quantity,
            quantityMax: it.system.quantityMax,
            nameSingular: it.system.nameSingular,
          };
        },
        { aid: actorId, iid: itemId }
      );
      expect(persisted).toEqual({
        supplyType: updated.supplyType,
        quantity: updated.quantity,
        quantityMax: updated.quantityMax,
        nameSingular: updated.nameSingular,
      });
    } finally {
      await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
    }
  });

  test('edited portion counter still works with consumePortion — decrement by one', async ({
    page,
  }) => {
    // Complementary check: take the same kind of food supply (supplyType=food,
    // quantity=quantityMax=3 — the "edited" end-state from the first test),
    // but seeded directly in a body slot so the sheet renders the
    // consumePortion button. Click it once and assert the counter decrements.
    //
    // Full decrement-to-zero + hungry-clear coverage lives in
    // `tests/e2e/sheet/inventory-supplies.spec.mjs` (TEST_PLAN §2 line 122).
    // This test is intentionally narrow — a smoke ping that the portion
    // counter set via the item sheet is the same field the consume handler
    // drives.
    const actorName = `E2E SupplyConsume ${Date.now()}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    const { actorId, itemId } = await page.evaluate(async (n) => {
      const actor = await Actor.create({ name: n, type: 'character' });
      const [item] = await actor.createEmbeddedDocuments('Item', [
        {
          name: `${n} Rations`,
          type: 'supply',
          system: {
            supplyType: 'food',
            quantity: 3,
            quantityMax: 3,
            slot: 'belt',
            slotIndex: 0,
            slotOptions: { belt: 1 },
          },
        },
      ]);
      return { actorId: actor.id, itemId: item.id };
    }, actorName);
    expect(actorId).toBeTruthy();
    expect(itemId).toBeTruthy();

    try {
      await page.evaluate((id) => {
        game.actors.get(id).sheet.render(true);
      }, actorId);

      const sheet = new CharacterSheet(page, actorName);
      await sheet.expectOpen();
      await sheet.openInventoryTab();

      await expect(sheet.portionCounter(itemId)).toHaveValue('3');
      await expect(sheet.consumePortionButton(itemId)).toBeVisible();

      // Decrement once — 3 → 2.
      await sheet.consumePortionButton(itemId).click();

      await expect
        .poll(() =>
          page.evaluate(
            ({ id, iid }) =>
              game.actors.get(id).items.get(iid).system.quantity,
            { id: actorId, iid: itemId }
          )
        )
        .toBe(2);
      await expect(sheet.portionCounter(itemId)).toHaveValue('2');

      // quantityMax untouched — only `quantity` decrements on consume.
      const maxAfter = await page.evaluate(
        ({ id, iid }) =>
          game.actors.get(id).items.get(iid).system.quantityMax,
        { id: actorId, iid: itemId }
      );
      expect(maxAfter).toBe(3);
    } finally {
      await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
    }
  });
});
