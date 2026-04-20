import { test, expect } from '@playwright/test';
import { GameUI } from '../pages/GameUI.mjs';
import { CharacterSheet } from '../pages/CharacterSheet.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * Supplies (DH pp.71–74) — food portions, light turns, and draughts from
 * liquid containers. Each is exercised by a different sheet data-action:
 *
 *   - `consumePortion` (food supplies): decrements `system.quantity` by 1
 *     on items with `type="supply"` + `supplyType="food"`. Side effect: if
 *     the actor currently has `conditions.hungry=true`, the handler also
 *     clears it. No item deletion, no chat card. At 0 the handler short-
 *     circuits on `item.system.quantity <= 0` so the counter floors at 0.
 *     (module/applications/actor/character-sheet.mjs #onConsumePortion.)
 *
 *   - `drinkDraught` (liquid containers): decrements `system.quantity` by 1
 *     on items with `type="container"` whose `containerType` is flagged
 *     `liquid: true` in CONFIG.TB2E.containerTypes (waterskin, bottle, jug,
 *     barrel, cask, clayPot, woodenCanteen). The "draught" encoding is NOT
 *     a field on supplies — it's a liquid container's portion count
 *     (`system.quantity` out of `quantityMax`). `system.liquidType` ("water"
 *     by default) controls the side-effect branch:
 *       * "water" (default): decrement + clear hungry
 *       * "oil" / "holyWater": decrement, no condition effect
 *       * "wine": open a DialogV2.confirm (quench vs. bolster) — NOT
 *         exercised here because dialogs complicate a data-action smoke test
 *     This spec uses "oil" so the handler runs its non-dialog branch cleanly
 *     (still decrements quantity). No item deletion, no chat card.
 *     (module/applications/actor/character-sheet.mjs #onDrinkDraught.)
 *
 *   - `consumeLight` (lit light supplies): decrements `system.turnsRemaining`
 *     by 1 on items with `type="supply"` + `supplyType="light"` + `lit=true`.
 *     At 0 the handler short-circuits on `item.system.turnsRemaining <= 0`.
 *     The button itself is only rendered when the light is still lit —
 *     once turnsRemaining drops to 0 the template switches to the
 *     ".slot-depleted-icon" variant (see character-inventory.hbs). Note:
 *     consumeLight itself posts no chat card and does NOT flip `lit` to
 *     false — the `pendingLightExtinguish` mailbox in tb2e.mjs fires on
 *     a separate `lit: false` change, which this handler does not trigger.
 *     (module/applications/actor/character-sheet.mjs #onConsumeLight.)
 *
 * Renders: the template (templates/actors/tabs/character-inventory.hbs) only
 * emits the consumePortion / drinkDraught / consumeLight buttons for items
 * currently PLACED in a slot (the `occupied` branch). Unassigned items render
 * edit / drop / delete only — no consume affordance — so each fixture here
 * seeds the item into a real body slot (belt or hand-R).
 *
 * Data-model contract verified per test:
 *   - Item type + subfields required for the button to appear.
 *   - Counter field decrements on click, floors at 0 (handler no-ops at 0).
 *   - DOM counter input reflects the same value.
 */
test.describe('Character sheet supply consumption', () => {
  test('consumePortion decrements a food supply quantity and floors at zero', async ({ page }) => {
    const actorName = `E2E Supply Food ${Date.now()}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Seed: food supply placed in belt index 0. supplyType="food" is what
    // makes the sheet template render the consumePortion button. Belt
    // requires `slotOptions.belt >= 1` so the item is legally placed there.
    const { actorId, itemId } = await page.evaluate(async (n) => {
      const actor = await Actor.create({ name: n, type: 'character' });
      const [item] = await actor.createEmbeddedDocuments('Item', [{
        name: `${n} Rations`,
        type: 'supply',
        system: {
          supplyType: 'food',
          quantity: 3,
          quantityMax: 3,
          slot: 'belt',
          slotIndex: 0,
          slotOptions: { belt: 1 }
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

    // Pre-state: belt slot 0 is occupied, counter reads 3.
    const beltSlot = sheet.inventorySlot('belt', 0);
    await expect(beltSlot).toBeVisible();
    await expect(beltSlot).toHaveAttribute('data-item-id', itemId);
    await expect(sheet.consumePortionButton(itemId)).toBeVisible();
    await expect(sheet.portionCounter(itemId)).toHaveValue('3');

    // Eat one — quantity 3 → 2.
    await sheet.consumePortionButton(itemId).click();
    await expect
      .poll(() =>
        page.evaluate(
          ({ id, iid }) => game.actors.get(id).items.get(iid).system.quantity,
          { id: actorId, iid: itemId }
        )
      )
      .toBe(2);
    await expect(sheet.portionCounter(itemId)).toHaveValue('2');

    // 2 → 1.
    await sheet.consumePortionButton(itemId).click();
    await expect
      .poll(() =>
        page.evaluate(
          ({ id, iid }) => game.actors.get(id).items.get(iid).system.quantity,
          { id: actorId, iid: itemId }
        )
      )
      .toBe(1);
    await expect(sheet.portionCounter(itemId)).toHaveValue('1');

    // 1 → 0 (final portion). The handler lets quantity reach 0 exactly;
    // the item is NOT removed — it stays in the slot at quantity 0 for the
    // player to refill. Verified both in the data model and DOM.
    await sheet.consumePortionButton(itemId).click();
    await expect
      .poll(() =>
        page.evaluate(
          ({ id, iid }) => game.actors.get(id).items.get(iid).system.quantity,
          { id: actorId, iid: itemId }
        )
      )
      .toBe(0);
    await expect(sheet.portionCounter(itemId)).toHaveValue('0');

    // Item still present in world + still sitting in belt index 0.
    const stillInSlot = await page.evaluate(({ id, iid }) => {
      const it = game.actors.get(id).items.get(iid);
      return { slot: it.system.slot, slotIndex: it.system.slotIndex };
    }, { id: actorId, iid: itemId });
    expect(stillInSlot).toEqual({ slot: 'belt', slotIndex: 0 });

    // 0 → 0: handler short-circuits (`quantity <= 0` returns). Click again
    // and confirm it does NOT go negative.
    await sheet.consumePortionButton(itemId).click();
    // Give the handler a chance to (not) run — poll once, value must still be 0.
    await expect
      .poll(() =>
        page.evaluate(
          ({ id, iid }) => game.actors.get(id).items.get(iid).system.quantity,
          { id: actorId, iid: itemId }
        )
      )
      .toBe(0);

    await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
  });

  test('consumePortion clears the hungry condition on consumption', async ({ page }) => {
    // Documented side-effect in #onConsumePortion: if the actor has
    // `system.conditions.hungry=true`, eating a portion clears it. This is
    // the "Thirsty/Hungry" resolution rule (DH p.53 conditions; SG pp.46-52).
    const actorName = `E2E Supply HungryClear ${Date.now()}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    const { actorId, itemId } = await page.evaluate(async (n) => {
      const actor = await Actor.create({ name: n, type: 'character' });
      await actor.update({
        'system.conditions.fresh': false,
        'system.conditions.hungry': true
      });
      const [item] = await actor.createEmbeddedDocuments('Item', [{
        name: `${n} Bread`,
        type: 'supply',
        system: {
          supplyType: 'food',
          quantity: 2,
          quantityMax: 2,
          slot: 'belt',
          slotIndex: 0,
          slotOptions: { belt: 1 }
        }
      }]);
      return { actorId: actor.id, itemId: item.id };
    }, actorName);

    // Sanity: hungry is on pre-click.
    const preHungry = await page.evaluate(
      (id) => game.actors.get(id).system.conditions.hungry,
      actorId
    );
    expect(preHungry).toBe(true);

    await page.evaluate((id) => {
      game.actors.get(id).sheet.render(true);
    }, actorId);

    const sheet = new CharacterSheet(page, actorName);
    await sheet.expectOpen();
    await sheet.openInventoryTab();

    await expect(sheet.consumePortionButton(itemId)).toBeVisible();
    await sheet.consumePortionButton(itemId).click();

    // Portion decremented AND hungry cleared.
    await expect
      .poll(() =>
        page.evaluate(({ id, iid }) => {
          const a = game.actors.get(id);
          return {
            quantity: a.items.get(iid).system.quantity,
            hungry: a.system.conditions.hungry
          };
        }, { id: actorId, iid: itemId })
      )
      .toEqual({ quantity: 1, hungry: false });

    await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
  });

  test('drinkDraught decrements a liquid container quantity and floors at zero', async ({ page }) => {
    const actorName = `E2E Supply Draught ${Date.now()}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Seed: a bottle (containerType=bottle, flagged liquid:true in
    // CONFIG.TB2E.containerTypes) placed in belt slot 1. liquidType="oil"
    // so the handler takes the "no dialog, just decrement" branch (oil and
    // holyWater skip condition side-effects and skip the wine dialog).
    const { actorId, itemId } = await page.evaluate(async (n) => {
      const actor = await Actor.create({ name: n, type: 'character' });
      const [item] = await actor.createEmbeddedDocuments('Item', [{
        name: `${n} Oil Flask`,
        type: 'container',
        system: {
          containerType: 'bottle',
          liquidType: 'oil',
          quantity: 2,
          quantityMax: 2,
          slot: 'belt',
          slotIndex: 0,
          slotOptions: { belt: 1 }
        }
      }]);
      return { actorId: actor.id, itemId: item.id };
    }, actorName);
    expect(itemId).toBeTruthy();

    await page.evaluate((id) => {
      game.actors.get(id).sheet.render(true);
    }, actorId);

    const sheet = new CharacterSheet(page, actorName);
    await sheet.expectOpen();
    await sheet.openInventoryTab();

    const beltSlot = sheet.inventorySlot('belt', 0);
    await expect(beltSlot).toBeVisible();
    await expect(beltSlot).toHaveAttribute('data-item-id', itemId);
    await expect(sheet.drinkDraughtButton(itemId)).toBeVisible();
    await expect(sheet.draughtCounter(itemId)).toHaveValue('2');

    // 2 → 1.
    await sheet.drinkDraughtButton(itemId).click();
    await expect
      .poll(() =>
        page.evaluate(
          ({ id, iid }) => game.actors.get(id).items.get(iid).system.quantity,
          { id: actorId, iid: itemId }
        )
      )
      .toBe(1);
    await expect(sheet.draughtCounter(itemId)).toHaveValue('1');

    // 1 → 0.
    await sheet.drinkDraughtButton(itemId).click();
    await expect
      .poll(() =>
        page.evaluate(
          ({ id, iid }) => game.actors.get(id).items.get(iid).system.quantity,
          { id: actorId, iid: itemId }
        )
      )
      .toBe(0);
    await expect(sheet.draughtCounter(itemId)).toHaveValue('0');

    // Item persists — oil container stays in the belt slot at quantity 0,
    // waiting to be refilled. No auto-delete.
    const still = await page.evaluate(({ id, iid }) => {
      const it = game.actors.get(id).items.get(iid);
      return { slot: it.system.slot, liquidType: it.system.liquidType };
    }, { id: actorId, iid: itemId });
    expect(still).toEqual({ slot: 'belt', liquidType: 'oil' });

    // 0 → 0: handler short-circuits on `quantity <= 0`.
    await sheet.drinkDraughtButton(itemId).click();
    await expect
      .poll(() =>
        page.evaluate(
          ({ id, iid }) => game.actors.get(id).items.get(iid).system.quantity,
          { id: actorId, iid: itemId }
        )
      )
      .toBe(0);

    await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
  });

  test('consumeLight decrements turnsRemaining on a lit torch and floors at zero', async ({ page }) => {
    const actorName = `E2E Supply Torch ${Date.now()}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Seed: a lit torch (supply + supplyType=light + lit=true + turnsRemaining=3)
    // held in hand-R. The consumeLight button is only rendered by the template
    // when the item is both `isLight` (supply + supplyType=light) AND `lit`.
    // Hand slots accept items with `slotOptions.wornHand`.
    const { actorId, itemId } = await page.evaluate(async (n) => {
      const actor = await Actor.create({ name: n, type: 'character' });
      const [item] = await actor.createEmbeddedDocuments('Item', [{
        name: `${n} Torch`,
        type: 'supply',
        system: {
          supplyType: 'light',
          lit: true,
          turnsRemaining: 3,
          quantity: 1,
          quantityMax: 1,
          slot: 'hand-R',
          slotIndex: 0,
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

    const handSlot = sheet.inventorySlot('hand-R', 0);
    await expect(handSlot).toBeVisible();
    await expect(handSlot).toHaveAttribute('data-item-id', itemId);
    await expect(sheet.consumeLightButton(itemId)).toBeVisible();
    await expect(sheet.lightTurnsCounter(itemId)).toHaveValue('3');

    // 3 → 2.
    await sheet.consumeLightButton(itemId).click();
    await expect
      .poll(() =>
        page.evaluate(
          ({ id, iid }) => game.actors.get(id).items.get(iid).system.turnsRemaining,
          { id: actorId, iid: itemId }
        )
      )
      .toBe(2);
    await expect(sheet.lightTurnsCounter(itemId)).toHaveValue('2');

    // 2 → 1 — still lit; button still present.
    await sheet.consumeLightButton(itemId).click();
    await expect
      .poll(() =>
        page.evaluate(
          ({ id, iid }) => game.actors.get(id).items.get(iid).system.turnsRemaining,
          { id: actorId, iid: itemId }
        )
      )
      .toBe(1);

    // 1 → 0 — handler drives turnsRemaining to 0 exactly. It does NOT flip
    // `lit` to false (see character-sheet.mjs #onConsumeLight — just one
    // update call). Because the template's `.lit` branch is still true, the
    // consumeLight button stays in the DOM with a counter of 0 turns — it
    // just becomes a no-op (the handler short-circuits on turnsRemaining<=0).
    await sheet.consumeLightButton(itemId).click();
    await expect
      .poll(() =>
        page.evaluate(({ id, iid }) => {
          const it = game.actors.get(id).items.get(iid);
          return { turnsRemaining: it.system.turnsRemaining, lit: it.system.lit };
        }, { id: actorId, iid: itemId })
      )
      .toEqual({ turnsRemaining: 0, lit: true });
    await expect(sheet.lightTurnsCounter(itemId)).toHaveValue('0');

    // 0 → 0 — click again; handler returns early on `turnsRemaining <= 0`.
    await sheet.consumeLightButton(itemId).click();
    await expect
      .poll(() =>
        page.evaluate(
          ({ id, iid }) => game.actors.get(id).items.get(iid).system.turnsRemaining,
          { id: actorId, iid: itemId }
        )
      )
      .toBe(0);

    await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
  });
});
