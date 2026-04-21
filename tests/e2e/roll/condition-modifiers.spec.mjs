import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { CharacterSheet } from '../pages/CharacterSheet.mjs';
import { RollDialog } from '../pages/RollDialog.mjs';
import { RollChatCard } from '../pages/RollChatCard.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §3 Rolls — condition-based dice modifiers on the roll dialog.
 *
 * Rule under test (per TEST_PLAN.md line 158):
 *   "toggle afraid, roll Will; verify -1D applied per DH p.53"
 *
 * BLOCKED — mismatch between the TEST_PLAN checkbox and RAW.
 *   Conditions actually live in the Scholar's Guide (SG pp.46-52), not
 *   DH p.53. Per SG p.48 (Afraid) RAW:
 *     "While afraid, adventurers can't offer help or use Beginner's Luck.
 *      However, they can use Nature to test in place of unlearned skills."
 *   Afraid does NOT impose a -1D penalty on Will (or any) test. -1D is
 *   reserved for injured and sick (SG pp.49-52 and reinforced in the
 *   "Conditions in a Conflict" summary on SG p.54: "Characters who are
 *   injured or sick suffer -1D to all rolls, including disposition.").
 *
 *   The production implementation is consistent with RAW:
 *     module/dice/tb2e-roll.mjs `gatherConditionModifiers` only emits
 *     modifiers for fresh (+1D), injured (-1D), and sick (-1D). Afraid
 *     is used by the dialog (_showRollDialog) solely to gate help /
 *     wise-aid (`hasHelpers = !isAfraid && ...`) and by `rollTest` as a
 *     BL hard-block (line 1248) — never as a dice penalty.
 *
 * Therefore the spec as written in the plan cannot pass without a
 * deviation from RAW. Per CLAUDE.md (Rules As Written), we do not fake
 * the -1D. Spec left behind test.fixme() with a note so a future
 * decision to houserule this (or a test-plan correction) can flip the
 * fixme atomically.
 *
 * To turn this green:
 *   Option A (RAW-preserving): rewrite the TEST_PLAN line 158 entry to
 *     target injured or sick instead, and update this spec's condition
 *     key + label assertion accordingly.
 *   Option B (deviation): add afraid → -1D in
 *     `gatherConditionModifiers` with a CLAUDE.md-style comment noting
 *     the deviation from SG p.48, then remove the test.fixme() below.
 *
 * Implementation map (for when the fixme is removed):
 *   - `rollTest` → `gatherConditionModifiers` builds an array of
 *     `{ type: "dice", value: -1, source: "condition", label, ... }`
 *     for each active condition.
 *   - `_showRollDialog` passes `conditionModifiers` into the template;
 *     `_collectAllModifiers()` picks them up so they appear both in
 *     `.roll-dialog-modifiers` (as rendered rows) AND in the derived
 *     `.roll-dialog-summary-text` ("<N>D vs Ob <M>").
 *   - Submit stamps `poolSize = baseDice + totalDiceBonus` on the chat
 *     message flags; `baseDice` stays at the raw ability rating.
 */
test.describe('§3 Rolls — condition dice modifiers', () => {
  test.afterEach(async ({ page }) => {
    // Clean up the dice stub between tests — the shared Page object
    // persists across specs; a leaked stub would break any downstream
    // test that relies on real randomness.
    await page.evaluate(() => {
      if (globalThis.__tb2eE2EPrevRandomUniform) {
        CONFIG.Dice.randomUniform = globalThis.__tb2eE2EPrevRandomUniform;
        delete globalThis.__tb2eE2EPrevRandomUniform;
      }
    });
  });

  // BLOCKED — see the describe-level comment above. Afraid does NOT impose
  // -1D per RAW (SG p.48). Remove `test.fixme` once either the TEST_PLAN
  // entry is corrected or an explicit RAW deviation is added to
  // `gatherConditionModifiers`.
  test.fixme('toggling afraid reduces a Will roll pool by 1D (TEST_PLAN line 158)', async ({ page }) => {
    const actorName = `E2E Afraid Will ${Date.now()}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Will 4 (rating-1 = 3 is still rollable). fresh=false so the baseline
    // pool is exactly the rating (DH p.56) — any other auto-modifier
    // (fresh/injured/etc.) would muddy the -1 assertion. Matches the
    // pattern in roll-dialog-modifiers.spec.mjs.
    const actorId = await page.evaluate(async (n) => {
      const actor = await Actor.create({
        name: n,
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
      return actor.id;
    }, actorName);
    expect(actorId).toBeTruthy();

    // Stub PRNG to all-6s → every die is a success. 3D (after the afraid
    // penalty) vs Ob 2 is a deterministic PASS with 3 successes.
    await page.evaluate(() => {
      globalThis.__tb2eE2EPrevRandomUniform = CONFIG.Dice.randomUniform;
      CONFIG.Dice.randomUniform = () => 0.001;
    });

    await page.evaluate((id) => {
      game.actors.get(id).sheet.render(true);
    }, actorId);

    const sheet = new CharacterSheet(page, actorName);
    await sheet.expectOpen();

    // -- Baseline snapshot: without afraid, the Will dialog pool equals
    //    the rating exactly (4D). This guards the "modifier is coming from
    //    the condition, not from somewhere else" assertion below.
    await sheet.openAbilitiesTab();
    await sheet.rollAbilityRow('will').click();

    const baselineDialog = new RollDialog(page);
    await baselineDialog.waitForOpen();
    expect(await baselineDialog.getPoolSize()).toBe(4);
    expect(await baselineDialog.getSummaryPool()).toBe(4);
    expect(await baselineDialog.modifierRows.count()).toBe(0);
    await baselineDialog.cancel();

    // -- Toggle afraid ON via the sheet's conditions strip
    //    (SG p.48 — the button clears `fresh` and flips `afraid` true).
    const afraidToggle = sheet.conditionToggle('afraid');
    await afraidToggle.click();
    await expect
      .poll(() =>
        page.evaluate((id) => game.actors.get(id)?.system.conditions.afraid, actorId)
      )
      .toBe(true);
    await expect(afraidToggle).toHaveClass(/(^|\s)active(\s|$)/);

    // Re-open the Will roll dialog now that afraid is set. `gatherCondition
    // Modifiers` should emit a { type: "dice", value: -1, source:
    // "condition", label: "Afraid" } entry which:
    //   - lands in the rendered modifier list (.roll-modifier row)
    //   - is subtracted from the summary pool (4 → 3)
    //   - flows into the submit callback's totalDiceBonus
    const initialChatCount = await page.evaluate(() => game.messages.contents.length);
    await sheet.rollAbilityRow('will').click();

    const dialog = new RollDialog(page);
    await dialog.waitForOpen();

    // Baseline input = rating (condition mods do NOT rewrite `poolSize`).
    expect(await dialog.getPoolSize()).toBe(4);
    // Summary reflects the -1D auto-mod.
    expect(await dialog.getSummaryPool()).toBe(3);
    // Exactly one condition row rendered; labelled "Afraid".
    await expect(dialog.modifierRows).toHaveCount(1);
    await expect(dialog.modifierRows.first()).toContainText(/afraid/i);

    // Submit with Ob 2 → 3D all-6s = 3 successes → PASS.
    await dialog.fillObstacle(2);
    await dialog.submit();

    await expect
      .poll(() => page.evaluate(() => game.messages.contents.length), { timeout: 10_000 })
      .toBeGreaterThan(initialChatCount);

    const card = new RollChatCard(page);
    await card.expectPresent();

    // Card shape — pool 3 (4 rating - 1 afraid), 3 sixes, PASS vs Ob 2.
    expect(await card.getPool()).toBe(3);
    await expect(card.diceResults).toHaveCount(3);
    expect(await card.getSuccesses()).toBe(3);
    expect(await card.getObstacle()).toBe(2);
    expect(await card.isPass()).toBe(true);

    // Flag shape: `baseDice` = ability rating (4), `poolSize` reflects the
    // applied condition mod (3). Regression-guards `_buildRollFlags`.
    const flags = await page.evaluate(() => {
      const msg = game.messages.contents.at(-1);
      const f = msg?.flags?.tb2e?.roll;
      return f ? {
        type: f.type,
        key: f.key,
        baseDice: f.baseDice,
        poolSize: f.poolSize,
        successes: f.successes,
        obstacle: f.obstacle,
        pass: f.pass
      } : null;
    });
    expect(flags).toEqual({
      type: 'ability',
      key: 'will',
      baseDice: 4,
      poolSize: 3,
      successes: 3,
      obstacle: 2,
      pass: true
    });

    await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
  });
});
