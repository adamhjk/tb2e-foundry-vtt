import { test, expect } from '@playwright/test';
import { GameUI } from '../pages/GameUI.mjs';
import { CharacterSheet } from '../pages/CharacterSheet.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * DH p.119 — Nature tax & recover mechanics. Two sheet data-actions wire
 * the Nature row's action buttons to actor mutations.
 *
 * Data-model facts (module/data/actor/character.mjs):
 *   - `system.abilities.nature` is a SchemaField with integer fields:
 *       rating 0..7, max 0..7, pass >= 0, fail >= 0.
 *   - The HTML rating input has a dynamic `max="{{nature.max}}"` attribute,
 *     but the handlers update the actor via `document.update()`, not via
 *     the rating input — the browser cap does not gate handler mutations.
 *
 * Handler facts (module/applications/actor/character-sheet.mjs):
 *   #onConserveNature — conserveNature data-action.
 *     * Early-return if `nature.max <= 1` (also template-disabled via
 *       `canConserve = nature.max > 1`).
 *     * Opens DialogV2.confirm. On Yes, updates:
 *         max  -> max - 1
 *         rating -> new max  (i.e. current <= old_max - 1 is pulled up or
 *                             a healthy rating is pulled down to the cap)
 *         pass -> 0
 *         fail -> 0
 *     * On No / dismiss, nothing changes.
 *
 *   #onRecoverNature — recoverNature data-action.
 *     * Early-return if `rating >= max` (also template-disabled via
 *       `canRecover = nature.rating < nature.max`).
 *     * No dialog. Updates:
 *         rating -> rating + 1
 *     * Does NOT touch max, pass, or fail.
 *
 * Template facts (templates/actors/tabs/character-abilities.hbs):
 *   The Nature row lives on the Abilities tab with class `nature-ability-row`
 *   and contains two `.nature-action-btn` buttons carrying the data-actions
 *   above. The `disabled` attribute is bound to the helper flags
 *   `canConserve` / `canRecover` computed in the sheet's context (see
 *   module/applications/actor/character-sheet.mjs around line 346).
 *
 * Scope: exercise both data-actions. Also cover the guards that prevent a
 * mutation when the handler short-circuits. Nature-crisis (post-roll) is
 * a separate path and is intentionally not exercised here.
 */
