import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { CompendiumWindow } from '../pages/CompendiumWindow.mjs';
import { CharacterSheet } from '../pages/CharacterSheet.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §8 Compendiums — drag a weapon from the `tb2e.weapons` pack onto a
 * character sheet inventory.
 *
 * Contract: dropping a pack entry onto the inventory tab should materialize
 * a new embedded Item on the actor whose system fields reflect the pack
 * source. The drop goes through ActorSheetV2's base `_onDrop*` pipeline and
 * the character sheet's override at
 *   module/applications/actor/character-sheet.mjs:2008 (#_onDropItem).
 * That override delegates to `super._onDropItem` (which calls
 * `Actor.createEmbeddedDocuments('Item', [src.toObject()])` under the hood
 * for cross-document drops) and, if the drop target has a `data-slot-key`
 * ancestor, also assigns the item into that slot. When dropped on the tab
 * itself (not a slot cell) the item lands as "unassigned" — `system.slot`
 * stays `""` and `system.dropped` stays `false`.
 *
 * Source weapon: `Sword` (packs/_source/weapons/Sword_026b10bdba9bf1a4.yml).
 * Sword is a stable, low-risk entry with well-known system fields
 * (type: weapon, cost: 3, wield: 1, slotOptions.carried/belt) we can
 * assert against.
 *
 * Approach: programmatic drop via the sheet's `_onDropItem(event, item)`
 * entrypoint (character-sheet.mjs:2008). We resolve the compendium entry
 * to an Item document in the page context and invoke the handler directly
 * with a synthetic DragEvent whose `target` is the inventory tab section
 * (no `[data-slot-key]` ancestor, so the handler leaves the item
 * unassigned). Playwright's native `dragTo` is flaky against AppV2 sheet
 * windows — it works for the Actors sidebar (tests/e2e/compendium-drag.spec.mjs)
 * but not reliably for the sheet's drop zone. Calling `_onDropItem`
 * directly exercises the same code path the UI drag would (super call
 * creates the embedded Item; override assigns slot if applicable) without
 * the native-drag synchronization problem.
 *
 * Narrow scope — out of scope for this spec (covered by sibling specs
 * queued in §8):
 *   - drag-to-scene (drag-monster-to-scene.spec.mjs)
 *   - drag-into-specific-slot (drag-relic-to-slot.spec.mjs)
 *   - search / filter (search-filter.spec.mjs)
 */
const WEAPON_NAME = 'Sword';
const WEAPON_ID = '026b10bdba9bf1a4'; // packs/_source/weapons/Sword_026b10bdba9bf1a4.yml
const WEAPONS_PACK = 'tb2e.weapons';

test.describe('Compendium drag weapon to character inventory', () => {
  test('dropping a pack weapon onto the inventory tab creates an embedded Item', async ({ page }) => {
    const actorName = `E2E WeaponDrop ${Date.now()}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Create a fresh character with no items so the dropped weapon is
    // unambiguously identifiable (only item on the actor post-drop).
    const actorId = await page.evaluate(async (n) => {
      const actor = await Actor.create({ name: n, type: 'character' });
      return actor.id;
    }, actorName);
    expect(actorId).toBeTruthy();

    try {
      // Snapshot the pack entry's source data — we'll assert the created
      // item's system fields match. Fetched via the compendium collection,
      // which is the same source the drop handler ultimately copies from.
      const source = await page.evaluate(async ({ packId, entryId }) => {
        const pack = window.game.packs.get(packId);
        if (!pack) throw new Error(`Pack not found: ${packId}`);
        const entry = await pack.getDocument(entryId);
        if (!entry) throw new Error(`Entry "${entryId}" not found in ${packId}`);
        const obj = entry.toObject();
        return {
          name: obj.name,
          type: obj.type,
          cost: obj.system?.cost,
          wield: obj.system?.wield,
          slotOptions: obj.system?.slotOptions,
        };
      }, { packId: WEAPONS_PACK, entryId: WEAPON_ID });
      expect(source.name).toBe(WEAPON_NAME);
      expect(source.type).toBe('weapon');

      // Open the sheet and land on the inventory tab (the drop target).
      await page.evaluate((id) => {
        window.game.actors.get(id).sheet.render(true);
      }, actorId);

      const sheet = new CharacterSheet(page, actorName);
      await sheet.expectOpen();
      await sheet.openInventoryTab();

      // Pre-state: the actor has no items.
      const initialItemCount = await page.evaluate(
        (id) => window.game.actors.get(id).items.size,
        actorId
      );
      expect(initialItemCount).toBe(0);

      // Open the weapons compendium window too, so the spec exercises the
      // same user-visible surface that precedes a real drag (pack renders
      // → entry row is listed). Render the pack's Compendium application
      // programmatically — the sidebar wraps `tb2e.weapons` inside the
      // "Equipment" folder, which is collapsed by default; expanding folders
      // via DOM clicks is brittle and adds no coverage beyond what the
      // open-each-pack sibling spec already asserts.
      await page.evaluate(async (packId) => {
        const pack = window.game.packs.get(packId);
        await pack.render(true);
      }, WEAPONS_PACK);

      const compWindow = new CompendiumWindow(page, WEAPONS_PACK);
      await compWindow.waitForOpen();

      // Use entryById — the compendium contains both "Sword" and
      // "Great Sword", so entryByName (hasText) is ambiguous.
      const entry = compWindow.entryById(WEAPON_ID);
      await expect(entry).toBeVisible();
      await expect(entry).toContainText(WEAPON_NAME);

      // Drop target: the inventory tab section (not any specific slot cell,
      // so the handler leaves the item unassigned per the comment above).
      const inventorySection = sheet.root.locator('section[data-tab="inventory"].active');
      await expect(inventorySection).toBeVisible();

      // Programmatic drop — invoke the sheet's `_onDropItem` handler with the
      // compendium-sourced Item and a synthetic event whose target is the
      // inventory section (no [data-slot-key] ancestor → unassigned).
      const dropResult = await page.evaluate(
        async ({ id, packId, entryId }) => {
          const actor = window.game.actors.get(id);
          const sheetApp = actor.sheet;
          const pack = window.game.packs.get(packId);
          const item = await pack.getDocument(entryId);
          if (!item) throw new Error(`Entry "${entryId}" not found in ${packId}`);
          // The inventory section is the drop target; character-sheet.mjs:2010
          // uses `event.target.closest('[data-slot-key]')` and returns null
          // when the target has no slot ancestor — the desired unassigned case.
          const target = sheetApp.element.querySelector('section[data-tab="inventory"].active');
          if (!target) throw new Error("inventory tab section not found");
          const event = new DragEvent("drop", { bubbles: true, cancelable: true });
          Object.defineProperty(event, "target", { value: target });
          const created = await sheetApp._onDropItem(event, item);
          return {
            createdId: Array.isArray(created) ? created[0]?.id : created?.id,
            createdName: Array.isArray(created) ? created[0]?.name : created?.name,
            itemCount: actor.items.size,
          };
        },
        { id: actorId, packId: WEAPONS_PACK, entryId: WEAPON_ID }
      );
      expect(dropResult.createdName, `drop failed: ${JSON.stringify(dropResult)}`).toBe(WEAPON_NAME);
      expect(dropResult.itemCount).toBe(1);

      // Wait for the item to land on the actor.
      await expect
        .poll(
          () =>
            page.evaluate(
              ({ id, name }) => {
                const items = window.game.actors
                  .get(id)
                  .items.filter((i) => i.type === 'weapon' && i.name === name);
                return items.length;
              },
              { id: actorId, name: WEAPON_NAME }
            ),
          { timeout: 10_000 }
        )
        .toBe(1);

      // Data-model assertions: the embedded item matches the pack source and
      // is unassigned by default (slot empty, not dropped).
      const created = await page.evaluate(
        ({ id, name }) => {
          const item = window.game.actors
            .get(id)
            .items.find((i) => i.type === 'weapon' && i.name === name);
          if (!item) return null;
          return {
            id: item.id,
            name: item.name,
            type: item.type,
            cost: item.system.cost,
            wield: item.system.wield,
            slot: item.system.slot,
            slotIndex: item.system.slotIndex,
            dropped: item.system.dropped,
            slotOptions: item.system.slotOptions,
          };
        },
        { id: actorId, name: WEAPON_NAME }
      );
      expect(created).not.toBeNull();
      expect(created.type).toBe('weapon');
      expect(created.name).toBe(WEAPON_NAME);
      expect(created.cost).toBe(source.cost);
      expect(created.wield).toBe(source.wield);
      // Unassigned default — matches #_onDropItem's behavior when the drop
      // target has no [data-slot-key] ancestor.
      expect(created.slot).toBe('');
      expect(created.slotIndex).toBe(0);
      expect(created.dropped).toBe(false);
      // slotOptions copied verbatim from the compendium source — verifies
      // we didn't accidentally strip/transform pack data during the drop.
      expect(created.slotOptions).toEqual(source.slotOptions);

      // DOM assertion: the new item shows up in the unassigned section.
      await expect(sheet.unassignedSection).toBeVisible();
      await expect(sheet.unassignedItemRow(created.id)).toBeVisible();
    } finally {
      await page.evaluate((id) => window.game.actors.get(id)?.delete(), actorId);
    }
  });
});
