import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { CharacterSheet } from '../pages/CharacterSheet.mjs';
import { RollDialog } from '../pages/RollDialog.mjs';
import { RollChatCard } from '../pages/RollChatCard.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §3 Rolls — "Deeper Understanding" (SG p.87) — post-roll wise-aid Fate spend
 * that rerolls ONE failed die (a wyrm) on a test related to one of the
 * roller's wises. TEST_PLAN.md line 163 originally labeled this mechanic as
 * a "Persona" spend adding "+2 successes" — that matches no rule in either
 * book. The authoritative text is SG p.87:
 *
 *   "Deeper Understanding — A player may spend one fate point to reroll a
 *    wyrm — a single failed die — on a roll related to one of their wises.
 *    ... Use this option before spending fate to reroll 6s."
 *
 * This spec is aligned to RAW (SG p.87) and to the codebase implementation
 * in `_handleDeeperUnderstanding` (module/dice/post-roll.mjs line 181-249).
 * The TEST_PLAN.md checkbox description is updated in the same change.
 *
 * Distinct from two adjacent mechanics already tested elsewhere:
 *   - "Fate: Luck" (fate-reroll.spec.mjs) — Fate 1 to explode 6s (SG p.87,
 *     same page but different sub-section). The template forces Deeper
 *     Understanding to render/resolve BEFORE Fate: Luck via the
 *     `{{#unless luckUsed}}` guard around the `deeper-understanding` button
 *     (roll-result.hbs line 91), matching SG p.87 "Use this option before
 *     spending fate to reroll 6s".
 *   - "Ah, Of Course!" (wise-aid-persona.spec.mjs) — Persona 1 to reroll ALL
 *     wyrms and append them (DH p.77). Deeper Understanding rerolls a SINGLE
 *     wyrm IN PLACE (post-roll.mjs line 208 `diceResults[wyrmIdx] = newDie`),
 *     not append.
 *
 * Button gating (roll-result.hbs lines 90-99 + roll-utils.mjs
 * `buildChatTemplateData`):
 *   `{{#unless deeperUsed}}{{#unless luckUsed}}{{#if hasFate}}
 *    {{#if wiseSelected}}{{#if hasWyrms}} ...`
 *   - `deeperUsed = false` — Deeper Understanding hasn't been used yet
 *   - `luckUsed   = false` — Fate: Luck wasn't used first
 *   - `hasFate`   — actor is character AND fate.current > 0 (roll-utils.mjs line 131)
 *   - `wiseSelected` — `flags.tb2e.wise` set by pre-roll wise pick (roll-utils.mjs line 130)
 *   - `hasWyrms`  — at least one die with `success === false` (roll-utils.mjs line 127)
 *
 * `_handleDeeperUnderstanding` (post-roll.mjs line 181-249) flow:
 *   1. Guards: actor found, fate.current >= 1 (line 187), not already
 *      `deeperUsed` (line 191), not `luckUsed` (line 195).
 *   2. `wyrmIdx = diceResults.findIndex(d => !d.success && !d.isLuck)` —
 *      picks the FIRST wyrm (line 202). Excludes already-appended luck dice
 *      so a chained Luck→Deeper would re-roll an original-pool wyrm.
 *   3. `evaluateRoll(1)` rolls 1 new d6 and tags it `isRerolled: true`
 *      (line 207). The new die REPLACES the old die at `wyrmIdx` (line 208)
 *      — critical distinction vs Luck/Of Course which append. So the total
 *      dice count is unchanged after Deeper Understanding.
 *   4. Recount successes from the whole pool (line 211).
 *   5. Deduct 1 Fate: `current -= 1`, `spent += 1` (lines 214-217).
 *   6. If a wise was picked pre-roll (`tbFlags.wise`), flip
 *      `wises[wise.index].fate = true` on the actor (lines 220-228) and
 *      call `_checkWiseAdvancement` — if all 4 boxes (pass/fail/fate/
 *      persona) are set this posts the wise-advancement card (DH p.78).
 *      This spec asserts the mark flip but intentionally DOES NOT hit the
 *      milestone (separate spec covers that in wise-aid-persona).
 *   7. Flip `flags.tb2e.deeperUsed = true` (line 234), recalculate pass via
 *      `recalculateSuccesses` (line 238-243), and re-render the card.
 *
 * Dice determinism (Foundry d6 face = Math.ceil((1 - u) * 6); source:
 * foundry/client/dice/terms/dice.mjs line 360):
 *   - u = 0.5   → face 3 (fail, no sun — all wyrms)
 *   - u = 0.001 → face 6 (sun, success)
 */
