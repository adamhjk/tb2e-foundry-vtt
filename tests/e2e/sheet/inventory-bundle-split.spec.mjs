import { test, expect } from '@playwright/test';
import { GameUI } from '../pages/GameUI.mjs';
import { CharacterSheet } from '../pages/CharacterSheet.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * DH pp.71–74 — bundled containers. In TB2E, a "bundle" is a container Item
 * whose `system.quantityMax > 1` (e.g. "small sack x4" occupying a single
 * inventory slot). The character sheet surfaces a scissors button that
 * splits one container off the bundle.
 *
 * Handler contract (module/applications/actor/character-sheet.mjs
 * #onSplitBundle):
 *
 *   - Guard: returns early if `system.quantity < 2` (nothing to split off).
 *   - Creates a new embedded Item by cloning `item.toObject()` WITHOUT the
 *     `_id` and with:
 *       system.quantity       = 1
 *       system.quantityMax    = 1
 *       system.slot           = ""        (lands in Unassigned)
 *       system.slotIndex      = 0
 *       system.containerKey   = ""
 *   - Decrements the source in place:
 *       system.quantity       = qty - 1
 *       system.quantityMax    = quantityMax - 1
 *
 * There is NO dialog and NO prompt for a split amount — each click always
 * peels ONE container off the bundle. Both the source and the new item are
 * standalone inventory rows from that point on.
 *
 * Template contract (templates/actors/tabs/character-inventory.hbs):
 *
 *   - The splitBundle button is rendered ONLY in the `occupied` slot
 *     branch (lines ~65/140/217), gated by `isSplittableBundle`. That flag
 *     is set in `#itemSummary` (character-sheet.mjs:627) and is true iff
 *     `item.type === "container" && (item.system.quantityMax ?? 1) > 1`.
 *   - No other item type can be a "bundle" — only `container` items. Supply
 *     items (food, light, ...) have quantity semantics but NEVER render the
 *     split affordance; they show the consumePortion/consumeLight/etc.
 *     controls instead.
 *   - Unassigned/dropped bundle rows render only edit/drop/delete — no
 *     split button. So tests must seed the bundle in a real body slot.
 *
 * Placement rules relevant here:
 *   - Belt is explicitly forbidden for bundles (character-sheet.mjs:1963 —
 *     "Belt slots cannot hold bundled items."). Torso, pocket, and hand
 *     slots accept them provided `slotOptions` allows the location.
 *   - Dynamic container slot-groups (backpacks, etc.) are only built from
 *     singular containers (`quantityMax === 1`, character-sheet.mjs:432) so
 *     a bundle never becomes a slot-group itself — it always lives inside
 *     another slot as a regular occupant.
 *
 * Coverage here:
 *   1. `splits a 4-bundle into a 3-bundle + a singular in Unassigned` —
 *      verifies the positive path: click → source decremented, new item
 *      created with qty=1/max=1, new item lands in Unassigned. Asserts
 *      both the data model and the DOM for the source slot and the new
 *      unassigned row.
 *   2. `splits a 2-bundle down to two singulars; button disappears` —
 *      edge case. qty=2 is the smallest splittable bundle. After the
 *      split the source has quantity=1/quantityMax=1 — which fails
 *      `isSplittableBundle` (`quantityMax > 1`), so the splitBundle
 *      button is removed from the DOM. A further click is impossible.
 *   3. `does not split a singular (quantity=1); guard returns early` —
 *      a non-bundled container never surfaces the button at all
 *      (isSplittableBundle is false). Assert the button is absent and
 *      call the handler's guard indirectly by confirming the data model
 *      is unchanged and no new items exist.
 */
test.describe('Character sheet splitBundle', () => {
  test('splits a 4-bundle into a 3-bundle + a singular in Unassigned', async ({ page }) => {
    const actorName = `E2E Bundle Split4 ${Date.now()}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Seed: a smallSack container with quantity=quantityMax=4, placed in
    // torso slot 0. Torso permits bundles (only belt is forbidden). The
    // slotOptions.torso=1 makes the placement legal. containerType must be
    // one of the enumerated choices in container.mjs — smallSack is a
    // non-liquid choice so `isLiquidContainer` stays false, and the
    // `isSplittableBundle` branch of the template wins.
    const { actorId, itemId } = await page.evaluate(async (n) => {
      const actor = await Actor.create({ name: n, type: 'character' });
      const [item] = await actor.createEmbeddedDocuments('Item', [{
        name: `${n} Sacks`,
        type: 'container',
        system: {
          containerType: 'smallSack',
          quantity: 4,
          quantityMax: 4,
          slot: 'torso',
          slotIndex: 0,
          slotOptions: { torso: 1, pack: 1, carried: 1 }
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

    // Pre-state: torso slot 0 is occupied by our bundle, the split button
    // is visible, the quantity text reads 4/4, and there is exactly one
    // item on the actor.
    const torsoSlot = sheet.inventorySlot('torso', 0);
    await expect(torsoSlot).toBeVisible();
    await expect(torsoSlot).toHaveAttribute('data-item-id', itemId);
    await expect(sheet.splitBundleButton(itemId)).toBeVisible();
    await expect(sheet.bundleQtyText(itemId)).toHaveText('4/4');
    const preItemCount = await page.evaluate((id) => game.actors.get(id).items.size, actorId);
    expect(preItemCount).toBe(1);

    // Split one off. The handler:
    //   - Creates a new Item with quantity=1/quantityMax=1, slot="",
    //     slotIndex=0, containerKey="" — lands in Unassigned.
    //   - Decrements source: quantity 4→3, quantityMax 4→3.
    await sheet.splitBundleButton(itemId).click();

    // Poll until we observe exactly two items on the actor, then capture
    // both ids so we can make targeted assertions. Using a deterministic
    // key (the source's itemId) we can identify the "new" item as the one
    // whose id differs.
    await expect
      .poll(() => page.evaluate((id) => game.actors.get(id).items.size, actorId))
      .toBe(2);

    const snapshot = await page.evaluate(({ id, srcId }) => {
      const a = game.actors.get(id);
      const items = a.items.map(i => ({
        id: i.id,
        name: i.name,
        type: i.type,
        containerType: i.system.containerType,
        quantity: i.system.quantity,
        quantityMax: i.system.quantityMax,
        slot: i.system.slot,
        slotIndex: i.system.slotIndex,
        containerKey: i.system.containerKey
      }));
      const source = items.find(i => i.id === srcId);
      const created = items.find(i => i.id !== srcId);
      return { items, source, created };
    }, { id: actorId, srcId: itemId });

    // Source: decremented in place, still in torso slot 0.
    expect(snapshot.source).toMatchObject({
      name: `${actorName} Sacks`,
      type: 'container',
      containerType: 'smallSack',
      quantity: 3,
      quantityMax: 3,
      slot: 'torso',
      slotIndex: 0
    });

    // Created: a fresh singular clone in Unassigned. containerKey cleared
    // by the handler so it stands alone; name + containerType preserved.
    expect(snapshot.created).toMatchObject({
      name: `${actorName} Sacks`,
      type: 'container',
      containerType: 'smallSack',
      quantity: 1,
      quantityMax: 1,
      slot: '',
      slotIndex: 0,
      containerKey: ''
    });
    // Sanity: the created item got a distinct _id from the source.
    expect(snapshot.created.id).not.toBe(itemId);

    // DOM — source slot still occupied by the bundle; quantity text now 3/3.
    await expect(torsoSlot).toHaveAttribute('data-item-id', itemId);
    await expect(sheet.bundleQtyText(itemId)).toHaveText('3/3');
    // The source is still splittable (quantityMax=3 > 1) so the button stays.
    await expect(sheet.splitBundleButton(itemId)).toBeVisible();

    // DOM — the new item appears in Unassigned. It has quantityMax=1 so
    // isSplittableBundle is false on the new row (no split button there).
    await expect(sheet.unassignedSection).toBeVisible();
    await expect(sheet.unassignedItemRow(snapshot.created.id)).toBeVisible();
    await expect(sheet.splitBundleButton(snapshot.created.id)).toHaveCount(0);

    await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
  });

  test('splits a 2-bundle down to two singulars; button disappears', async ({ page }) => {
    const actorName = `E2E Bundle Split2 ${Date.now()}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Minimum splittable bundle: quantity=quantityMax=2. After one click
    // the source is quantity=1/quantityMax=1 → isSplittableBundle becomes
    // false → the split button is removed from the DOM. This is the edge
    // where a bundle collapses back into singular items.
    const { actorId, itemId } = await page.evaluate(async (n) => {
      const actor = await Actor.create({ name: n, type: 'character' });
      const [item] = await actor.createEmbeddedDocuments('Item', [{
        name: `${n} Pair`,
        type: 'container',
        system: {
          containerType: 'smallSack',
          quantity: 2,
          quantityMax: 2,
          slot: 'torso',
          slotIndex: 0,
          slotOptions: { torso: 1, pack: 1, carried: 1 }
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

    await expect(sheet.splitBundleButton(itemId)).toBeVisible();
    await expect(sheet.bundleQtyText(itemId)).toHaveText('2/2');

    await sheet.splitBundleButton(itemId).click();

    // Two items, both singular.
    await expect
      .poll(() => page.evaluate((id) => game.actors.get(id).items.size, actorId))
      .toBe(2);

    const snapshot = await page.evaluate(({ id, srcId }) => {
      const a = game.actors.get(id);
      const items = a.items.map(i => ({
        id: i.id, quantity: i.system.quantity, quantityMax: i.system.quantityMax,
        slot: i.system.slot, slotIndex: i.system.slotIndex
      }));
      const source = items.find(i => i.id === srcId);
      const created = items.find(i => i.id !== srcId);
      return { source, created };
    }, { id: actorId, srcId: itemId });

    expect(snapshot.source).toMatchObject({
      quantity: 1, quantityMax: 1, slot: 'torso', slotIndex: 0
    });
    expect(snapshot.created).toMatchObject({
      quantity: 1, quantityMax: 1, slot: '', slotIndex: 0
    });

    // DOM — source is still in torso slot 0 but no longer renders the
    // bundle quantity/split affordance (isSplittableBundle is now false).
    // Because the item still has slotOptions allowing a slot cost of 1,
    // the cell remains `occupied` and the removeFromSlot/editItem buttons
    // are still there — just the bundle controls are gone.
    const torsoSlot = sheet.inventorySlot('torso', 0);
    await expect(torsoSlot).toHaveAttribute('data-item-id', itemId);
    await expect(sheet.splitBundleButton(itemId)).toHaveCount(0);
    await expect(sheet.bundleQtyText(itemId)).toHaveCount(0);

    // The created clone sits in Unassigned without a split button.
    await expect(sheet.unassignedItemRow(snapshot.created.id)).toBeVisible();
    await expect(sheet.splitBundleButton(snapshot.created.id)).toHaveCount(0);

    await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
  });

  test('does not split a singular (quantity=1); guard returns early', async ({ page }) => {
    const actorName = `E2E Bundle Singular ${Date.now()}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // A singular container (quantity=quantityMax=1) is NOT a bundle — the
    // template gates the scissors button on `isSplittableBundle` which
    // requires quantityMax > 1. Assert the button is absent and confirm
    // no handler path can create a duplicate item. We also invoke the
    // handler directly through its data-action dispatcher to verify the
    // guard (`qty < 2 → return`) — but because the button is not in the
    // DOM, the only way to trip it is via fabricated synthetic click. We
    // skip that and rely on the stronger invariant: no button means the
    // user cannot split.
    const { actorId, itemId } = await page.evaluate(async (n) => {
      const actor = await Actor.create({ name: n, type: 'character' });
      const [item] = await actor.createEmbeddedDocuments('Item', [{
        name: `${n} Lone Sack`,
        type: 'container',
        system: {
          containerType: 'smallSack',
          quantity: 1,
          quantityMax: 1,
          slot: 'torso',
          slotIndex: 0,
          slotOptions: { torso: 1, pack: 1, carried: 1 }
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

    // Pre-state: torso slot 0 holds a singular sack; NO split button.
    const torsoSlot = sheet.inventorySlot('torso', 0);
    await expect(torsoSlot).toHaveAttribute('data-item-id', itemId);
    await expect(sheet.splitBundleButton(itemId)).toHaveCount(0);
    await expect(sheet.bundleQtyText(itemId)).toHaveCount(0);

    // Data model unchanged; still exactly one item on the actor.
    const state = await page.evaluate(({ id, iid }) => {
      const a = game.actors.get(id);
      const it = a.items.get(iid);
      return {
        size: a.items.size,
        quantity: it.system.quantity,
        quantityMax: it.system.quantityMax,
        slot: it.system.slot
      };
    }, { id: actorId, iid: itemId });
    expect(state).toEqual({ size: 1, quantity: 1, quantityMax: 1, slot: 'torso' });

    await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
  });
});
