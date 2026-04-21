import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { CharacterSheet } from '../pages/CharacterSheet.mjs';
import { getActorByName } from '../helpers/game.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

test.describe('Character sheet identity', () => {
  test('edits name, level and home and persists across re-render', async ({ page }) => {
    const originalName = `E2E Identity ${Date.now()}`;
    const updatedName = `${originalName} Edited`;
    const updatedLevel = 4;
    const updatedHome = 'Lockhaven';

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Create the character actor directly via the game API (fastest path).
    const actorId = await page.evaluate(async (n) => {
      const actor = await Actor.create({ name: n, type: 'character' });
      return actor.id;
    }, originalName);
    expect(actorId).toBeTruthy();

    // Open the sheet via the API — avoids sidebar traversal.
    await page.evaluate((id) => {
      game.actors.get(id).sheet.render(true);
    }, actorId);

    const sheet = new CharacterSheet(page, originalName);
    await sheet.expectOpen();
    await expect(sheet.nameInput).toHaveValue(originalName);

    // Switch to the Identity tab so number/text inputs are visible.
    await sheet.openIdentityTab();
    await expect(sheet.levelInput).toBeVisible();
    await expect(sheet.homeInput).toBeVisible();

    // Edit name in the header. submitOnChange + blur triggers a save.
    await sheet.nameInput.fill(updatedName);
    await sheet.nameInput.blur();

    // Wait for the world actor to reflect the new name.
    await expect
      .poll(async () => (await getActorByName(page, updatedName))?.id ?? null)
      .toBe(actorId);

    // Edit level.
    await sheet.levelInput.fill(String(updatedLevel));
    await sheet.levelInput.blur();

    await expect
      .poll(() =>
        page.evaluate((id) => game.actors.get(id)?.system.level, actorId)
      )
      .toBe(updatedLevel);

    // Edit home (text identity field).
    await sheet.homeInput.fill(updatedHome);
    await sheet.homeInput.blur();

    await expect
      .poll(() =>
        page.evaluate((id) => game.actors.get(id)?.system.home, actorId)
      )
      .toBe(updatedHome);

    // Close and re-render the sheet to verify values persist in the DOM.
    await page.evaluate((id) => {
      const a = game.actors.get(id);
      a.sheet.close();
    }, actorId);

    // Confirm the old sheet is gone before re-rendering.
    await expect(sheet.root).toHaveCount(0);

    await page.evaluate((id) => {
      game.actors.get(id).sheet.render(true);
    }, actorId);

    // The sheet's root is keyed by the window title, which now uses the updated name.
    const rerendered = new CharacterSheet(page, updatedName);
    await rerendered.expectOpen();
    await expect(rerendered.nameInput).toHaveValue(updatedName);

    await rerendered.openIdentityTab();
    await expect(rerendered.levelInput).toHaveValue(String(updatedLevel));
    await expect(rerendered.homeInput).toHaveValue(updatedHome);

    // Final authoritative check via the data model.
    const persisted = await page.evaluate((id) => {
      const a = game.actors.get(id);
      return { name: a.name, level: a.system.level, home: a.system.home };
    }, actorId);
    expect(persisted).toEqual({
      name: updatedName,
      level: updatedLevel,
      home: updatedHome,
    });

    // Clean up so repeated runs don't pile actors up in the world.
    await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
  });
});