test.describe('Character sheet nature tax & recover', () => {
  test('conserveNature decrements max, pulls rating to new max, and zeroes pass/fail', async ({ page }) => {
    const actorName = `E2E Nature ${Date.now()}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Create a character and set nature to a known state via the API:
    // max=6, rating=5 (so we can observe rating being pulled DOWN to the
    // new max of 5), plus non-zero pass/fail we can assert get zeroed.
    const actorId = await page.evaluate(async (n) => {
      const actor = await Actor.create({
        name: n,
        type: 'character',
        system: {
          abilities: {
            nature: { rating: 5, max: 6, pass: 2, fail: 1 }
          }
        }
      });
      return actor.id;
    }, actorName);
    expect(actorId).toBeTruthy();

    // Open the sheet and switch to Abilities where the Nature row lives.
    await page.evaluate((id) => {
      game.actors.get(id).sheet.render(true);
    }, actorId);

    const sheet = new CharacterSheet(page, actorName);
    await sheet.expectOpen();
    await sheet.openAbilitiesTab();

    // Sanity: both action buttons are present and enabled given the state.
    await expect(sheet.conserveNatureButton).toBeVisible();
    await expect(sheet.conserveNatureButton).toBeEnabled();

    // Click Conserve — opens a DialogV2.confirm. Accept.
    await sheet.conserveNatureButton.click();
    const dialog = page.locator('dialog.application.dialog').last();
    await expect(dialog).toBeVisible();
    await dialog.locator('button[data-action="yes"]').click();

    // Expect: max 6 -> 5, rating 5 -> 5 (pulled to new max; unchanged here),
    // pass 2 -> 0, fail 1 -> 0. Poll the authoritative model.
    await expect
      .poll(() =>
        page.evaluate((id) => {
          const n = game.actors.get(id).system.abilities.nature;
          return { rating: n.rating, max: n.max, pass: n.pass, fail: n.fail };
        }, actorId)
      )
      .toEqual({ rating: 5, max: 5, pass: 0, fail: 0 });

    // DOM reflects the new values on the inputs.
    await expect(sheet.abilityMax('nature')).toHaveValue('5');
    await expect(sheet.abilityRating('nature')).toHaveValue('5');

    await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
  });

  test('conserveNature cancellation leaves nature state untouched', async ({ page }) => {
    const actorName = `E2E NatureCancel ${Date.now()}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    const actorId = await page.evaluate(async (n) => {
      const actor = await Actor.create({
        name: n,
        type: 'character',
        system: {
          abilities: {
            nature: { rating: 4, max: 5, pass: 1, fail: 2 }
          }
        }
      });
      return actor.id;
    }, actorName);

    await page.evaluate((id) => {
      game.actors.get(id).sheet.render(true);
    }, actorId);

    const sheet = new CharacterSheet(page, actorName);
    await sheet.expectOpen();
    await sheet.openAbilitiesTab();

    await sheet.conserveNatureButton.click();
    const dialog = page.locator('dialog.application.dialog').last();
    await expect(dialog).toBeVisible();
    await dialog.locator('button[data-action="no"]').click();
    await expect(dialog).toBeHidden();

    const post = await page.evaluate((id) => {
      const n = game.actors.get(id).system.abilities.nature;
      return { rating: n.rating, max: n.max, pass: n.pass, fail: n.fail };
    }, actorId);
    expect(post).toEqual({ rating: 4, max: 5, pass: 1, fail: 2 });

    await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
  });

  test('conserveNature button is disabled when nature.max <= 1 (guard)', async ({ page }) => {
    const actorName = `E2E NatureGuard ${Date.now()}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // max = 1 hits the `canConserve = nature.max > 1` guard: the template
    // renders the button with the `disabled` attribute, and the handler
    // additionally early-returns if the button were somehow clicked.
    const actorId = await page.evaluate(async (n) => {
      const actor = await Actor.create({
        name: n,
        type: 'character',
        system: {
          abilities: {
            nature: { rating: 1, max: 1, pass: 0, fail: 0 }
          }
        }
      });
      return actor.id;
    }, actorName);

    await page.evaluate((id) => {
      game.actors.get(id).sheet.render(true);
    }, actorId);

    const sheet = new CharacterSheet(page, actorName);
    await sheet.expectOpen();
    await sheet.openAbilitiesTab();

    await expect(sheet.conserveNatureButton).toBeVisible();
    await expect(sheet.conserveNatureButton).toBeDisabled();

    await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
  });

  test('recoverNature increments rating by 1 (up to max) without touching other fields', async ({ page }) => {
    const actorName = `E2E Recover ${Date.now()}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Taxed state: rating=3, max=5, with non-zero pass/fail we can assert
    // recoverNature does NOT touch.
    const actorId = await page.evaluate(async (n) => {
      const actor = await Actor.create({
        name: n,
        type: 'character',
        system: {
          abilities: {
            nature: { rating: 3, max: 5, pass: 2, fail: 1 }
          }
        }
      });
      return actor.id;
    }, actorName);

    await page.evaluate((id) => {
      game.actors.get(id).sheet.render(true);
    }, actorId);

    const sheet = new CharacterSheet(page, actorName);
    await sheet.expectOpen();
    await sheet.openAbilitiesTab();

    await expect(sheet.recoverNatureButton).toBeVisible();
    await expect(sheet.recoverNatureButton).toBeEnabled();

    // First click — no dialog. rating 3 -> 4, everything else unchanged.
    await sheet.recoverNatureButton.click();
    await expect
      .poll(() =>
        page.evaluate((id) => {
          const n = game.actors.get(id).system.abilities.nature;
          return { rating: n.rating, max: n.max, pass: n.pass, fail: n.fail };
        }, actorId)
      )
      .toEqual({ rating: 4, max: 5, pass: 2, fail: 1 });
    await expect(sheet.abilityRating('nature')).toHaveValue('4');

    // Second click — rating 4 -> 5 (now at cap). Still enabled until the
    // re-render (the template recomputes `canRecover` on next render).
    await sheet.recoverNatureButton.click();
    await expect
      .poll(() =>
        page.evaluate((id) => {
          const n = game.actors.get(id).system.abilities.nature;
          return { rating: n.rating, max: n.max, pass: n.pass, fail: n.fail };
        }, actorId)
      )
      .toEqual({ rating: 5, max: 5, pass: 2, fail: 1 });

    // Now rating == max, so the button must be disabled after re-render.
    await expect(sheet.recoverNatureButton).toBeDisabled();

    await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
  });

  test('recoverNature is disabled when rating == max (canRecover guard)', async ({ page }) => {
    const actorName = `E2E RecoverCap ${Date.now()}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    const actorId = await page.evaluate(async (n) => {
      const actor = await Actor.create({
        name: n,
        type: 'character',
        system: {
          abilities: {
            nature: { rating: 4, max: 4, pass: 0, fail: 0 }
          }
        }
      });
      return actor.id;
    }, actorName);

    await page.evaluate((id) => {
      game.actors.get(id).sheet.render(true);
    }, actorId);

    const sheet = new CharacterSheet(page, actorName);
    await sheet.expectOpen();
    await sheet.openAbilitiesTab();

    await expect(sheet.recoverNatureButton).toBeVisible();
    await expect(sheet.recoverNatureButton).toBeDisabled();

    await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
  });
});
