import { test, expect } from '@playwright/test';
import { GameUI } from '../pages/GameUI.mjs';
import { CharacterSheet } from '../pages/CharacterSheet.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * Data-model facts (verified against module/data/actor/character.mjs):
 *   - `system.bio` is a plain `StringField` — NOT an `HTMLField` — so the
 *     biography tab renders it as a `<textarea name="system.bio">` rather
 *     than a Foundry ProseMirror editor. `.fill()` + blur is all that's
 *     required to persist, via the sheet's `submitOnChange: true` form
 *     submission (module/applications/actor/character-sheet.mjs).
 *   - `system.allies` is an `ArrayField` of `{ name, location, status }`,
 *     rendered on the biography tab as a table with `addRow`/`deleteRow`
 *     data-actions keyed by `data-array="allies"`.
 *   - `system.levelChoices` is a `SchemaField` keyed by level (2..10). The
 *     biography tab renders one `<input name="system.levelChoices.<n>">`
 *     per row in the level-requirements table.
 *
 * There is NO belief/instinct/goal/creed input on the biography tab (those
 * fields exist in the data model but are not rendered as editable inputs
 * in any character-sheet tab template — verified by grepping under
 * templates/actors). Edits to those fields are out of scope here.
 *
 * Scope: exercise the three editable paths on the biography tab — the bio
 * textarea, an ally row's three text fields, and a level-choice input —
 * and assert round-trip persistence both in the data model and after a
 * close + re-render of the sheet.
 */
test.describe('Character sheet biography', () => {
  test('edits bio textarea, ally row, and level choice and persists across re-render', async ({ page }) => {
    const actorName = `E2E Bio ${Date.now()}`;
    const bioText = `A wandering scholar of the North. ${Date.now()}`;
    const allyName = 'Halvard the Scribe';
    const allyLocation = 'Lockhaven';
    const allyStatus = 'Owes a favor';
    const levelChoice = 'Keen Eye';

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

    // Switch to the Biography tab.
    await sheet.openBiographyTab();
    await expect(sheet.bioTextarea).toBeVisible();

    // --- 1. Bio textarea ---
    // Sanity: starts empty. StringField default is undefined, which the
    // template coerces to an empty textarea body.
    await expect(sheet.bioTextarea).toHaveValue('');

    await sheet.bioTextarea.fill(bioText);
    await sheet.bioTextarea.blur();

    await expect
      .poll(() =>
        page.evaluate((id) => game.actors.get(id)?.system.bio, actorId)
      )
      .toBe(bioText);

    // --- 2. Ally row (addRow + three text inputs) ---
    // Sanity: no allies yet.
    expect(
      await page.evaluate(
        (id) => (game.actors.get(id).system.allies || []).length,
        actorId
      )
    ).toBe(0);

    await expect(sheet.addAllyButton).toBeVisible();
    await sheet.addAllyButton.click();

    // Wait for the row to exist in the data model.
    await expect
      .poll(() =>
        page.evaluate(
          (id) => (game.actors.get(id).system.allies || []).length,
          actorId
        )
      )
      .toBe(1);

    // Fill the three ally inputs (submitOnChange persists each blur).
    await expect(sheet.allyNameInput(0)).toBeVisible();
    await sheet.allyNameInput(0).fill(allyName);
    await sheet.allyNameInput(0).blur();
    await sheet.allyLocationInput(0).fill(allyLocation);
    await sheet.allyLocationInput(0).blur();
    await sheet.allyStatusInput(0).fill(allyStatus);
    await sheet.allyStatusInput(0).blur();

    await expect
      .poll(() =>
        page.evaluate(
          (id) => game.actors.get(id)?.system.allies?.[0] ?? null,
          actorId
        )
      )
      .toMatchObject({
        name: allyName,
        location: allyLocation,
        status: allyStatus
      });

    // --- 3. Level-choice input ---
    // The level-requirements table renders one input per level (2..10). We
    // edit level 2's choice (always present since character.level starts at 1
    // and the table lists levels 2..10 as future targets).
    await expect(sheet.levelChoiceInput(2)).toBeVisible();
    await sheet.levelChoiceInput(2).fill(levelChoice);
    await sheet.levelChoiceInput(2).blur();

    await expect
      .poll(() =>
        page.evaluate(
          (id) => game.actors.get(id)?.system.levelChoices?.['2'] ?? null,
          actorId
        )
      )
      .toBe(levelChoice);

    // --- Close + re-render and assert DOM reflects persisted values ---
    await page.evaluate((id) => {
      game.actors.get(id).sheet.close();
    }, actorId);
    await expect(sheet.root).toHaveCount(0);

    await page.evaluate((id) => {
      game.actors.get(id).sheet.render(true);
    }, actorId);

    const rerendered = new CharacterSheet(page, actorName);
    await rerendered.expectOpen();
    await rerendered.openBiographyTab();

    await expect(rerendered.bioTextarea).toHaveValue(bioText);
    await expect(rerendered.allyNameInput(0)).toHaveValue(allyName);
    await expect(rerendered.allyLocationInput(0)).toHaveValue(allyLocation);
    await expect(rerendered.allyStatusInput(0)).toHaveValue(allyStatus);
    await expect(rerendered.levelChoiceInput(2)).toHaveValue(levelChoice);

    // Final authoritative check against the data model.
    const persisted = await page.evaluate((id) => {
      const a = game.actors.get(id);
      return {
        bio: a.system.bio,
        ally0: a.system.allies?.[0] ?? null,
        level2Choice: a.system.levelChoices?.['2'] ?? null
      };
    }, actorId);
    expect(persisted.bio).toBe(bioText);
    expect(persisted.ally0).toMatchObject({
      name: allyName,
      location: allyLocation,
      status: allyStatus
    });
    expect(persisted.level2Choice).toBe(levelChoice);

    await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
  });
});
