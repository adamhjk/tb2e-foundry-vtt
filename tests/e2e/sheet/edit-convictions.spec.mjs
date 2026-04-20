import { test, expect } from '@playwright/test';
import { GameUI } from '../pages/GameUI.mjs';
import { CharacterSheet } from '../pages/CharacterSheet.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * Data-model facts (verified against module/data/actor/character.mjs):
 *   - `system.belief`, `system.creed`, `system.goal`, `system.instinct` are
 *     all plain `StringField`s (lines 29-32).
 *   - The Identity tab's "What You Fight For" fieldset renders one
 *     `<textarea rows="2" name="system.<field>">` per conviction
 *     (templates/actors/tabs/character-identity.hbs L27-38), driven by
 *     `_prepareConvictionFields()` in character-sheet.mjs which returns
 *     exactly those four fields in that order.
 *   - The character header renders a `<span class="header-goal">` badge
 *     keyed off `system.goal` (templates/actors/character-header.hbs L25-28).
 *     The badge is only present in the DOM when `goal` is truthy.
 *
 * Scope: fill each of the four conviction textareas + blur, poll the data
 * model for persistence, verify the header goal badge appears with the
 * written goal text, then close + re-render the sheet and reassert all
 * four textareas in the DOM.
 */
test.describe('Character sheet convictions', () => {
  test('edits belief/creed/goal/instinct and updates header goal badge, persisting across re-render', async ({ page }) => {
    const actorName = `E2E Convictions ${Date.now()}`;
    const values = {
      belief: 'The strong must protect the weak.',
      creed: 'Never abandon a companion in need.',
      goal: 'Recover the lost tome of Hargraven.',
      instinct: 'Always check for traps before entering a new room.'
    };

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Create the character actor via the game API (fastest path).
    const actorId = await page.evaluate(async (n) => {
      const actor = await Actor.create({ name: n, type: 'character' });
      return actor.id;
    }, actorName);
    expect(actorId).toBeTruthy();

    // Open the sheet directly.
    await page.evaluate((id) => {
      game.actors.get(id).sheet.render(true);
    }, actorId);

    const sheet = new CharacterSheet(page, actorName);
    await sheet.expectOpen();

    // Identity tab hosts the conviction textareas.
    await sheet.openIdentityTab();

    // Sanity: all four textareas start empty and no goal badge is rendered.
    for (const key of Object.keys(values)) {
      await expect(sheet.convictionTextarea(key)).toBeVisible();
      await expect(sheet.convictionTextarea(key)).toHaveValue('');
    }
    await expect(sheet.headerGoalBadge).toHaveCount(0);

    // Fill each textarea and blur to trigger submitOnChange persistence.
    // Write non-goal fields first so we can assert the header badge appears
    // specifically when `goal` is written.
    for (const key of ['belief', 'creed', 'instinct', 'goal']) {
      await sheet.convictionTextarea(key).fill(values[key]);
      await sheet.convictionTextarea(key).blur();

      await expect
        .poll(() =>
          page.evaluate(
            ([id, k]) => game.actors.get(id)?.system[k],
            [actorId, key]
          )
        )
        .toBe(values[key]);
    }

    // The header goal badge appears once `system.goal` is set. The sheet
    // re-renders on the submit, so poll for visibility rather than assuming
    // it's synchronous.
    await expect(sheet.headerGoalBadge).toBeVisible();
    await expect(sheet.headerGoalBadge).toContainText(values.goal);

    // Close + re-render the sheet to verify DOM persistence.
    await page.evaluate((id) => {
      game.actors.get(id).sheet.close();
    }, actorId);
    await expect(sheet.root).toHaveCount(0);

    await page.evaluate((id) => {
      game.actors.get(id).sheet.render(true);
    }, actorId);

    const rerendered = new CharacterSheet(page, actorName);
    await rerendered.expectOpen();
    await rerendered.openIdentityTab();

    for (const key of Object.keys(values)) {
      await expect(rerendered.convictionTextarea(key)).toHaveValue(values[key]);
    }
    await expect(rerendered.headerGoalBadge).toBeVisible();
    await expect(rerendered.headerGoalBadge).toContainText(values.goal);

    // Final authoritative data-model check.
    const persisted = await page.evaluate((id) => {
      const a = game.actors.get(id);
      return {
        belief: a.system.belief,
        creed: a.system.creed,
        goal: a.system.goal,
        instinct: a.system.instinct
      };
    }, actorId);
    expect(persisted).toEqual(values);

    // Clean up.
    await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
  });
});