test.describe('§3 Rolls — Deeper Understanding (reroll one wyrm for 1 Fate)', () => {
  test.afterEach(async ({ page }) => {
    // Restore the PRNG stub so the next spec on a shared Page gets real
    // randomness. Same pattern as ability-test-basic / wise-aid-persona /
    // fate-reroll.
    await page.evaluate(() => {
      if (globalThis.__tb2eE2EPrevRandomUniform) {
        CONFIG.Dice.randomUniform = globalThis.__tb2eE2EPrevRandomUniform;
        delete globalThis.__tb2eE2EPrevRandomUniform;
      }
    });
  });

  test('spends 1 Fate, rerolls 1 wyrm in place, and marks wises[i].fate (SG p.87)', async ({ page }) => {
    const suffix = Date.now();
    const actorName = `E2E Deeper Understanding ${suffix}`;
    const wiseName = `Ruin-wise ${suffix}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Character with Will 3 (deterministic pool, keeps the chat card tidy),
    // Fate 2 so the -1 decrement assertion is unambiguous (current 2 → 1,
    // spent 0 → 1), Persona 0 so no Of Course button appears (we're not
    // testing that here), and exactly ONE named wise at index 0 with all
    // four advancement boxes OFF — so the post-roll `wise.fate = true` flip
    // is the only mark that changes, and the milestone (all 4 boxes) is NOT
    // hit (that path is covered in wise-aid-persona.spec.mjs).
    // Fresh disabled so the baseline pool is exactly rating (same rationale
    // as ability-test-basic).
    const actorId = await page.evaluate(async ({ n, w }) => {
      const actor = await Actor.create({
        name: n,
        type: 'character',
        system: {
          abilities: {
            will:   { rating: 3, pass: 0, fail: 0 },
            health: { rating: 3, pass: 0, fail: 0 },
            nature: { rating: 3, max: 3, pass: 0, fail: 0 }
          },
          persona: { current: 0, spent: 0 },
          fate:    { current: 2, spent: 0 },
          wises: [
            { name: w, pass: false, fail: false, fate: false, persona: false }
          ],
          conditions: { fresh: false }
        }
      });
      return actor.id;
    }, { n: actorName, w: wiseName });
    expect(actorId).toBeTruthy();

    // Initial stub: all-3s → 3D pool = 0 successes, all wyrms. `hasWyrms`
    // flips true so the Deeper Understanding button is eligible to render
    // (template roll-result.hbs line 92 `{{#if hasWyrms}}`). No suns in the
    // pool means `hasSuns` is false, so the Fate: Luck button will NOT
    // appear alongside — we isolate the Deeper Understanding path.
    await page.evaluate(() => {
      globalThis.__tb2eE2EPrevRandomUniform = CONFIG.Dice.randomUniform;
      CONFIG.Dice.randomUniform = () => 0.5;
    });

    await page.evaluate((id) => {
      game.actors.get(id).sheet.render(true);
    }, actorId);

    const sheet = new CharacterSheet(page, actorName);
    await sheet.expectOpen();
    await sheet.openAbilitiesTab();

    const initialChatCount = await page.evaluate(() => game.messages.contents.length);

    await sheet.rollAbilityRow('will').click();

    const dialog = new RollDialog(page);
    await dialog.waitForOpen();

    // Pick the wise — required for `wiseSelected` to flip true on the chat
    // card and thereby enable the Deeper Understanding button (roll-result.hbs
    // line 92 `{{#if wiseSelected}}`).
    await expect(dialog.wiseSection).toHaveCount(1);
    await dialog.selectWise(0);

    // Ob 1 so the raw roll at 0 successes is a clear FAIL. After Deeper
    // Understanding rerolls one wyrm with the 6s stub below, the new die is
    // a success → 1 success total ≥ Ob 1 → PASS. This proves the outcome
    // flipped and that `recalculateSuccesses` ran on the post-roll path.
    await dialog.fillObstacle(1);
    await dialog.submit();

    await expect
      .poll(() => page.evaluate(() => game.messages.contents.length), { timeout: 10_000 })
      .toBeGreaterThan(initialChatCount);

    const card = new RollChatCard(page);
    await card.expectPresent();

    // Initial roll shape — 3D, 3 wyrms, 0 successes, FAIL vs Ob 1.
    expect(await card.getPool()).toBe(3);
    await expect(card.diceResults).toHaveCount(3);
    expect(await card.getSuccesses()).toBe(0);
    expect(await card.getObstacle()).toBe(1);
    expect(await card.isPass()).toBe(false);

    // Deeper Understanding button must be visible — all four conditions
    // hold: hasFate (fate.current=2), wiseSelected (we picked the wise),
    // hasWyrms (3 failed dice), !deeperUsed && !luckUsed (never clicked).
    await expect(card.deeperUnderstandingButton).toBeVisible();

    // Swap the PRNG stub to u=0.001 → face 6 on the reroll. The single-die
    // reroll in `_handleDeeperUnderstanding` (post-roll.mjs line 206) rolls
    // 1 die via `evaluateRoll(1)`. With this stub, that die lands 6 (a sun,
    // a success). Deeper Understanding replaces the wyrm IN PLACE at
    // `wyrmIdx` (line 208) — so the total dice count stays at 3, not 4.
    await page.evaluate(() => {
      CONFIG.Dice.randomUniform = () => 0.001;
    });

    await card.clickDeeperUnderstanding();

    // Fate decremented: current 2 → 1, spent 0 → 1 (post-roll.mjs line 214-217).
    const fateAfter = await page.evaluate((id) => {
      const a = game.actors.get(id);
      return { current: a.system.fate.current, spent: a.system.fate.spent };
    }, actorId);
    expect(fateAfter).toEqual({ current: 1, spent: 1 });

    // Card updated — 0 + 1 new success from the reroll = 1 success. Dice
    // count UNCHANGED at 3 (Deeper Understanding replaces in place, unlike
    // Fate: Luck / Of Course which append).
    await expect
      .poll(() => card.getSuccesses(), { timeout: 5_000 })
      .toBe(1);
    await expect(card.diceResults).toHaveCount(3);

    // Outcome flipped FAIL → PASS (0 < Ob 1 became 1 ≥ Ob 1).
    // `_handleDeeperUnderstanding` runs `recalculateSuccesses` (post-roll.mjs
    // line 238-243) to update `pass`.
    expect(await card.isPass()).toBe(true);

    // wise.fate flag flipped on the actor — the advancement mark that
    // Deeper Understanding leaves behind (DH p.78: each use of a wise ticks
    // one of four boxes; this one is `fate`). The other three stay false
    // (we staged them all false and made only this one roll).
    const wiseAfter = await page.evaluate((id) => {
      const w = game.actors.get(id).system.wises[0];
      return { name: w.name, pass: w.pass, fail: w.fail, fate: w.fate, persona: w.persona };
    }, actorId);
    expect(wiseAfter).toEqual({
      name: wiseName,
      pass: false,
      fail: false,
      fate: true,
      persona: false
    });

    // Flag-level assertions on the chat message — confirm the `deeperUsed:
    // true` marker (post-roll.mjs line 234) that hides the button on
    // re-renders (template roll-result.hbs line 90 `{{#unless deeperUsed}}`),
    // plus the in-place replacement shape: diceResults still length 3, and
    // EXACTLY one die has `isRerolled: true` (the replacement die; original
    // dice have no such flag). Scope by actorId so a repeated run doesn't
    // see stale cards from earlier iterations.
    const msgFlags = await page.evaluate((id) => {
      const m = game.messages.contents
        .filter(msg => msg.flags?.tb2e?.roll && msg.flags.tb2e.actorId === id)
        .slice(-1)[0];
      if (!m) return null;
      const d = m.flags.tb2e.roll.diceResults;
      return {
        deeperUsed: !!m.flags.tb2e.deeperUsed,
        luckUsed: !!m.flags.tb2e.luckUsed,
        successes: m.flags.tb2e.roll.successes,
        finalSuccesses: m.flags.tb2e.roll.finalSuccesses,
        pass: m.flags.tb2e.roll.pass,
        diceLen: d.length,
        rerolledCount: d.filter(x => x.isRerolled).length,
        rerolledIsSuccess: d.find(x => x.isRerolled)?.success === true,
        wise: m.flags.tb2e.wise
      };
    }, actorId);
    expect(msgFlags).toEqual({
      deeperUsed: true,
      luckUsed: false,
      successes: 1,
      finalSuccesses: 1,
      pass: true,
      diceLen: 3,
      rerolledCount: 1,
      rerolledIsSuccess: true,
      wise: { name: wiseName, index: 0 }
    });

    // Only one wise mark (`fate`) set → no milestone → no wise-advancement
    // card posted for THIS actor. (Filter by actorId — repeat-each=3 on a
    // shared Foundry world could otherwise see advancement cards left by
    // earlier iterations if another test hit a milestone.)
    const advancementCount = await page.evaluate((id) => {
      return game.messages.contents.filter(
        m => m.flags?.tb2e?.wiseAdvancement && m.flags.tb2e.actorId === id
      ).length;
    }, actorId);
    expect(advancementCount).toBe(0);

    await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
  });

  test('Deeper Understanding button is absent when fate.current = 0 (gated on hasFate)', async ({ page }) => {
    const suffix = Date.now();
    const actorName = `E2E Deeper Understanding NoFate ${suffix}`;
    const wiseName = `Ruin-wise ${suffix}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Same shape as test 1 but fate=0 — so even with wyrms in the pool AND
    // a wise selected pre-roll, `hasFate` is false (roll-utils.mjs line 131)
    // and the template skips the Deeper Understanding button (roll-result.hbs
    // line 92 `{{#if hasFate}}`). Isolates the fate gate from the other two
    // gates (wiseSelected, hasWyrms).
    const actorId = await page.evaluate(async ({ n, w }) => {
      const actor = await Actor.create({
        name: n,
        type: 'character',
        system: {
          abilities: {
            will:   { rating: 3, pass: 0, fail: 0 },
            health: { rating: 3, pass: 0, fail: 0 },
            nature: { rating: 3, max: 3, pass: 0, fail: 0 }
          },
          persona: { current: 0, spent: 0 },
          fate:    { current: 0, spent: 0 },
          wises: [
            { name: w, pass: false, fail: false, fate: false, persona: false }
          ],
          conditions: { fresh: false }
        }
      });
      return actor.id;
    }, { n: actorName, w: wiseName });
    expect(actorId).toBeTruthy();

    // All-3s → wyrms in the pool. Confirms the button's absence is driven
    // by `hasFate` alone, not by missing `hasWyrms`.
    await page.evaluate(() => {
      globalThis.__tb2eE2EPrevRandomUniform = CONFIG.Dice.randomUniform;
      CONFIG.Dice.randomUniform = () => 0.5;
    });

    await page.evaluate((id) => {
      game.actors.get(id).sheet.render(true);
    }, actorId);

    const sheet = new CharacterSheet(page, actorName);
    await sheet.expectOpen();
    await sheet.openAbilitiesTab();

    const initialChatCount = await page.evaluate(() => game.messages.contents.length);

    await sheet.rollAbilityRow('will').click();

    const dialog = new RollDialog(page);
    await dialog.waitForOpen();
    await dialog.selectWise(0);
    await dialog.fillObstacle(1);
    await dialog.submit();

    await expect
      .poll(() => page.evaluate(() => game.messages.contents.length), { timeout: 10_000 })
      .toBeGreaterThan(initialChatCount);

    const card = new RollChatCard(page);
    await card.expectPresent();

    // 3 wyrms present → hasWyrms true, wise selected → wiseSelected true —
    // but hasFate is false, so the button is not rendered.
    await expect(card.diceResults).toHaveCount(3);
    expect(await card.getSuccesses()).toBe(0);
    await expect(card.deeperUnderstandingButton).toHaveCount(0);

    await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
  });
});
