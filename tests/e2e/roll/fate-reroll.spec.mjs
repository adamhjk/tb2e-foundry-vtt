import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { CharacterSheet } from '../pages/CharacterSheet.mjs';
import { RollDialog } from '../pages/RollDialog.mjs';
import { RollChatCard } from '../pages/RollChatCard.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §3 Rolls — Fate: Luck (DH p.47 / SG p.87) — spend 1 Fate to "explode" 6s
 * (aka suns): reroll every 6 in the original pool, cascade on new 6s, and
 * add any fresh successes to the tally.
 *
 * Rules under test:
 *   - Post-roll, if at least one die rolled a 6 AND the actor has fate.current
 *     >= 1, a "Fate: Luck" button appears on the chat card.
 *   - Clicking it spends 1 Fate (current -1, spent +1).
 *   - Every 6 in the ORIGINAL pool triggers a reroll; each new 6 in the
 *     reroll batch triggers another reroll (cascade). Only the first-pass
 *     sun count is drawn from `rollData.diceResults` — subsequent passes
 *     draw from the previous reroll batch (post-roll.mjs line 141-146).
 *   - Successes from all reroll batches are added to the tally.
 *   - The button is hidden after use (`luckUsed: true` flag; template
 *     `{{#unless luckUsed}}` guard).
 *
 * Implementation map (module/dice/post-roll.mjs `_handleFateLuck`):
 *   1. Count suns in original roll → `sunsToExplode` (line 135)
 *   2. while (sunsToExplode > 0) — roll `sunsToExplode` new dice, push into
 *      `luckDice`, add to `totalNewSuccesses`, update `sunsToExplode` from
 *      the fresh batch (lines 141-146)
 *   3. Spend fate: current -1, spent +1 (lines 149-152)
 *   4. Append luck dice (tagged `isLuck: true`) to diceResults, add
 *      `totalNewSuccesses` to `successes` (lines 155-156)
 *   5. Set `flags.tb2e.luckUsed = true` (line 161)
 *   6. Recalculate finalSuccesses + pass via `recalculateSuccesses` and
 *      re-render the card (lines 164-174)
 *
 * Template gating (templates/chat/roll-result.hbs lines 110-117 + roll-
 * utils.mjs `buildChatTemplateData`):
 *   - `hasFate` = actor is character AND fate.current > 0 (roll-utils.mjs
 *     line 131)
 *   - `hasSuns` = at least one die with `isSun: true` (roll-utils.mjs line 126)
 *   - `luckUsed` = message flag from a prior Fate: Luck spend
 *
 * Dice determinism (Foundry d6 face = Math.ceil((1 - u) * 6); source:
 * foundry/client/dice/terms/dice.mjs line 360):
 *   - u = 0.001 → face 6 (sun, success, triggers reroll)
 *   - u = 0.3   → face 5 (success, NOT a sun → no cascade)
 *   - u = 0.5   → face 3 (fail, no sun, no cascade)
 *
 * Cascade nuance — cross-verified against post-roll.mjs line 145:
 *   `sunsToExplode = diceResults.filter(d => d.isSun).length` is applied
 *   to the MOST RECENT reroll batch (not the accumulated pool). So if the
 *   reroll stub produces non-6 faces, the loop exits after one pass.
 */
