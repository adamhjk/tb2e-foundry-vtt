import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { CharacterSheet } from '../pages/CharacterSheet.mjs';
import { RollDialog } from '../pages/RollDialog.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §3 Rolls — non-dice-modifier side effects of conditions (RAW).
 *
 * Companion to `condition-modifiers.spec.mjs` (dice pool mods for fresh /
 * injured / sick). This spec covers the RAW side effects that change
 * test-time behavior WITHOUT moving dice, as implemented in production:
 *
 *   - afraid  : can't offer help, can't use Beginner's Luck  (SG p.48)
 *   - dead    : can't offer help                             (SG pp.52, 54)
 *   - angry   : can't use beneficial traits or wises         (SG pp.47-48, 54)
 *
 * Production map:
 *   - `module/dice/help.mjs` isBlockedFromHelping L53-59 gates afraid/dead
 *     before the eligible-helpers pool is built.
 *   - `module/dice/tb2e-roll.mjs` L1248-1251 short-circuits `rollTest` when
 *     the roller is afraid AND the test resolves to Beginner's Luck.
 *   - `module/dice/tb2e-roll.mjs` L338-343 (`_buildTraitData`) marks
 *     benefit-use disabled on all traits when `isAngry` is true.
 *   - `module/dice/tb2e-roll.mjs` L392 (`hasWises`) flips the wise
 *     selector off in the roll dialog when `isAngry` is true.
 *
 * Out of scope:
 *   - RAW condition effects NOT implemented in production (and thus not
 *     yet wired anywhere to assert):
 *       * hungry  → -1s team disposition in conflicts      (SG pp.47, 54)
 *       * exhausted → -1s team disposition in conflicts    (SG pp.48-49, 54)
 *       * angry   → +1 Ob / -1s in social conflicts        (SG pp.47-48, 54)
 *       * sick    → blocks advancement / practice / learning (SG p.51)
 *       * dead    → skills/abilities reduced to 0 at test  (SG pp.52, 54)
 *     These are RAW gaps in production. Leaving them uncovered until the
 *     feature lands, per CLAUDE.md §"Rules As Written" ("don't test for
 *     anything that isn't RAW" ⟂ production).
 *   - The monster `effectiveNature` -1 per injured/sick derivation
 *     (`module/data/actor/monster.mjs` L72-74) is data-model scope;
 *     covered indirectly by conflict specs that use injured/sick monsters.
 */

/**
 * Create a scene with linked tokens for each of the given actorIds, and
 * make it the active scene. Follows the help-blocked-when-ko.spec.mjs
 * pattern — `getEligibleHelpers` / `help.mjs` requires scene tokens for
 * the primary candidate pool at help.mjs L91-113.
 */
async function stageScene(page, { name, actorIds }) {
  return page.evaluate(async ({ sceneName, ids }) => {
    const scene = await Scene.create({
      name: sceneName,
      active: true,
      width: 1000,
      height: 1000,
      padding: 0,
      grid: { type: 1, size: 100 }
    });
    const tokens = ids.map((id, i) => ({
      name: game.actors.get(id).name,
      actorId: id,
      actorLink: true,
      x: 100 + i * 200,
      y: 100,
      width: 1, height: 1
    }));
    await scene.createEmbeddedDocuments('Token', tokens);
    await scene.view();
    return scene.id;
  }, { sceneName: name, ids: actorIds });
}

async function createCharacter(page, name, { conditions = {}, abilities = {}, wises = [] } = {}) {
  return page.evaluate(async ({ n, cond, abil, w }) => {
    const actor = await Actor.create({
      name: n,
      type: 'character',
      system: {
        abilities: {
          will:   { rating: 4, pass: 0, fail: 0, ...(abil.will || {}) },
          health: { rating: 3, pass: 0, fail: 0, ...(abil.health || {}) },
          nature: { rating: 3, max: 3, pass: 0, fail: 0, ...(abil.nature || {}) }
        },
        conditions: { fresh: false, ...cond },
        wises: w
      }
    });
    return actor.id;
  }, { n: name, cond: conditions, abil: abilities, w: wises });
}

test.describe('§3 Rolls — condition side effects (non-dice, RAW)', () => {
  test.afterEach(async ({ page }) => {
    await page.evaluate(async () => {
      for (const s of [...game.scenes.filter(s => s.name?.startsWith('E2E Cond Scene'))]) {
        try { await s.delete(); } catch { /* noop */ }
      }
    });
  });

  /* -------------------------------------------- */
  /*  afraid                                       */
  /* -------------------------------------------- */

  // SG p.48 + help.mjs L55: "While afraid, adventurers can't offer help."
  // Same filtering shape as help-blocked-when-ko (isBlockedFromHelping →
  // removed from `availableHelpers` → `hasHelpers = false` → section
  // suppressed by the `{{#if hasHelpers}}` guard in roll-dialog.hbs L202).
  test('afraid helper is filtered out of the eligible-helpers pool', async ({ page }) => {
    const suffix = Date.now();
    const rollerName = `E2E Afraid-Roller ${suffix}`;
    const helperName = `E2E Afraid-Helper ${suffix}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    const rollerId = await createCharacter(page, rollerName);
    const helperId = await createCharacter(page, helperName, {
      conditions: { afraid: true },
      abilities: { will: { rating: 2 } }
    });
    await stageScene(page, { name: `E2E Cond Scene ${suffix}`, actorIds: [rollerId, helperId] });

    await page.evaluate((id) => game.actors.get(id).sheet.render(true), rollerId);

    const sheet = new CharacterSheet(page, rollerName);
    await sheet.expectOpen();
    await sheet.openAbilitiesTab();
    await sheet.rollAbilityRow('will').click();

    const dialog = new RollDialog(page);
    await dialog.waitForOpen();

    // Helper excluded from pool; section absent.
    await expect(dialog.helperToggle(helperId)).toHaveCount(0);
    await expect(dialog.helpersSection).toHaveCount(0);
    // Baseline — 4D rating, no modifiers.
    expect(await dialog.getPoolSize()).toBe(4);
    expect(await dialog.getSummaryPool()).toBe(4);

    await dialog.cancel();
    await page.evaluate(({ rId, hId }) => {
      game.actors.get(rId)?.delete();
      game.actors.get(hId)?.delete();
    }, { rId: rollerId, hId: helperId });
  });

  // SG p.48 + tb2e-roll.mjs L1248-1251: afraid roller cannot use BL.
  // `rollTest` short-circuits with `ui.notifications.warn(AfraidBLWarning)`
  // and returns BEFORE `_showRollDialog` runs — so no dialog opens.
  test('afraid roller cannot invoke Beginner\'s Luck on an unlearned skill', async ({ page }) => {
    const actorName = `E2E Afraid-BL ${Date.now()}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Character is afraid, no fighter skill rating → fighter test would
    // normally trigger BL via health (Fighter's BL ability is "H"/health).
    const actorId = await createCharacter(page, actorName, {
      conditions: { afraid: true }
    });

    // Install a warn-capturing hook so we can prove the short-circuit path
    // ran. `ui.notifications.warn` returns the notification; we intercept.
    const result = await page.evaluate(async (id) => {
      const actor = game.actors.get(id);
      const captured = [];
      const origWarn = ui.notifications.warn.bind(ui.notifications);
      ui.notifications.warn = (msg, opts) => {
        captured.push(msg);
        return origWarn(msg, opts);
      };
      try {
        const { rollTest } = await import('/systems/tb2e/module/dice/_module.mjs');
        await rollTest({ actor, type: 'skill', key: 'fighter' });
      } finally {
        ui.notifications.warn = origWarn;
      }
      return { captured, dialogOpen: document.querySelector('.roll-dialog') !== null };
    }, actorId);

    // The short-circuit fires the localized warning (label key resolves
    // to English in the test world). Match on substring, not exact, to
    // decouple from localization drift.
    expect(result.captured.length).toBe(1);
    expect(result.captured[0]).toMatch(/afraid/i);
    // And crucially: no roll dialog ever opened.
    expect(result.dialogOpen).toBe(false);

    await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
  });

  /* -------------------------------------------- */
  /*  dead                                         */
  /* -------------------------------------------- */

  // SG p.54 + help.mjs L54: "Dead characters cannot test, help or aid."
  // (Production implements only the help-block portion; the test/aid
  // gates are RAW gaps tracked in the describe comment above.)
  test('dead helper is filtered out of the eligible-helpers pool', async ({ page }) => {
    const suffix = Date.now();
    const rollerName = `E2E Dead-Roller ${suffix}`;
    const helperName = `E2E Dead-Helper ${suffix}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    const rollerId = await createCharacter(page, rollerName);
    const helperId = await createCharacter(page, helperName, {
      conditions: { dead: true },
      abilities: { will: { rating: 2 } }
    });
    await stageScene(page, { name: `E2E Cond Scene ${suffix}`, actorIds: [rollerId, helperId] });

    await page.evaluate((id) => game.actors.get(id).sheet.render(true), rollerId);

    const sheet = new CharacterSheet(page, rollerName);
    await sheet.expectOpen();
    await sheet.openAbilitiesTab();
    await sheet.rollAbilityRow('will').click();

    const dialog = new RollDialog(page);
    await dialog.waitForOpen();

    await expect(dialog.helperToggle(helperId)).toHaveCount(0);
    await expect(dialog.helpersSection).toHaveCount(0);

    await dialog.cancel();
    await page.evaluate(({ rId, hId }) => {
      game.actors.get(rId)?.delete();
      game.actors.get(hId)?.delete();
    }, { rId: rollerId, hId: helperId });
  });

  /* -------------------------------------------- */
  /*  angry                                        */
  /* -------------------------------------------- */

  // SG p.47 + tb2e-roll.mjs L338-343: `benefitDisabled = isAngry || ...`
  // An L1 beneficial=1 trait is normally usable (the `(level < 3 &&
  // beneficial <= 0)` guard is false); only the `isAngry` disjunct flips
  // the benefit button to disabled. Control test (without angry) proves
  // the button stays enabled, so the angry flag is the sole cause.
  test('angry disables the beneficial-use button on a usable trait', async ({ page }) => {
    const actorName = `E2E Angry-Trait ${Date.now()}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    const actorId = await createCharacter(page, actorName, {
      conditions: { angry: true }
    });

    // Add a usable L1 trait (beneficial=1 → has a use charge).
    const traitId = await page.evaluate(async (id) => {
      const actor = game.actors.get(id);
      const [item] = await actor.createEmbeddedDocuments('Item', [{
        name: 'Test Trait',
        type: 'trait',
        system: { level: 1, beneficial: 1 }
      }]);
      return item.id;
    }, actorId);
    expect(traitId).toBeTruthy();

    await page.evaluate((id) => game.actors.get(id).sheet.render(true), actorId);

    const sheet = new CharacterSheet(page, actorName);
    await sheet.expectOpen();
    await sheet.openAbilitiesTab();
    await sheet.rollAbilityRow('will').click();

    const dialog = new RollDialog(page);
    await dialog.waitForOpen();

    const traitBtn = dialog.root
      .locator(`.trait-row[data-trait-id="${traitId}"] .trait-btn[data-mode="benefit"]`);
    await expect(traitBtn).toHaveCount(1);
    await expect(traitBtn).toBeDisabled();

    await dialog.cancel();

    // Control: clear angry, re-open dialog, assert the same button is now
    // ENABLED. Isolates `isAngry` as the sole cause of the disabled state.
    await page.evaluate((id) => {
      game.actors.get(id).update({ 'system.conditions.angry': false });
    }, actorId);
    await expect
      .poll(() => page.evaluate((id) => game.actors.get(id)?.system.conditions.angry, actorId))
      .toBe(false);

    await sheet.rollAbilityRow('will').click();
    const dialog2 = new RollDialog(page);
    await dialog2.waitForOpen();
    const traitBtn2 = dialog2.root
      .locator(`.trait-row[data-trait-id="${traitId}"] .trait-btn[data-mode="benefit"]`);
    await expect(traitBtn2).toHaveCount(1);
    await expect(traitBtn2).toBeEnabled();
    await dialog2.cancel();

    await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
  });

  // SG p.47 + tb2e-roll.mjs L392: `hasWises = wiseData.length > 0 && !isAngry`.
  // With angry true, the `{{#if hasWises}}` guard in roll-dialog.hbs L260
  // suppresses `.roll-dialog-wises` entirely — no selector, no options.
  // Control test (without angry) confirms the section renders, proving
  // the angry flag is what suppressed it.
  test('angry hides the wise selector from the roll dialog', async ({ page }) => {
    const actorName = `E2E Angry-Wises ${Date.now()}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    const actorId = await createCharacter(page, actorName, {
      conditions: { angry: true },
      wises: [{ name: 'Test-wise', pass: 0, fail: 0, fate: false, persona: false }]
    });

    await page.evaluate((id) => game.actors.get(id).sheet.render(true), actorId);

    const sheet = new CharacterSheet(page, actorName);
    await sheet.expectOpen();
    await sheet.openAbilitiesTab();
    await sheet.rollAbilityRow('will').click();

    const dialog = new RollDialog(page);
    await dialog.waitForOpen();

    // Wise section suppressed while angry.
    await expect(dialog.wiseSection).toHaveCount(0);

    await dialog.cancel();

    // Control: clear angry → wise section now renders.
    await page.evaluate((id) => {
      game.actors.get(id).update({ 'system.conditions.angry': false });
    }, actorId);
    await expect
      .poll(() => page.evaluate((id) => game.actors.get(id)?.system.conditions.angry, actorId))
      .toBe(false);

    await sheet.rollAbilityRow('will').click();
    const dialog2 = new RollDialog(page);
    await dialog2.waitForOpen();
    await expect(dialog2.wiseSection).toHaveCount(1);
    await dialog2.cancel();

    await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
  });
});
