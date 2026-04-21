import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { CharacterSheet } from '../pages/CharacterSheet.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * Data-model facts (verified against module/data/actor/character.mjs):
 *  - Will / Health / Circles / Resources use advancementField — rating is
 *    integer with min 0, max 10.
 *  - Nature uses its own schema: rating min 0 max 7, max min 0 max 7.
 *  - Nature's HTML input caps `rating` at the current `max` value; the data
 *    model enforces the hard 0..7 bound.
 *
 * The spec exercises the middle of each range so the test stays valid if
 * rulebook caps change slightly.
 */
test.describe('Character sheet abilities', () => {
  test('edits ability ratings + Nature max and persists across re-render', async ({ page }) => {
    const actorName = `E2E Abilities ${Date.now()}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Create the character actor directly via the game API (fastest path).
    const actorId = await page.evaluate(async (n) => {
      const actor = await Actor.create({ name: n, type: 'character' });
      return actor.id;
    }, actorName);
    expect(actorId).toBeTruthy();

    // Open the sheet via the API — avoids sidebar traversal.
    await page.evaluate((id) => {
      game.actors.get(id).sheet.render(true);
    }, actorId);

    const sheet = new CharacterSheet(page, actorName);
    await sheet.expectOpen();

    // Activate the Abilities tab so number inputs are visible.
    await sheet.openAbilitiesTab();

    // Set Nature's max first so we can then push rating up to it safely.
    // (The HTML rating input has max={{nature.max}} — a low default max
    // would otherwise cap a fill() via type/step validation.)
    const natureMax = 7;
    const natureRating = 6;
    const willRating = 5;
    const healthRating = 5;
    const circlesRating = 3;
    const resourcesRating = 2;

    const natureMaxInput = sheet.abilityMax('nature');
    await expect(natureMaxInput).toBeVisible();
    await natureMaxInput.fill(String(natureMax));
    await natureMaxInput.blur();

    await expect
      .poll(() =>
        page.evaluate(
          (id) => game.actors.get(id)?.system.abilities.nature.max,
          actorId
        )
      )
      .toBe(natureMax);

    // Nature rating.
    const natureRatingInput = sheet.abilityRating('nature');
    await expect(natureRatingInput).toBeVisible();
    await natureRatingInput.fill(String(natureRating));
    await natureRatingInput.blur();

    await expect
      .poll(() =>
        page.evaluate(
          (id) => game.actors.get(id)?.system.abilities.nature.rating,
          actorId
        )
      )
      .toBe(natureRating);

    // Will.
    const willInput = sheet.abilityRating('will');
    await expect(willInput).toBeVisible();
    await willInput.fill(String(willRating));
    await willInput.blur();

    await expect
      .poll(() =>
        page.evaluate(
          (id) => game.actors.get(id)?.system.abilities.will.rating,
          actorId
        )
      )
      .toBe(willRating);

    // Health.
    const healthInput = sheet.abilityRating('health');
    await healthInput.fill(String(healthRating));
    await healthInput.blur();

    await expect
      .poll(() =>
        page.evaluate(
          (id) => game.actors.get(id)?.system.abilities.health.rating,
          actorId
        )
      )
      .toBe(healthRating);

    // Circles.
    const circlesInput = sheet.abilityRating('circles');
    await circlesInput.fill(String(circlesRating));
    await circlesInput.blur();

    await expect
      .poll(() =>
        page.evaluate(
          (id) => game.actors.get(id)?.system.abilities.circles.rating,
          actorId
        )
      )
      .toBe(circlesRating);

    // Resources.
    const resourcesInput = sheet.abilityRating('resources');
    await resourcesInput.fill(String(resourcesRating));
    await resourcesInput.blur();

    await expect
      .poll(() =>
        page.evaluate(
          (id) => game.actors.get(id)?.system.abilities.resources.rating,
          actorId
        )
      )
      .toBe(resourcesRating);

    // Close and re-render the sheet to verify values persist in the DOM.
    await page.evaluate((id) => {
      game.actors.get(id).sheet.close();
    }, actorId);
    await expect(sheet.root).toHaveCount(0);

    await page.evaluate((id) => {
      game.actors.get(id).sheet.render(true);
    }, actorId);

    const rerendered = new CharacterSheet(page, actorName);
    await rerendered.expectOpen();
    await rerendered.openAbilitiesTab();

    await expect(rerendered.abilityRating('will')).toHaveValue(String(willRating));
    await expect(rerendered.abilityRating('health')).toHaveValue(String(healthRating));
    await expect(rerendered.abilityRating('nature')).toHaveValue(String(natureRating));
    await expect(rerendered.abilityMax('nature')).toHaveValue(String(natureMax));
    await expect(rerendered.abilityRating('circles')).toHaveValue(String(circlesRating));
    await expect(rerendered.abilityRating('resources')).toHaveValue(String(resourcesRating));

    // Authoritative check via the data model.
    const persisted = await page.evaluate((id) => {
      const a = game.actors.get(id);
      const ab = a.system.abilities;
      return {
        will: ab.will.rating,
        health: ab.health.rating,
        natureRating: ab.nature.rating,
        natureMax: ab.nature.max,
        circles: ab.circles.rating,
        resources: ab.resources.rating
      };
    }, actorId);
    expect(persisted).toEqual({
      will: willRating,
      health: healthRating,
      natureRating,
      natureMax,
      circles: circlesRating,
      resources: resourcesRating
    });

    // Clean up so repeated runs don't pile actors up in the world.
    await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
  });
});