test.describe('§3 Rolls — Fate: Luck (reroll 6s)', () => {
  test.afterEach(async ({ page }) => {
    // Restore the PRNG stub so the next spec on a shared Page gets real
    // randomness. Same pattern as ability-test-basic / wise-aid-persona.
    await page.evaluate(() => {
      if (globalThis.__tb2eE2EPrevRandomUniform) {
        CONFIG.Dice.randomUniform = globalThis.__tb2eE2EPrevRandomUniform;
        delete globalThis.__tb2eE2EPrevRandomUniform;
      }
    });
  });

  test('spends 1 Fate, rerolls 6s, and adds new successes (DH p.47)', async ({ page }) => {
    const actorName = `E2E Fate Luck ${Date.now()}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Will 2 keeps the pool small and predictable: 2D, both 6s → 2 suns,
    // 2 successes. Fate = 2 so the -1 decrement assertion is unambiguous
    // (current: 2 → 1, spent: 0 → 1). Fresh disabled so the pool is
    // exactly the rating (same rationale as ability-test-basic).
    const actorId = await page.evaluate(async (n) => {
      const actor = await Actor.create({
        name: n,
        type: 'character',
        system: {
          abilities: {
            will:   { rating: 2, pass: 0, fail: 0 },
            health: { rating: 3, pass: 0, fail: 0 },
            nature: { rating: 3, max: 3, pass: 0, fail: 0 }
          },
          persona: { current: 0, spent: 0 },
          fate:    { current: 2, spent: 0 },
          conditions: { fresh: false }
        }
      });
      return actor.id;
    }, actorName);
    expect(actorId).toBeTruthy();

    // Initial stub: all 6s → 2D pool = 2 suns = 2 successes. Suns present
    // means `hasSuns` is true on the chat card, so the Fate: Luck button
    // will render (gated on hasFate ∧ hasSuns).
    await page.evaluate(() => {
      globalThis.__tb2eE2EPrevRandomUniform = CONFIG.Dice.randomUniform;
      CONFIG.Dice.randomUniform = () => 0.001;
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
    expect(await dialog.getPoolSize()).toBe(2);

    // Ob 3 so the initial roll (2 successes) is a FAIL; after the Luck
    // reroll lands 2 more successes, the outcome flips to PASS (4 >= 3).
    // This gives the spec an end-to-end proof that `recalculateSuccesses`
    // runs on the post-roll path and updates the pass banner.
    await dialog.fillObstacle(3);
    await dialog.submit();

    await expect
      .poll(() => page.evaluate(() => game.messages.contents.length), { timeout: 10_000 })
      .toBeGreaterThan(initialChatCount);

    const card = new RollChatCard(page);
    await card.expectPresent();

    // Initial roll shape — 2D, 2 suns → 2 successes, FAIL vs Ob 3.
    expect(await card.getPool()).toBe(2);
    await expect(card.diceResults).toHaveCount(2);
    expect(await card.getSuccesses()).toBe(2);
    expect(await card.getObstacle()).toBe(3);
    expect(await card.isPass()).toBe(false);

    // Fate: Luck button should be present — hasFate (current=2) AND hasSuns
    // (both dice are 6s) both hold.
    await expect(card.fateLuckButton).toBeVisible();

    // Swap the PRNG stub to u=0.3 → face 5 on every d6. Face 5 is a success
    // (>= 4) but NOT a sun (< 6), so the cascade loop in _handleFateLuck
    // exits after one pass: 2 suns → roll 2 dice → both show 5 → 2 new
    // successes, no cascade.
    //
    // Why not stay at u=0.001 (infinite cascade)? `evaluateRoll` in
    // tb2e-roll.mjs clamps poolSize to `Math.max(poolSize, 1)` (line 1215)
    // and each cascade pass always has at least 1 die, so a permanent
    // all-6s stub would never terminate. u=0.3 terminates the loop at 1
    // pass and gives us a clean "+sunCount successes" delta.
    await page.evaluate(() => {
      CONFIG.Dice.randomUniform = () => 0.3;
    });

    // Click Fate: Luck.
    await card.clickFateLuck();

    // Fate decremented: current 2 → 1, spent 0 → 1 (post-roll.mjs line 149-152).
    const fateAfter = await page.evaluate((id) => {
      const a = game.actors.get(id);
      return { current: a.system.fate.current, spent: a.system.fate.spent };
    }, actorId);
    expect(fateAfter).toEqual({ current: 1, spent: 1 });

    // Card updated — 2 original suns + 2 reroll successes = 4 successes,
    // 4 total dice rendered (2 original + 2 luck dice). The luck dice are
    // tagged `isLuck: true` (post-roll.mjs line 155) and render with the
    // `.die-luck` class.
    await expect
      .poll(() => card.getSuccesses(), { timeout: 5_000 })
      .toBe(4);
    await expect(card.diceResults).toHaveCount(4);

    // Outcome flipped FAIL → PASS (2 successes < Ob 3; 4 successes ≥ Ob 3).
    // `_handleFateLuck` runs `recalculateSuccesses` (post-roll.mjs line
    // 164-169) to update `pass` in flags and in the re-rendered template.
    expect(await card.isPass()).toBe(true);

    // Message flag assertions — confirm `luckUsed: true` marker that hides
    // the button on re-renders (template line 110 `{{#unless luckUsed}}`),
    // and that the dice flags record the reroll tagging. Scope by actorId
    // so a repeated run doesn't see stale cards from earlier iterations.
    const msgFlags = await page.evaluate((id) => {
      const m = game.messages.contents
        .filter(msg => msg.flags?.tb2e?.roll && msg.flags.tb2e.actorId === id)
        .slice(-1)[0];
      if (!m) return null;
      const d = m.flags.tb2e.roll.diceResults;
      return {
        luckUsed: !!m.flags.tb2e.luckUsed,
        successes: m.flags.tb2e.roll.successes,
        finalSuccesses: m.flags.tb2e.roll.finalSuccesses,
        pass: m.flags.tb2e.roll.pass,
        diceLen: d.length,
        originalSuns: d.slice(0, 2).filter(x => x.isSun).length,
        luckDiceSuccesses: d.slice(2).filter(x => x.isLuck && x.success).length,
        luckDiceIsLuck: d.slice(2).every(x => x.isLuck === true)
      };
    }, actorId);
    expect(msgFlags).toEqual({
      luckUsed: true,
      successes: 4,
      finalSuccesses: 4,
      pass: true,
      diceLen: 4,
      originalSuns: 2,
      luckDiceSuccesses: 2,
      luckDiceIsLuck: true
    });

    await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
  });

  test('Fate: Luck button is absent when fate.current = 0 (button gated on hasFate)', async ({ page }) => {
    const actorName = `E2E Fate Luck NoFate ${Date.now()}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Same character shape as test 1 BUT fate = 0 — so even with suns in
    // the pool, `hasFate` is false (roll-utils.mjs line 131) and the
    // template skips the Fate: Luck button (roll-result.hbs line 111
    // `{{#if hasFate}}`).
    const actorId = await page.evaluate(async (n) => {
      const actor = await Actor.create({
        name: n,
        type: 'character',
        system: {
          abilities: {
            will:   { rating: 2, pass: 0, fail: 0 },
            health: { rating: 3, pass: 0, fail: 0 },
            nature: { rating: 3, max: 3, pass: 0, fail: 0 }
          },
          persona: { current: 0, spent: 0 },
          fate:    { current: 0, spent: 0 },
          conditions: { fresh: false }
        }
      });
      return actor.id;
    }, actorName);
    expect(actorId).toBeTruthy();

    // All 6s in the initial pool — confirms the button's absence is driven
    // by `hasFate` alone, not by a missing `hasSuns`.
    await page.evaluate(() => {
      globalThis.__tb2eE2EPrevRandomUniform = CONFIG.Dice.randomUniform;
      CONFIG.Dice.randomUniform = () => 0.001;
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
    await dialog.fillObstacle(3);
    await dialog.submit();

    await expect
      .poll(() => page.evaluate(() => game.messages.contents.length), { timeout: 10_000 })
      .toBeGreaterThan(initialChatCount);

    const card = new RollChatCard(page);
    await card.expectPresent();

    // 2 suns present → hasSuns is true — but hasFate is false, so the
    // button is not rendered.
    await expect(card.diceResults).toHaveCount(2);
    expect(await card.getSuccesses()).toBe(2);
    await expect(card.fateLuckButton).toHaveCount(0);

    await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
  });
});
