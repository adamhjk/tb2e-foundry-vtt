import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { CompendiumWindow } from '../pages/CompendiumWindow.mjs';
import { CharacterSheet } from '../pages/CharacterSheet.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §8 Compendiums — drag a relic from the `tb2e.theurge-relics` pack directly
 * into a specific body slot on a character sheet.
 *
 * Contract: the character sheet's `_onDropItem` override at
 *   module/applications/actor/character-sheet.mjs:2008
 * reads `event.target.closest("[data-slot-key]")` to detect a slot-placement
 * drop (character-sheet.mjs:2010). When the drop target element is inside
 * an `.inventory-slot[data-slot-key][data-slot-index]` cell, `super._onDropItem`
 * creates the embedded Item and `#assignSlot` (character-sheet.mjs:1910) then
 * validates `slotOptions` / capacity and writes
 *   { system.slot: <key>, system.slotIndex: <n>, system.dropped: false }
 * (character-sheet.mjs:1968). This is the "slotted, not dropped" state that
 * invocation-relic auto-detection depends on per CLAUDE.md §Conflict.
 *
 * Source relic: `Pearl` (packs/_source/theurge-relics/Pearl_b000000000000007.yml).
 * Pearl is a stable minor relic with `slotOptions: { pocket: 1 }` — a
 * single-capacity body slot, making the slot-placement assertion unambiguous.
 *
 * Approach: mirrors drag-weapon-to-inventory.spec.mjs — programmatic drop via
 * `_onDropItem(event, item)` with a synthetic DragEvent whose target is the
 * `.inventory-slot[data-slot-key="pocket"][data-slot-index="0"]` cell so the
 * override routes into the slot-assignment branch. Playwright's native
 * `dragTo` is flaky against AppV2 sheet windows (covered in §8 prior art);
 * calling `_onDropItem` directly exercises the identical code path.
 *
 * Out of scope: invocation-relic linking (§7 — invocation/perform-with-relic),
 * un-slotting relics (§6 — inventory-slots), and relic item-sheet field tests.
 */
const RELIC_NAME = 'Pearl';
const RELIC_ID = 'b000000000000007'; // packs/_source/theurge-relics/Pearl_b000000000000007.yml
const RELICS_PACK = 'tb2e.theurge-relics';
const TARGET_SLOT = 'pocket'; // Pearl's slotOptions is { pocket: 1 } — only legal body slot
const TARGET_SLOT_INDEX = 0; // pocket has capacity 1 (character-sheet.mjs:1990)

