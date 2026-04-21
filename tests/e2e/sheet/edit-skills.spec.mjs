import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { CharacterSheet } from '../pages/CharacterSheet.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * Data-model facts (verified against module/data/actor/character.mjs):
 *  - Each of the 41 skills is an advancementField: rating is an integer
 *    0..10 with initial 0, plus pass/fail/learning counters.
 *  - Default `learning = 0`, so `isLearning` is false and the Skills tab
 *    renders a numeric <input name="system.skills.<key>.rating"> for every
 *    skill (see templates/actors/tabs/character-skills.hbs).
 *
 * Scope: pick 6 skills covering a representative mix — common adventuring
 * skills (fighter, scholar, hunter, alchemist, arcanist) plus one
 * alphabetically-early skill (beggar) — and verify the rating round-trips
 * through the data model and persists across sheet re-render.
 */
test.describe('Character sheet skills', () => {
  test('edits skill ratings and persists across re-render', async ({ page }) => {
    const actorName = `E2E Skills ${Date.now()}`;

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

    // Activate the Skills tab so the numeric rating inputs are visible.
    await sheet.openSkillsTab();

    // Representative mix of skills + the ratings we'll write. Values chosen
    // in the middle of the 0..10 range so the test stays valid under minor
    // rulebook tweaks. Each value is distinct to catch cross-wiring.
    const targets = [
      { key: 'fighter',   rating: 4 },
      { key: 'scholar',   rating: 3 },
      { key: 'hunter',    rating: 5 },
      { key: 'alchemist', rating: 2 },
      { key: 'arcanist',  rating: 6 },
      { key: 'beggar',    rating: 1 }
    ];

    for ( const { key, rating } of targets ) {
      const input = sheet.skillRating(key);
      await expect(input).toBeVisible();
      await input.fill(String(rating));
      await input.blur();

      await expect
        .poll(() =>
          page.evaluate(
            ({ id, k }) => game.actors.get(id)?.system.skills[k]?.rating,
            { id: actorId, k: key }
          )
        )
        .toBe(rating);
    }

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
    await rerendered.openSkillsTab();

    for ( const { key, rating } of targets ) {
      await expect(rerendered.skillRating(key)).toHaveValue(String(rating));
    }

    // Final authoritative check via the data model.
    const persisted = await page.evaluate((id) => {
      const skills = game.actors.get(id).system.skills;
      return {
        fighter: skills.fighter.rating,
        scholar: skills.scholar.rating,
        hunter: skills.hunter.rating,
        alchemist: skills.alchemist.rating,
        arcanist: skills.arcanist.rating,
        beggar: skills.beggar.rating
      };
    }, actorId);
    expect(persisted).toEqual({
      fighter: 4,
      scholar: 3,
      hunter: 5,
      alchemist: 2,
      arcanist: 6,
      beggar: 1
    });

    // Clean up so repeated runs don't pile actors up in the world.
    await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
  });
});
