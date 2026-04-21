import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { CharacterSheet } from '../pages/CharacterSheet.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * DH pp.71–74 — inventory slots. Each character has 8 fixed body-slot groups
 * (head, neck, hand-L, hand-R, torso, belt, feet, pocket) plus dynamic slots
 * supplied by equipped containers and a 12-slot "cache" group. Items carry
 * `system.slot` (the slot-group key) + `system.slotIndex` (position within
 * the group) + `system.dropped` (bool; item is on the ground).
 *
 * Data-model facts (module/data/item/_fields.mjs — inventoryFields):
 *   - `slot`: StringField, initial "". When empty the item is "unassigned"
 *     (rendered in the unassigned section at the bottom of the tab).
 *   - `slotIndex`: NumberField, integer, min 0, initial 0.
 *   - `dropped`: BooleanField, initial false. When true the item is "on the
 *     ground" (rendered in the dropped section).
 *
 * Handler facts (module/applications/actor/character-sheet.mjs):
 *   - `#onRemoveFromSlot` writes `system.slot = ""` and `system.slotIndex = 0`.
 *     Children of a container keep their `slot` = the container key so they
 *     stay associated with the container when it is unequipped. For normal
 *     items, the item lands in the "Unassigned" bucket (the unassigned
 *     section renders every item with empty slot and dropped=false).
 *   - `#onDropItem` writes `system.slot = ""`, `system.slotIndex = 0`,
 *     `system.dropped = true`. For containers, also sets dropped=true on
 *     each child still inside (but children keep their slot/slotIndex so
 *     they remain "inside" the dropped container).
 *   - `#onPickUpItem` writes `system.dropped = false` on the item. For
 *     containers, also clears `dropped` on every child that still references
 *     the container's containerKey. Importantly, picking up does NOT
 *     reassign to a specific slot — the item lands in the "Unassigned"
 *     bucket with its previous `slot`/`slotIndex` still empty (they were
 *     cleared by #onDropItem). Any re-placement happens through the
 *     separate `placeItem` action (not exercised here).
 *
 * Template facts (templates/actors/tabs/character-inventory.hbs):
 *   - Occupied slot cells render `.inventory-slot[data-slot-key][data-slot-index][data-item-id]`.
 *     The action strip inside an occupied cell offers `editItem` + `removeFromSlot`
 *     only — there is no per-slot `dropItem` button for non-container items.
 *   - The dropItem action appears:
 *       (a) on unassigned items (`.inventory-unassigned .slot-actions button[data-action="dropItem"]`)
 *       (b) on container slot-group headers (`.container-drop-btn`)
 *   - The pickUpItem action appears on every dropped-item card
 *     (`.inventory-dropped .slot-actions button[data-action="pickUpItem"]`).
 *   - Empty slots render `.inventory-slot.empty[data-slot-key][data-slot-index]`
 *     with no `data-item-id` attribute.
 *
 * Scope: exercise each of the three slot-lifecycle actions in isolation,
 * verifying BOTH the Item data-model field transitions and the DOM reflects
 * the move (slot cell empty, item listed in dropped/unassigned section).
 * Containers and cascade-to-children behaviour are out of scope for this
 * spec; the inventory system has dedicated coverage there elsewhere.
 */
test.describe('Character sheet inventory slot actions', () => {
  test('dropItem clears slot fields and sets dropped=true', async ({ page }) => {
    const actorName = `E2E InvDrop ${Date.now()}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Create an actor with one unassigned weapon. Start unassigned because
    // the `dropItem` action is only exposed in the unassigned-items strip
    // (see template notes above). slotOptions.wornHand=1 lets us assert the
    // item can legally live in hand-R later if we wanted to (not exercised).
    const { actorId, itemId } = await page.evaluate(async (n) => {
      const actor = await Actor.create({ name: n, type: 'character' });
      const [item] = await actor.createEmbeddedDocuments('Item', [{
        name: `${n} Sword`,
        type: 'weapon',
        system: {
          // Explicit empty slot — unassigned. dropped defaults to false.
          slot: '', slotIndex: 0,
          slotOptions: { wornHand: 1, carried: 1 }
        }
      }]);
      return { actorId: actor.id, itemId: item.id };
    }, actorName);
    expect(actorId).toBeTruthy();
    expect(itemId).toBeTruthy();

    await page.evaluate((id) => {
      game.actors.get(id).sheet.render(true);
    }, actorId);

    const sheet = new CharacterSheet(page, actorName);
    await sheet.expectOpen();
    await sheet.openInventoryTab();

    // Pre-state: item appears in the unassigned strip, not the dropped strip.
    await expect(sheet.unassignedItemRow(itemId)).toBeVisible();
    await expect(sheet.droppedSection).toHaveCount(0);

    // Click drop.
    await expect(sheet.dropItemButton(itemId)).toBeVisible();
    await sheet.dropItemButton(itemId).click();

    // Data-model assertion: slot cleared, dropped=true.
    await expect
      .poll(() =>
        page.evaluate(({ id, iid }) => {
          const it = game.actors.get(id).items.get(iid);
          return {
            slot: it.system.slot, slotIndex: it.system.slotIndex, dropped: it.system.dropped
          };
        }, { id: actorId, iid: itemId })
      )
      .toEqual({ slot: '', slotIndex: 0, dropped: true });

    // DOM assertion: item is now in the dropped section and has a pickUp button.
    await expect(sheet.droppedSection).toBeVisible();
    await expect(sheet.droppedItemRow(itemId)).toBeVisible();
    await expect(sheet.pickUpItemButton(itemId)).toBeVisible();

    await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
  });

  test('pickUpItem clears dropped flag; item returns to unassigned', async ({ page }) => {
    const actorName = `E2E InvPickUp ${Date.now()}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Seed the item already in the dropped state (same end-state as after
    // #onDropItem: empty slot + dropped=true). This keeps the test focused
    // on the pickUp handler without relying on drop behaving correctly.
    const { actorId, itemId } = await page.evaluate(async (n) => {
      const actor = await Actor.create({ name: n, type: 'character' });
      const [item] = await actor.createEmbeddedDocuments('Item', [{
        name: `${n} Lantern`,
        type: 'gear',
        system: {
          slot: '', slotIndex: 0, dropped: true,
          slotOptions: { carried: 1, pack: 1, pocket: 1 }
        }
      }]);
      return { actorId: actor.id, itemId: item.id };
    }, actorName);

    await page.evaluate((id) => {
      game.actors.get(id).sheet.render(true);
    }, actorId);

    const sheet = new CharacterSheet(page, actorName);
    await sheet.expectOpen();
    await sheet.openInventoryTab();

    // Pre-state: dropped section visible with our item.
    await expect(sheet.droppedSection).toBeVisible();
    await expect(sheet.droppedItemRow(itemId)).toBeVisible();

    // Sanity-check the seeded state on the Item itself.
    const pre = await page.evaluate(({ id, iid }) => {
      const it = game.actors.get(id).items.get(iid);
      return { slot: it.system.slot, slotIndex: it.system.slotIndex, dropped: it.system.dropped };
    }, { id: actorId, iid: itemId });
    expect(pre).toEqual({ slot: '', slotIndex: 0, dropped: true });

    // Click pick-up.
    await expect(sheet.pickUpItemButton(itemId)).toBeVisible();
    await sheet.pickUpItemButton(itemId).click();

    // Data-model: dropped flag cleared; slot/slotIndex remain empty (the
    // handler does NOT reassign to a slot, per character-sheet.mjs
    // #onPickUpItem — that's the placeItem handler's job).
    await expect
      .poll(() =>
        page.evaluate(({ id, iid }) => {
          const it = game.actors.get(id).items.get(iid);
          return {
            slot: it.system.slot, slotIndex: it.system.slotIndex, dropped: it.system.dropped
          };
        }, { id: actorId, iid: itemId })
      )
      .toEqual({ slot: '', slotIndex: 0, dropped: false });

    // DOM: item moved from dropped → unassigned; dropped section no longer
    // rendered (hasDropped is false when no items have dropped=true).
    await expect(sheet.unassignedSection).toBeVisible();
    await expect(sheet.unassignedItemRow(itemId)).toBeVisible();
    await expect(sheet.droppedSection).toHaveCount(0);

    await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
  });

  test('removeFromSlot clears slot fields; item moves from occupied slot to unassigned', async ({ page }) => {
    const actorName = `E2E InvRemove ${Date.now()}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Create an actor with a weapon placed in hand-R, index 0 (the "worn"
    // subslot per the hand-L/hand-R sublabels). slotOptions.wornHand must
    // be set so the placement is valid under the rules (_fields.mjs
    // resolveSlotOptionKey: slotIndex 0 in hand-L/R → "wornHand").
    const { actorId, itemId } = await page.evaluate(async (n) => {
      const actor = await Actor.create({ name: n, type: 'character' });
      const [item] = await actor.createEmbeddedDocuments('Item', [{
        name: `${n} Mace`,
        type: 'weapon',
        system: {
          slot: 'hand-R', slotIndex: 0,
          slotOptions: { wornHand: 1, carried: 1 }
        }
      }]);
      return { actorId: actor.id, itemId: item.id };
    }, actorName);

    await page.evaluate((id) => {
      game.actors.get(id).sheet.render(true);
    }, actorId);

    const sheet = new CharacterSheet(page, actorName);
    await sheet.expectOpen();
    await sheet.openInventoryTab();

    // Pre-state: hand-R index 0 is occupied with our item; it's NOT in the
    // unassigned or dropped sections.
    const handRSlot = sheet.inventorySlot('hand-R', 0);
    await expect(handRSlot).toBeVisible();
    await expect(handRSlot).toHaveAttribute('data-item-id', itemId);
    await expect(handRSlot).not.toHaveClass(/\bempty\b/);
    // The unassigned/dropped sections shouldn't render at all yet.
    await expect(sheet.unassignedSection).toHaveCount(0);
    await expect(sheet.droppedSection).toHaveCount(0);

    // Click remove-from-slot on the occupied hand-R cell.
    const removeBtn = sheet.removeFromSlotButton(itemId);
    await expect(removeBtn).toBeVisible();
    await removeBtn.click();

    // Data-model: slot cleared, slotIndex reset, dropped unchanged (false).
    await expect
      .poll(() =>
        page.evaluate(({ id, iid }) => {
          const it = game.actors.get(id).items.get(iid);
          return {
            slot: it.system.slot, slotIndex: it.system.slotIndex, dropped: it.system.dropped
          };
        }, { id: actorId, iid: itemId })
      )
      .toEqual({ slot: '', slotIndex: 0, dropped: false });

    // DOM: hand-R index 0 is empty again and has no data-item-id. The item
    // now appears in the unassigned section (not the dropped section).
    const emptiedSlot = sheet.inventorySlot('hand-R', 0);
    await expect(emptiedSlot).toHaveClass(/\bempty\b/);
    await expect(emptiedSlot).not.toHaveAttribute('data-item-id', /.+/);
    await expect(sheet.unassignedSection).toBeVisible();
    await expect(sheet.unassignedItemRow(itemId)).toBeVisible();
    await expect(sheet.droppedSection).toHaveCount(0);

    await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
  });
});