test.describe('Compendium drag relic into character slot', () => {
  test('dropping a pack relic onto an inventory slot cell places it in that slot', async ({ page }) => {
    const actorName = `E2E RelicDrop ${Date.now()}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Fresh character with no items so the dropped relic is unambiguously
    // identifiable (only item on the actor post-drop).
    const actorId = await page.evaluate(async (n) => {
      const actor = await Actor.create({ name: n, type: 'character' });
      return actor.id;
    }, actorName);
    expect(actorId).toBeTruthy();

    try {
      // Snapshot the pack entry's source data — we'll assert the created
      // item's system fields match the compendium source.
      const source = await page.evaluate(async ({ packId, entryId }) => {
        const pack = window.game.packs.get(packId);
        if (!pack) throw new Error(`Pack not found: ${packId}`);
        const entry = await pack.getDocument(entryId);
        if (!entry) throw new Error(`Entry "${entryId}" not found in ${packId}`);
        const obj = entry.toObject();
        return {
          name: obj.name,
          type: obj.type,
          relicTier: obj.system?.relicTier,
          immortal: obj.system?.immortal,
          linkedInvocations: obj.system?.linkedInvocations,
          slotOptions: obj.system?.slotOptions,
        };
      }, { packId: RELICS_PACK, entryId: RELIC_ID });
      expect(source.name).toBe(RELIC_NAME);
      expect(source.type).toBe('relic');
      // Sanity: the source relic's slotOptions must include the target slot,
      // otherwise `#assignSlot` would warn and no-op (character-sheet.mjs:1921).
      expect(source.slotOptions).toHaveProperty(TARGET_SLOT);

      // Open the sheet and land on the inventory tab (the drop target).
      await page.evaluate((id) => {
        window.game.actors.get(id).sheet.render(true);
      }, actorId);

      const sheet = new CharacterSheet(page, actorName);
      await sheet.expectOpen();
      await sheet.openInventoryTab();

      // Pre-state: the actor has no items, and the target slot cell renders
      // empty with no `data-item-id`.
      const initialItemCount = await page.evaluate(
        (id) => window.game.actors.get(id).items.size,
        actorId
      );
      expect(initialItemCount).toBe(0);

      const targetSlotCell = sheet.inventorySlot(TARGET_SLOT, TARGET_SLOT_INDEX);
      await expect(targetSlotCell).toBeVisible();
      await expect(targetSlotCell).toHaveClass(/\bempty\b/);
      await expect(targetSlotCell).not.toHaveAttribute('data-item-id', /.+/);

      // Open the relics compendium window to exercise the same user-visible
      // surface that precedes a real drag. Render programmatically — the
      // sidebar nests the pack under a collapsible folder (same as weapons
      // in drag-weapon-to-inventory.spec.mjs).
      await page.evaluate(async (packId) => {
        const pack = window.game.packs.get(packId);
        await pack.render(true);
      }, RELICS_PACK);

      const compWindow = new CompendiumWindow(page, RELICS_PACK);
      await compWindow.waitForOpen();

      // Use entryById — `theurge-relics` has many entries and some relic
      // names are potentially substrings of others (e.g. "Sword of the Lady
      // of Valor" vs. plain "Sword" in a different pack).
      const entry = compWindow.entryById(RELIC_ID);
      await expect(entry).toBeVisible();
      await expect(entry).toContainText(RELIC_NAME);

      // Programmatic drop — target is the specific slot cell so the override
      // routes into `#assignSlot` (character-sheet.mjs:2023-2027).
      const dropResult = await page.evaluate(
        async ({ id, packId, entryId, slotKey, slotIndex }) => {
          const actor = window.game.actors.get(id);
          const sheetApp = actor.sheet;
          const pack = window.game.packs.get(packId);
          const item = await pack.getDocument(entryId);
          if (!item) throw new Error(`Entry "${entryId}" not found in ${packId}`);
          // character-sheet.mjs:2010 — `event.target.closest("[data-slot-key]")`
          // must resolve to the cell we want. The `.inventory-slot` cell
          // itself carries `data-slot-key` + `data-slot-index`.
          const target = sheetApp.element.querySelector(
            `section[data-tab="inventory"] .inventory-slot[data-slot-key="${slotKey}"][data-slot-index="${slotIndex}"]`
          );
          if (!target) throw new Error(`slot cell ${slotKey}#${slotIndex} not found`);
          const event = new DragEvent("drop", { bubbles: true, cancelable: true });
          Object.defineProperty(event, "target", { value: target });
          const created = await sheetApp._onDropItem(event, item);
          return {
            createdId: Array.isArray(created) ? created[0]?.id : created?.id,
            createdName: Array.isArray(created) ? created[0]?.name : created?.name,
            itemCount: actor.items.size,
          };
        },
        {
          id: actorId,
          packId: RELICS_PACK,
          entryId: RELIC_ID,
          slotKey: TARGET_SLOT,
          slotIndex: TARGET_SLOT_INDEX,
        }
      );
      expect(dropResult.createdName, `drop failed: ${JSON.stringify(dropResult)}`).toBe(RELIC_NAME);
      expect(dropResult.itemCount).toBe(1);

      // Poll until the relic is owned by the actor and committed to the slot
      // (the slot write happens in a second `updateEmbeddedDocuments` call
      // at character-sheet.mjs:1979 after the super-create resolves).
      await expect
        .poll(
          () =>
            page.evaluate(
              ({ id, name, slot }) => {
                const items = window.game.actors
                  .get(id)
                  .items.filter((i) =>
                    i.type === 'relic' && i.name === name && i.system.slot === slot
                  );
                return items.length;
              },
              { id: actorId, name: RELIC_NAME, slot: TARGET_SLOT }
            ),
          { timeout: 10_000 }
        )
        .toBe(1);

      // Data-model assertions: the embedded item matches the pack source and
      // is correctly placed in the target slot (slot set, not dropped).
      const created = await page.evaluate(
        ({ id, name }) => {
          const item = window.game.actors
            .get(id)
            .items.find((i) => i.type === 'relic' && i.name === name);
          if (!item) return null;
          return {
            id: item.id,
            name: item.name,
            type: item.type,
            slot: item.system.slot,
            slotIndex: item.system.slotIndex,
            dropped: item.system.dropped,
            relicTier: item.system.relicTier,
            immortal: item.system.immortal,
            linkedInvocations: item.system.linkedInvocations,
            slotOptions: item.system.slotOptions,
          };
        },
        { id: actorId, name: RELIC_NAME }
      );
      expect(created).not.toBeNull();
      expect(created.type).toBe('relic');
      expect(created.name).toBe(RELIC_NAME);
      // Slot placement — the whole point of this spec.
      expect(created.slot).toBe(TARGET_SLOT);
      expect(created.slotIndex).toBe(TARGET_SLOT_INDEX);
      // "Slotted (not dropped)" is the state required by invocation-relic
      // auto-detection per CLAUDE.md §Conflict Invocations/Relics.
      expect(created.dropped).toBe(false);
      // Relic-specific fields copied verbatim from pack source.
      expect(created.relicTier).toBe(source.relicTier);
      expect(created.immortal).toBe(source.immortal);
      expect(created.linkedInvocations).toEqual(source.linkedInvocations);
      expect(created.slotOptions).toEqual(source.slotOptions);

      // DOM assertion: the target slot cell is now occupied by the new item
      // (not empty, carries `data-item-id=<new>`). Mirrors the occupied-slot
      // checks in tests/e2e/sheet/inventory-slots.spec.mjs:228-230.
      const occupiedCell = sheet.inventorySlot(TARGET_SLOT, TARGET_SLOT_INDEX);
      await expect(occupiedCell).toBeVisible();
      await expect(occupiedCell).toHaveAttribute('data-item-id', created.id);
      await expect(occupiedCell).not.toHaveClass(/\bempty\b/);
      await expect(occupiedCell).toContainText(RELIC_NAME);
      // The slotted item is not in the unassigned section (it's in a slot).
      await expect(sheet.unassignedSection).toHaveCount(0);
      await expect(sheet.droppedSection).toHaveCount(0);
    } finally {
      await page.evaluate((id) => window.game.actors.get(id)?.delete(), actorId);
    }
  });
});
