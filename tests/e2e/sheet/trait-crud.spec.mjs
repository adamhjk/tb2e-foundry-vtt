import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { CharacterSheet } from '../pages/CharacterSheet.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * Data-model facts (verified against module/data/item/trait.mjs):
 *   - `level`: NumberField, integer, min 1, max 3, initial 1.
 *   - There is NO "flawed" flag or negative-level state in the schema.
 *     The Torchbearer rule "flawed" / "used against you" is modelled by the
 *     separate boolean `usedAgainst` (DH p.79 — beneficial/against usage),
 *     which is set elsewhere (see module/dice/versus.mjs) and not exposed
 *     as a bubble on the traits tab. The sheet template renders only three
 *     level pips (1/2/3) per trait row (see
 *     templates/actors/tabs/character-traits.hbs).
 *
 * Handler facts (module/applications/actor/character-sheet.mjs):
 *   - `addTrait` creates a blank Item of type `trait` with name "New Trait"
 *     directly on the actor (no dialog).
 *   - `setTraitLevel` reads `data-level` from the clicked pip and writes
 *     `system.level` to the item.
 *   - `deleteTrait` deletes the item by id.
 *
 * Scope: exercise the addTrait data-action once via the UI to prove the
 * button works, then create traits programmatically to drive the level
 * bubbles up (1→2→3), down (3→2→1), and delete. Verify DOM .active state
 * and data-model `system.level` after each change.
 */
test.describe('Character sheet traits CRUD', () => {
  test('addTrait button creates a trait Item on the actor', async ({ page }) => {
    const actorName = `E2E TraitAdd ${Date.now()}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    const actorId = await page.evaluate(async (n) => {
      const actor = await Actor.create({ name: n, type: 'character' });
      return actor.id;
    }, actorName);
    expect(actorId).toBeTruthy();

    await page.evaluate((id) => {
      game.actors.get(id).sheet.render(true);
    }, actorId);

    const sheet = new CharacterSheet(page, actorName);
    await sheet.expectOpen();
    await sheet.openTraitsTab();

    // Sanity: no traits yet.
    const initialCount = await page.evaluate(
      (id) => game.actors.get(id).itemTypes.trait.length,
      actorId
    );
    expect(initialCount).toBe(0);

    // Click the Add Trait button — this fires the `addTrait` data-action,
    // which creates a blank Item of type `trait` (name "New Trait").
    await expect(sheet.addTraitButton).toBeVisible();
    await sheet.addTraitButton.click();

    // Verify a trait Item was created on the actor.
    await expect
      .poll(() =>
        page.evaluate((id) => game.actors.get(id).itemTypes.trait.length, actorId)
      )
      .toBe(1);

    const created = await page.evaluate((id) => {
      const [item] = game.actors.get(id).itemTypes.trait;
      return { id: item.id, name: item.name, level: item.system.level };
    }, actorId);
    expect(created.name).toBe('New Trait');
    expect(created.level).toBe(1);

    // And the row should be present in the DOM with the default state.
    await expect(sheet.traitRow(created.id)).toBeVisible();
    await expect(sheet.traitNameInput(created.id)).toHaveValue('New Trait');

    await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
  });

  test('level bubbles promote, demote, and delete removes the trait', async ({ page }) => {
    const actorName = `E2E TraitLevels ${Date.now()}`;
    const traitName = `E2E Trait ${Date.now()}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    const actorId = await page.evaluate(async (n) => {
      const actor = await Actor.create({ name: n, type: 'character' });
      return actor.id;
    }, actorName);
    expect(actorId).toBeTruthy();

    // Create the trait Item programmatically — faster than round-tripping
    // through the addTrait UI, and lets us set a known name.
    const traitId = await page.evaluate(
      async ({ id, n }) => {
        const actor = game.actors.get(id);
        const [item] = await actor.createEmbeddedDocuments('Item', [
          { name: n, type: 'trait', system: { level: 1 } }
        ]);
        return item.id;
      },
      { id: actorId, n: traitName }
    );
    expect(traitId).toBeTruthy();

    await page.evaluate((id) => {
      game.actors.get(id).sheet.render(true);
    }, actorId);

    const sheet = new CharacterSheet(page, actorName);
    await sheet.expectOpen();
    await sheet.openTraitsTab();

    const row = sheet.traitRow(traitId);
    await expect(row).toBeVisible();
    await expect(sheet.traitNameInput(traitId)).toHaveValue(traitName);

    // Helper to read the stored level from the data model.
    const readLevel = async () =>
      page.evaluate(
        ({ id, tid }) => game.actors.get(id).items.get(tid)?.system.level,
        { id: actorId, tid: traitId }
      );

    // Helper to assert DOM pip state: only the pip matching `level` is active.
    const expectActivePip = async (level) => {
      for ( const l of [1, 2, 3] ) {
        const pip = sheet.traitLevelBubble(traitId, l);
        if ( l === level ) await expect(pip).toHaveClass(/(^|\s)active(\s|$)/);
        else await expect(pip).not.toHaveClass(/(^|\s)active(\s|$)/);
      }
    };

    // Starting state: level 1.
    expect(await readLevel()).toBe(1);
    await expectActivePip(1);

    // Promote 1 → 2 → 3 via the bubbles.
    for ( const level of [2, 3] ) {
      await sheet.traitLevelBubble(traitId, level).click();
      await expect.poll(readLevel).toBe(level);
      await expectActivePip(level);
    }

    // Demote 3 → 2 → 1 via the bubbles.
    for ( const level of [2, 1] ) {
      await sheet.traitLevelBubble(traitId, level).click();
      await expect.poll(readLevel).toBe(level);
      await expectActivePip(level);
    }

    // The trait schema min is 1 and max is 3 (no flawed / negative state) —
    // there is no bubble for a "flawed" level on the sheet. Setting level
    // outside [1, 3] programmatically would be rejected by the NumberField
    // validator; we therefore do not exercise it here.

    // Delete the trait via the row's delete button.
    await sheet.deleteTraitButton(traitId).click();

    // Row is gone from the DOM.
    await expect(row).toHaveCount(0);

    // And the Item is gone from the actor's data model.
    await expect
      .poll(() =>
        page.evaluate(
          ({ id, tid }) => game.actors.get(id).items.get(tid) ?? null,
          { id: actorId, tid: traitId }
        )
      )
      .toBeNull();

    await expect
      .poll(() =>
        page.evaluate((id) => game.actors.get(id).itemTypes.trait.length, actorId)
      )
      .toBe(0);

    await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
  });
});
