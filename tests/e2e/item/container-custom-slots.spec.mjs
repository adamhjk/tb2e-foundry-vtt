import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { CharacterSheet } from '../pages/CharacterSheet.mjs';
import { ContainerItemSheet } from '../pages/ItemSheet.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §22 Items (Non-Magic) — container custom slot definitions render on the
 * character sheet inventory.
 *
 * Contract
 * --------
 * TB2E containers (`module/data/item/container.mjs`) carry three custom-
 * slot-defining fields:
 *   - `containerKey`: StringField (line 10). The slot-group key used when
 *     children reference the container as their `slot`. Falls back to the
 *     item id when empty (`module/applications/actor/character-sheet.mjs`
 *     line 438: `const cKey = c.system.containerKey || c.id`).
 *   - `containerSlots`: NumberField, initial 6, min 0, integer (line 11).
 *     The number of sub-slots the container provides when equipped
 *     (DH pp.71-74 — a backpack provides N Pack slots, a quiver provides
 *     N Quiver slots, etc.).
 *   - `containerType`: StringField, choices per container.mjs lines 12-17.
 *     Non-liquid types (backpack, satchel, largeSack, smallSack, pouch,
 *     quiver, framePack, barrel, cask, chestSmall, seaChest, clayPot,
 *     purse, woodenCanteen) provide slot groups; liquid types (waterskin,
 *     bottle, jug) do NOT (`character-sheet.mjs` line 437: `if
 *     (cType?.liquid) continue`).
 *
 * A container becomes its own dynamic slot group when ALL of these hold
 * (`character-sheet.mjs` lines 429-448):
 *   - `system.slot` is one of the fixed body slots
 *     (head/neck/hand-L/hand-R/torso/belt/feet/pocket — `#FIXED_SLOTS` line 15);
 *   - `system.dropped === false`;
 *   - `system.lost === false`;
 *   - `system.quantityMax === 1` (bundles — `quantityMax > 1` — stay as
 *     regular occupants inside whichever slot they're placed in; DH p.71-74
 *     bundled containers; see `tests/e2e/sheet/inventory-bundle-split.spec
 *     .mjs` for bundle semantics);
 *   - the container type is NOT flagged liquid (`CONFIG.TB2E.containerTypes`).
 *
 * When those conditions are met, the inventory tab renders an
 * `[data-slot-group="<containerKey>"]` group on the right column, with
 * exactly `system.containerSlots` `.inventory-slot[data-slot-index]` cells
 * inside, plus a container-drop/remove strip in the header
 * (`templates/actors/tabs/character-inventory.hbs` lines 165-176).
 *
 * Scope
 * -----
 * This spec verifies the *structural* contract — that the custom slot
 * count set on the container Item produces exactly that many sub-slot
 * cells on the character sheet. We exercise both:
 *
 *   1. Seed-time contract: create the container with `containerSlots=N1` +
 *      `containerKey=K`, place it in a fixed body slot, open the sheet,
 *      assert the slot-group exists with exactly N1 empty `.inventory-slot`
 *      cells and correct DOM attributes.
 *   2. Edit-time contract: open the container's item sheet (from the
 *      slot-group's edit/drop strip is NOT the path — use the #containerId
 *      directly via the Items directory; actually the header-level
 *      container-drop-btn/remove are not edit buttons. We go through the
 *      API here since the character-sheet container-group header has no
 *      edit button, and the #editItem path is only rendered for occupied
 *      *inner* slots), change `containerSlots` to N2, re-render the
 *      character sheet, and assert the slot-group now shows N2 cells.
 *
 * Out of scope:
 *   - Dropping items INTO the container's custom slots (slot-assignment
 *     mechanics; covered by `tests/e2e/sheet/inventory-slots.spec.mjs`).
 *   - Bundle split (`tests/e2e/sheet/inventory-bundle-split.spec.mjs`).
 *   - Liquid containers (they don't produce slot groups).
 */

/** Helper — delete an actor at the end of each test. */
async function deleteActor(page, actorId) {
  if ( !actorId ) return;
  await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
}

test.describe('Container item — custom slot definitions render on character sheet', () => {
  test('seed a backpack container with custom slot count; assert slot group and cell count', async ({
    page,
  }) => {
    const actorName = `E2E ContainerSlots ${Date.now()}`;
    const itemName = `${actorName} Backpack`;
    // RAW backpack from the Buyer's Guide (DH p.73 — backpack provides 6
    // pack slots, occupies 1 torso slot). `containerKey` is chosen to match
    // the RAW slug "pack".
    const containerKey = 'pack';
    const initialSlots = 5;
    const updatedSlots = 3;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Create an actor with one container placed on the torso (the canonical
    // spot for a backpack — DH p.73; also satisfies `#FIXED_SLOTS.has`).
    // `slotOptions.torso` lets the placement be legal if ever re-derived.
    // `quantityMax: 1` forces the "own slot group" branch rather than
    // bundle-as-occupant (character-sheet.mjs line 432).
    const { actorId, itemId } = await page.evaluate(
      async ({ n, iName, cKey, slots }) => {
        const actor = await Actor.create({ name: n, type: 'character' });
        const [item] = await actor.createEmbeddedDocuments('Item', [
          {
            name: iName,
            type: 'container',
            system: {
              slot: 'torso',
              slotIndex: 0,
              containerType: 'backpack',
              containerKey: cKey,
              containerSlots: slots,
              quantity: 1,
              quantityMax: 1,
              slotOptions: { torso: 1 },
            },
          },
        ]);
        return { actorId: actor.id, itemId: item.id };
      },
      { n: actorName, iName: itemName, cKey: containerKey, slots: initialSlots }
    );
    expect(actorId).toBeTruthy();
    expect(itemId).toBeTruthy();

    try {
      await page.evaluate((id) => {
        game.actors.get(id).sheet.render(true);
      }, actorId);

      const sheet = new CharacterSheet(page, actorName);
      await sheet.expectOpen();
      await sheet.openInventoryTab();

      // --- 1. Seed-time contract: custom slot count surfaces as N cells. ---
      // Slot group keyed by `containerKey` — character-sheet.mjs line 438
      // uses containerKey || id, so we get exactly the key we set.
      const group = sheet.inventorySlotGroup(containerKey);
      await expect(group).toBeVisible();

      // The group should carry the container-group class that the template
      // applies to dynamic container groups (inventory.hbs line 165).
      await expect(group).toHaveClass(/\bcontainer-group\b/);

      // Exactly `initialSlots` inner `.inventory-slot` cells — one per
      // index 0..N-1, all empty (the container has no children yet).
      const cells = group.locator('.inventory-slot');
      await expect(cells).toHaveCount(initialSlots);

      for ( let i = 0; i < initialSlots; i++ ) {
        const cell = sheet.inventorySlot(containerKey, i);
        await expect(cell).toBeVisible();
        await expect(cell).toHaveClass(/\bempty\b/);
        await expect(cell).toHaveAttribute('data-slot-key', containerKey);
        await expect(cell).toHaveAttribute('data-slot-index', String(i));
      }

      // Group header contains the container drop + remove buttons keyed by
      // the container's id (inventory.hbs lines 172-175).
      await expect(
        group.locator(
          `button.container-drop-btn[data-action="dropItem"][data-item-id="${itemId}"]`
        )
      ).toBeVisible();
      await expect(
        group.locator(
          `button.container-remove-btn[data-action="removeFromSlot"][data-item-id="${itemId}"]`
        )
      ).toBeVisible();

      // --- 2. Edit-time contract: change containerSlots and re-render. ---
      // Open the item sheet directly via the API (the group header's
      // strip has no edit affordance — only drop/remove — and the inner
      // empty cells offer no per-cell editItem either).
      await page.evaluate(
        ({ aid, iid }) => {
          game.actors.get(aid).items.get(iid).sheet.render(true);
        },
        { aid: actorId, iid: itemId }
      );

      const containerSheet = new ContainerItemSheet(page, itemName);
      await containerSheet.expectOpen();

      // Sanity-check the container-specific inputs rendered with the seeded
      // values (template lines 138-166).
      await expect(containerSheet.containerTypeSelect).toHaveValue('backpack');
      await expect(containerSheet.containerSlotsInput).toHaveValue(
        String(initialSlots)
      );
      await expect(containerSheet.containerKeyInput).toHaveValue(containerKey);

      // Change the slot count — submitOnChange (gear-sheet.mjs line 17)
      // flushes on blur.
      await containerSheet.containerSlotsInput.fill(String(updatedSlots));
      await containerSheet.containerSlotsInput.blur();

      // Wait for the data model to reflect the write before asserting DOM.
      await expect
        .poll(() =>
          page.evaluate(
            ({ aid, iid }) =>
              game.actors.get(aid).items.get(iid).system.containerSlots,
            { aid: actorId, iid: itemId }
          )
        )
        .toBe(updatedSlots);

      // Close the item sheet; the character sheet auto-re-renders through
      // Foundry's doc-update hooks, but we force a render to remove any
      // timing ambiguity.
      await containerSheet.close();

      // The character sheet may or may not have re-rendered already. Force
      // a re-render to ensure the group reflects the new containerSlots.
      await page.evaluate((id) => {
        game.actors.get(id).sheet.render(true);
      }, actorId);

      // The character-sheet instance is the same DOM form — re-query.
      const sheet2 = new CharacterSheet(page, actorName);
      await sheet2.expectOpen();
      await sheet2.openInventoryTab();

      const group2 = sheet2.inventorySlotGroup(containerKey);
      await expect(group2).toBeVisible();

      // Cell count should now match the updated value, not the original.
      await expect
        .poll(async () =>
          group2.locator('.inventory-slot').count()
        )
        .toBe(updatedSlots);

      // Each remaining cell is empty and properly indexed.
      for ( let i = 0; i < updatedSlots; i++ ) {
        const cell = sheet2.inventorySlot(containerKey, i);
        await expect(cell).toBeVisible();
        await expect(cell).toHaveClass(/\bempty\b/);
      }

      // Final authoritative check against the data model.
      const persisted = await page.evaluate(
        ({ aid, iid }) => {
          const it = game.actors.get(aid).items.get(iid);
          return {
            containerKey: it.system.containerKey,
            containerSlots: it.system.containerSlots,
            containerType: it.system.containerType,
            slot: it.system.slot,
          };
        },
        { aid: actorId, iid: itemId }
      );
      expect(persisted).toEqual({
        containerKey,
        containerSlots: updatedSlots,
        containerType: 'backpack',
        slot: 'torso',
      });
    } finally {
      await deleteActor(page, actorId);
    }
  });
});
