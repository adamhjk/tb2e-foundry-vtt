import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { CharacterSheet } from '../pages/CharacterSheet.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * Data-model facts (verified against module/data/actor/character.mjs):
 *   - `system.wises` is an ArrayField of { name, pass, fail, fate, persona }
 *     — NOT an embedded Item collection. Wises are rendered from the array
 *     in templates/actors/tabs/character-traits.hbs (same tab as traits).
 *   - The sheet enforces a 4-slot cap in two places:
 *       * `canAddWise` gates rendering of the Add Wise button (prepareContext)
 *       * `#onAddRow` refuses to push when `current.length >= 4`
 *     (Torchbearer DH p.87 — each character has 4 wise slots.)
 *
 * Handler facts (module/applications/actor/character-sheet.mjs):
 *   - Add is the generic `addRow` data-action with `data-array="wises"`,
 *     appending a blank `{}` to `system.wises` (name defaults to empty).
 *   - Delete is the generic `deleteRow` data-action with `data-array="wises"`
 *     and `data-index="<i>"`, which splices out that index.
 *   - Name persistence comes via the standard form-submission path: each
 *     row renders `<input name="system.wises.<i>.name">` which Foundry
 *     merges into the actor's system data on submit.
 *
 * Scope: exercise the addRow + deleteRow data-actions for wises via the UI,
 * and confirm name edits round-trip through the data model. This mirrors
 * trait-crud.spec.mjs but adapted to the index-keyed array storage.
 */
test.describe('Character sheet wises CRUD', () => {
  test('addWise button appends a wise row to the actor', async ({ page }) => {
    const actorName = `E2E WiseAdd ${Date.now()}`;

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

    // Sanity: no wises yet.
    const initialCount = await page.evaluate(
      (id) => (game.actors.get(id).system.wises || []).length,
      actorId
    );
    expect(initialCount).toBe(0);

    // Click Add Wise — fires `addRow` with data-array="wises", which
    // pushes a blank `{}` into system.wises.
    await expect(sheet.addWiseButton).toBeVisible();
    await sheet.addWiseButton.click();

    // The array should grow by one on the data model.
    await expect
      .poll(() =>
        page.evaluate(
          (id) => (game.actors.get(id).system.wises || []).length,
          actorId
        )
      )
      .toBe(1);

    // And the row should be present in the DOM with an empty name input.
    await expect(sheet.wiseRows).toHaveCount(1);
    await expect(sheet.wiseRow(0)).toBeVisible();
    await expect(sheet.wiseNameInput(0)).toHaveValue('');

    await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
  });

  test('renames a wise via its name input and persists to the data model', async ({ page }) => {
    const actorName = `E2E WiseRename ${Date.now()}`;
    const originalName = `E2E Wise ${Date.now()}`;
    const renamed = `${originalName} (renamed)`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Seed the actor with a named wise programmatically so we're testing
    // the rename path, not the add path (already covered above).
    const actorId = await page.evaluate(
      async ({ n, wn }) => {
        const actor = await Actor.create({
          name: n,
          type: 'character',
          system: { wises: [{ name: wn }] }
        });
        return actor.id;
      },
      { n: actorName, wn: originalName }
    );
    expect(actorId).toBeTruthy();

    await page.evaluate((id) => {
      game.actors.get(id).sheet.render(true);
    }, actorId);

    const sheet = new CharacterSheet(page, actorName);
    await sheet.expectOpen();
    await sheet.openTraitsTab();

    await expect(sheet.wiseRows).toHaveCount(1);
    await expect(sheet.wiseNameInput(0)).toHaveValue(originalName);

    // Rename via the input; blur commits through Foundry's form handler.
    await sheet.wiseNameInput(0).fill(renamed);
    await sheet.wiseNameInput(0).blur();

    await expect
      .poll(() =>
        page.evaluate(
          (id) => game.actors.get(id).system.wises[0]?.name,
          actorId
        )
      )
      .toBe(renamed);

    // Persist across a close + re-render to confirm it's stored, not
    // just held in the live form.
    await page.evaluate((id) => game.actors.get(id).sheet.close(), actorId);
    await expect(sheet.root).toHaveCount(0);

    await page.evaluate((id) => game.actors.get(id).sheet.render(true), actorId);
    const rerendered = new CharacterSheet(page, actorName);
    await rerendered.expectOpen();
    await rerendered.openTraitsTab();
    await expect(rerendered.wiseNameInput(0)).toHaveValue(renamed);

    await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
  });

  test('deleteRow removes a wise from the DOM and the data model', async ({ page }) => {
    const actorName = `E2E WiseDelete ${Date.now()}`;
    const keep = `E2E Keep ${Date.now()}`;
    const drop = `E2E Drop ${Date.now()}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Seed with two named wises so we can verify that the correct index
    // is removed (splice, not truncate) and the surviving entry is the
    // one we expected.
    const actorId = await page.evaluate(
      async ({ n, a, b }) => {
        const actor = await Actor.create({
          name: n,
          type: 'character',
          system: { wises: [{ name: a }, { name: b }] }
        });
        return actor.id;
      },
      { n: actorName, a: keep, b: drop }
    );
    expect(actorId).toBeTruthy();

    await page.evaluate((id) => {
      game.actors.get(id).sheet.render(true);
    }, actorId);

    const sheet = new CharacterSheet(page, actorName);
    await sheet.expectOpen();
    await sheet.openTraitsTab();

    await expect(sheet.wiseRows).toHaveCount(2);
    await expect(sheet.wiseNameInput(0)).toHaveValue(keep);
    await expect(sheet.wiseNameInput(1)).toHaveValue(drop);

    // Delete the second entry.
    await sheet.deleteWiseButton(1).click();

    // DOM collapses to a single row.
    await expect(sheet.wiseRows).toHaveCount(1);

    // Data model: only the "keep" entry remains.
    await expect
      .poll(() =>
        page.evaluate(
          (id) => game.actors.get(id).system.wises.map((w) => w.name),
          actorId
        )
      )
      .toEqual([keep]);

    // The surviving row's name input reflects the kept wise.
    await expect(sheet.wiseNameInput(0)).toHaveValue(keep);

    await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
  });
});
