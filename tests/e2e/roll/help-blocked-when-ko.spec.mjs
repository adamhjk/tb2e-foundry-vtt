import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { CharacterSheet } from '../pages/CharacterSheet.mjs';
import { RollDialog } from '../pages/RollDialog.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §3 Rolls — a KO'd helper is filtered out of the eligible-helpers pool
 * (DH p.63, help.mjs:57).
 *
 * Rules under test:
 *   - DH p.63: "Help: If you can help another party member, you grant them
 *     +1D." — eligibility is gated by `isBlockedFromHelping` in module/dice/
 *     help.mjs lines 53-59. The KO predicate (line 57) is
 *     `conflictHP?.max > 0 && conflictHP.value <= 0` — i.e. the helper has
 *     entered conflict (max > 0) and their disposition has been driven to
 *     zero (value <= 0). Such a helper is excluded from the pool returned
 *     by `getEligibleHelpers`.
 *
 * Shape of the gate:
 *   - Help in this codebase is a PRE-ROLL dialog toggle (see help-accept.spec.mjs
 *     for the positive path). `getEligibleHelpers` runs BEFORE the dialog
 *     renders; a blocked helper is filtered out of `availableHelpers`, which
 *     means `pcHelpers` / `npcHelpers` are empty and `hasHelpers` is false
 *     (tb2e-roll.mjs line 416-418). With `hasHelpers: false`, the
 *     `{{#if hasHelpers}}` guard in templates/dice/roll-dialog.hbs line 202
 *     suppresses the entire `.roll-dialog-helpers` section — no helper row,
 *     no toggle button, nothing to click.
 *
 *   - That means the assertion for "KO'd helper is blocked" is:
 *       a) the helper's `.helper-toggle[data-helper-id="<id>"]` has count 0, AND
 *       b) when B is the only candidate, the entire helpers section has
 *          count 0 (confirms the filter didn't just move B; it removed B).
 *
 * Staging:
 *   - Stage B with `system.conflict.hp = { max: 3, value: 0 }`. This
 *     satisfies the exact predicate at help.mjs line 57 — both conditions
 *     must hold: max > 0 (B has entered conflict) AND value <= 0 (B is
 *     KO'd). Setting this on the world actor is sufficient because the
 *     scene token is a linked token (`actorLink: true`), so the synthetic
 *     actor inherits the world actor's system data. (CLAUDE.md §Synthetic
 *     Tokens only matters when the token is unlinked — not the case here.)
 *
 * Control:
 *   - `help-accept.spec.mjs` already proves that the SAME scene + same rating
 *     + `conflict.hp = { max: 0, value: 0 }` produces B as an eligible
 *     helper. This spec isolates the KO predicate as the sole differentiator
 *     — no second test is needed.
 *
 * TEST_PLAN.md checkbox phrasing note:
 *   - "KO'd helper cannot accept Help" implies a post-roll chat-card
 *     acceptance. That's not how help works here (see help-accept.spec.mjs
 *     comment). The real gate is pre-roll filtering by
 *     `isBlockedFromHelping`. The TEST_PLAN line is updated to match.
 */
