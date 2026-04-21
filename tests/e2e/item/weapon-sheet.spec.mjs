import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { CharacterSheet } from '../pages/CharacterSheet.mjs';
import { WeaponItemSheet } from '../pages/ItemSheet.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §22 Items (Non-Magic) — weapon item sheet edit/persist.
 *
 * Opens a weapon item sheet from a character's inventory (via the per-row
 * `editItem` data-action — `templates/actors/tabs/character-inventory.hbs`
 * line 319 in the unassigned strip), edits weapon-specific fields, and
 * verifies the values round-trip through the data model and back into the
 * DOM after a close + re-render.
 *
 * TB2E weapon schema (`module/data/item/weapon.mjs`):
 *   - `wield`: NumberField 1|2 (SG p.141, DH p.112 — one-handed or two-handed)
 *   - `cost`: NumberField (shared inventoryFields, _fields.mjs line 27) —
 *     slot cost / burden (DH p.72). Closest analog to a "weight" field.
 *   - `conflictBonuses.<action>.{type,value}`: per-action (attack, defend,
 *     feint, maneuver) bonuses (SG pp.140-145, DH pp.116-120). The attack
 *     bonus is the closest analog to a traditional "damage" field — TB2E
 *     weapons do not deal numeric damage; they modify conflict-action dice.
 *   - `specialRules`: StringField (freeform rules text).
 *
 * The TEST_PLAN §22 checkbox wording ("edit damage/weight") is generic and
 * does not match TB2E's weapon schema (no `damage`, no `weight`). This spec
 * adapts it faithfully: `cost` stands in for weight (both model "burden"),
 * and `conflictBonuses.attack.value` + `specialRules` cover the weapon-
 * specific edit surface the checkbox intends to exercise.
 *
 * Persistence model: `GearSheet.DEFAULT_OPTIONS.form.submitOnChange = true`
 * (`module/applications/item/gear-sheet.mjs` line 17) — same AppV2 auto-
 * submit pattern as the NPC sheet (`npc-edit-basics.spec.mjs`) and the
 * identity edit (`edit-identity.spec.mjs`). Fill + blur is sufficient; no
 * explicit Save button is rendered.
 *
 * Tabs/handlers reused from `CharacterSheet`:
 *   - `openInventoryTab()` — switches to the inventory tab panel.
 *   - `unassignedItemRow(itemId)` — locator for the unassigned-items strip.
 *     The per-row Edit button's click fires `editItem` (character-sheet.mjs
 *     `#onEditItem`, line 1725), which calls `item.sheet.render(true)`.
 */
test.describe('Weapon item sheet — edit + persist', () => {
  test('edits cost, wield, attack bonus, and special rules; values round-trip', async ({
    page,
  }) => {
    const actorName = `E2E WeaponSheet ${Date.now()}`;
    const itemName = `${actorName} Sword`;

    // Initial weapon state — distinct from the defaults so we can prove the
    // edit actually changes something. cost=2 + one-handed + no attack bonus
    // mirrors a generic sword out of the Buyer's Guide (DH p.82).
    const initial = {
      cost: 2,
      wield: 1,
      attackValue: 0,
      specialRules: '',
    };

    // Target post-edit state.
    const updated = {
      cost: 3,
      wield: 2,          // two-handed
      attackValue: 1,    // +1D to attack
      specialRules: 'Heavy. Reach.',
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
            type: 'weapon',
            system: {
              // Unassigned — surfaces in the Unassigned strip where the
              // `editItem` button is rendered (character-inventory.hbs
              // line 319).
              slot: '',
              slotIndex: 0,
              cost: init.cost,
              wield: init.wield,
              specialRules: init.specialRules,
              conflictBonuses: {
                attack: { type: 'dice', value: init.attackValue },
              },
              // Allow placement somewhere so the sheet is valid, even
              // though we don't exercise placement in this test.
              slotOptions: { wornHand: 1, carried: 1 },
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

      const weaponSheet = new WeaponItemSheet(page, itemName);
      await weaponSheet.expectOpen();

      // Sanity-check the rendered initial values.
      await expect(weaponSheet.nameInput).toHaveValue(itemName);
      await expect(weaponSheet.costInput).toHaveValue(String(initial.cost));
      await expect(weaponSheet.wieldSelect).toHaveValue(String(initial.wield));
      await expect(weaponSheet.conflictBonusValueInput('attack')).toHaveValue(
        String(initial.attackValue)
      );
      await expect(weaponSheet.specialRulesTextarea).toHaveValue(
        initial.specialRules
      );

      // --- 1. cost (slot cost / "weight" analog — _fields.mjs line 27) ---
      await weaponSheet.costInput.fill(String(updated.cost));
      await weaponSheet.costInput.blur();

      await expect
        .poll(() =>
          page.evaluate(
            ({ aid, iid }) =>
              game.actors.get(aid).items.get(iid).system.cost,
            { aid: actorId, iid: itemId }
          )
        )
        .toBe(updated.cost);

      // --- 2. wield (one-handed → two-handed; weapon.mjs line 15) ---
      await weaponSheet.wieldSelect.selectOption(String(updated.wield));

      await expect
        .poll(() =>
          page.evaluate(
            ({ aid, iid }) =>
              game.actors.get(aid).items.get(iid).system.wield,
            { aid: actorId, iid: itemId }
          )
        )
        .toBe(updated.wield);

      // --- 3. conflictBonuses.attack.value ("damage" analog; weapon.mjs lines 16-21) ---
      await weaponSheet.conflictBonusValueInput('attack').fill(
        String(updated.attackValue)
      );
      await weaponSheet.conflictBonusValueInput('attack').blur();

      await expect
        .poll(() =>
          page.evaluate(
            ({ aid, iid }) =>
              game.actors.get(aid).items.get(iid).system.conflictBonuses.attack
                .value,
            { aid: actorId, iid: itemId }
          )
        )
        .toBe(updated.attackValue);

      // --- 4. specialRules (StringField; weapon.mjs line 27) ---
      await weaponSheet.specialRulesTextarea.fill(updated.specialRules);
      await weaponSheet.specialRulesTextarea.blur();

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
      await expect(weaponSheet.root).toHaveCount(0);

      await page.evaluate(
        ({ aid, iid }) => {
          game.actors.get(aid).items.get(iid).sheet.render(true);
        },
        { aid: actorId, iid: itemId }
      );

      const rerendered = new WeaponItemSheet(page, itemName);
      await rerendered.expectOpen();
      await expect(rerendered.costInput).toHaveValue(String(updated.cost));
      await expect(rerendered.wieldSelect).toHaveValue(String(updated.wield));
      await expect(
        rerendered.conflictBonusValueInput('attack')
      ).toHaveValue(String(updated.attackValue));
      await expect(rerendered.specialRulesTextarea).toHaveValue(
        updated.specialRules
      );

      // Final authoritative check against the data model.
      const persisted = await page.evaluate(
        ({ aid, iid }) => {
          const it = game.actors.get(aid).items.get(iid);
          return {
            cost: it.system.cost,
            wield: it.system.wield,
            attackValue: it.system.conflictBonuses.attack.value,
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