test.describe('§3 Rolls — KO\'d helper is filtered from the eligible-helpers pool', () => {
  test.afterEach(async ({ page }) => {
    // Restore PRNG stub (none is set in this spec, but keep the guard for
    // symmetry with help-accept.spec.mjs — a shared Page can leak state).
    // Delete any scene we created. Unique name prefix keeps this spec from
    // nuking scenes produced by other tests.
    await page.evaluate(async () => {
      if (globalThis.__tb2eE2EPrevRandomUniform) {
        CONFIG.Dice.randomUniform = globalThis.__tb2eE2EPrevRandomUniform;
        delete globalThis.__tb2eE2EPrevRandomUniform;
      }
      for (const s of [...game.scenes.filter(s => s.name?.startsWith('E2E Help-KO Scene'))]) {
        try { await s.delete(); } catch {}
      }
    });
  });

  test('KO\'d helper is removed from pool; no helper toggle renders (DH p.63, help.mjs:57)',
  async ({ page }) => {
    const suffix = Date.now();
    const rollerName = `E2E KO-Roller ${suffix}`;
    const helperName = `E2E KO-Helper ${suffix}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Create roller + helper. Helper has Will rating 2 (would qualify as a
    // same-ability helper if not for the KO state). Staging B as KO'd
    // happens in the same call — `system.conflict.hp = { max: 3, value: 0 }`
    // satisfies the exact predicate at help.mjs line 57:
    //   `conflictHP?.max > 0 && conflictHP.value <= 0`
    // Both conditions are load-bearing: max must be > 0 (B is actually in
    // a conflict) AND value must be <= 0 (B is down).
    const { rollerId, helperId } = await page.evaluate(async ({ rn, hn }) => {
      const roller = await Actor.create({
        name: rn,
        type: 'character',
        system: {
          abilities: {
            will:   { rating: 4, pass: 0, fail: 0 },
            health: { rating: 3, pass: 0, fail: 0 },
            nature: { rating: 3, max: 3, pass: 0, fail: 0 }
          },
          conditions: { fresh: false }
        }
      });
      const helper = await Actor.create({
        name: hn,
        type: 'character',
        system: {
          abilities: {
            will:   { rating: 2, pass: 0, fail: 0 },
            health: { rating: 3, pass: 0, fail: 0 },
            nature: { rating: 3, max: 3, pass: 0, fail: 0 }
          },
          // Explicitly not dead, not afraid — so those earlier branches of
          // isBlockedFromHelping (help.mjs lines 54-55) don't fire and we
          // isolate the KO gate (help.mjs:57) as the reason for exclusion.
          conditions: { fresh: false, afraid: false, dead: false },
          // RAW (DH p.63 + help.mjs:57): a helper whose conflict HP has
          // been driven to 0 with max > 0 is KO'd and cannot help. Stage
          // this directly rather than routing through a live Combat —
          // `isBlockedFromHelping` only inspects actor system fields.
          conflict: { hp: { max: 3, value: 0 } }
        }
      });
      return { rollerId: roller.id, helperId: helper.id };
    }, { rn: rollerName, hn: helperName });
    expect(rollerId).toBeTruthy();
    expect(helperId).toBeTruthy();

    // Provision a scene with linked tokens for both actors. Matches the
    // help-accept.spec.mjs pattern — help.mjs line 91-113 requires scene
    // tokens for the primary pool, and `actorLink: true` means the scene
    // token reflects the world actor's `system.conflict.hp` directly.
    const sceneId = await page.evaluate(async ({ rId, hId, suf }) => {
      const scene = await Scene.create({
        name: `E2E Help-KO Scene ${suf}`,
        active: true,
        width: 1000,
        height: 1000,
        padding: 0,
        grid: { type: 1, size: 100 }
      });
      await scene.createEmbeddedDocuments('Token', [
        {
          name: game.actors.get(rId).name,
          actorId: rId,
          actorLink: true,
          x: 100, y: 100,
          width: 1, height: 1
        },
        {
          name: game.actors.get(hId).name,
          actorId: hId,
          actorLink: true,
          x: 300, y: 100,
          width: 1, height: 1
        }
      ]);
      await scene.view();
      return scene.id;
    }, { rId: rollerId, hId: helperId, suf: suffix });
    expect(sceneId).toBeTruthy();

    // Open the roller's sheet and click Will. We don't stub PRNG or submit
    // the roll — the assertion fires on the dialog contents, before
    // submission.
    await page.evaluate((id) => {
      game.actors.get(id).sheet.render(true);
    }, rollerId);

    const sheet = new CharacterSheet(page, rollerName);
    await sheet.expectOpen();
    await sheet.openAbilitiesTab();
    await sheet.rollAbilityRow('will').click();

    const dialog = new RollDialog(page);
    await dialog.waitForOpen();

    // Baseline — rating-only pool with no helpers (B is KO'd, so no
    // +1D should land pre- or post-toggle).
    expect(await dialog.getPoolSize()).toBe(4);
    expect(await dialog.getSummaryPool()).toBe(4);

    // Primary assertion: B's helper toggle is not rendered.
    // `helperToggle(id)` scopes to `.roll-dialog-helpers .helper-toggle[...]`
    // so count 0 covers both "section missing" and "section present but B
    // filtered out of the list" cases.
    await expect(dialog.helperToggle(helperId)).toHaveCount(0);

    // Secondary assertion: since B is the only candidate on the scene,
    // `hasHelpers` should be false and the entire helpers section should
    // not render (tb2e-roll.mjs line 418 + roll-dialog.hbs line 202). This
    // proves B was filtered OUT of the pool — not just visually hidden.
    await expect(dialog.helpersSection).toHaveCount(0);

    // Cancel to close the dialog cleanly before teardown.
    await dialog.cancel();

    // Cleanup actors (scene is deleted in afterEach).
    await page.evaluate(({ rId, hId }) => {
      game.actors.get(rId)?.delete();
      game.actors.get(hId)?.delete();
    }, { rId: rollerId, hId: helperId });
  });
});
