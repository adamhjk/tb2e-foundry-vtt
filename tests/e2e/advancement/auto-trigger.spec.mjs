import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { CharacterSheet } from '../pages/CharacterSheet.mjs';
import { RollDialog } from '../pages/RollDialog.mjs';
import { RollChatCard } from '../pages/RollChatCard.mjs';
import { AdvancementDialog } from '../pages/AdvancementDialog.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §4 Advancement — auto-trigger on the roll that fills the final pip
 * (DH p.84).
 *
 * Rules under test:
 *   - Rating N advances at N passes AND N-1 fails (both thresholds must
 *     be met). See `advancementNeeded` in module/config.mjs lines 89-94:
 *       { pass: rating, fail: Math.max(rating - 1, 0) }.
 *     For Fighter rating 2: 2 passes + 1 fail.
 *   - Pass/fail pips tick on the Finalize step of a roll's chat card
 *     (not immediately when the roll is posted) — see
 *     module/dice/post-roll.mjs `_handleFinalize` lines 560-566 →
 *     `logAdvancementForSide` (roll-utils.mjs line 194) →
 *     `_logAdvancement` (tb2e-roll.mjs line 192).
 *   - Immediately after the pip tick, `_logAdvancement` calls
 *     `showAdvancementDialog` (tb2e-roll.mjs line 203), which opens a
 *     DialogV2 prompt IFF both thresholds are met:
 *       advancement.mjs line 21:
 *         `if ( data.pass < needed.pass || data.fail < needed.fail ) return;`
 *   - The dialog is a plain `foundry.applications.api.DialogV2` with
 *     classes `["tb2e", "advancement-dialog"]` and the hbs content from
 *     templates/dice/advancement-dialog.hbs (advancement.mjs lines 26-52).
 *
 * This spec narrowly verifies that the dialog OPENS when the triggering
 * roll fills the final pip. The follow-up specs
 * (advancement/accept.spec.mjs, advancement/cancel.spec.mjs) exercise its
 * behavior — so here we dismiss via Cancel once we've asserted the key
 * surface (label, current → new rating).
 *
 * Staging:
 *   - Fighter rating 2, pass:1, fail:1 — one pass-pip below the threshold
 *     of (2P, 1F). A stubbed PASS roll ticks the pass pip to 2, which
 *     satisfies both thresholds and must auto-open the prompt.
 *   - Negative control: Fighter rating 2, pass:0, fail:0 — a stubbed PASS
 *     ticks pass to 1 (still 1 short of 2P; also 1 short of 1F), so the
 *     prompt must NOT open.
 *
 * Dice determinism:
 *   - `CONFIG.Dice.randomUniform = () => 0.001` makes every d6 roll a 6
 *     (`Math.ceil((1 - 0.001) * 6) = 6`), so a 2D pool vs Ob 1 is a
 *     deterministic PASS with 2 successes. Same technique as the §3
 *     ability-/skill-test specs.
 */
test.describe('§4 Advancement — auto-trigger', () => {
  test.afterEach(async ({ page }) => {
    // Clean up the dice stub between tests — the shared Page object
    // persists across specs; leaked stubs would break any downstream spec
    // relying on real randomness.
    await page.evaluate(() => {
      if (globalThis.__tb2eE2EPrevRandomUniform) {
        CONFIG.Dice.randomUniform = globalThis.__tb2eE2EPrevRandomUniform;
        delete globalThis.__tb2eE2EPrevRandomUniform;
      }
    });
  });

  test('opens the advancement dialog when the triggering roll fills the final pip', async ({ page }) => {
    const actorName = `E2E Advance Trigger ${Date.now()}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Fighter rating 2 needs (2P, 1F) to advance. Stage at (1P, 1F) — one
    // pass short — so the next PASS fills the final pip and both
    // thresholds are met simultaneously.
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
          skills: {
            // 1P + 1F: 1 pass pip below the (2P, 1F) threshold for
            // rating 2 (DH p.84 / module/config.mjs `advancementNeeded`).
            fighter: { rating: 2, pass: 1, fail: 1, learning: 0 }
          },
          // Data-model default `conditions.fresh = true` adds +1D via
          // gatherConditionModifiers (DH p.85) — disable so the pool is
          // exactly the Fighter rating.
          conditions: { fresh: false }
        }
      });
      return actor.id;
    }, actorName);
    expect(actorId).toBeTruthy();

    // u=0.001 → every d6 is 6 → 2D vs Ob 1 is a deterministic PASS with
    // 2 successes.
    await page.evaluate(() => {
      globalThis.__tb2eE2EPrevRandomUniform = CONFIG.Dice.randomUniform;
      CONFIG.Dice.randomUniform = () => 0.001;
    });

    await page.evaluate((id) => {
      game.actors.get(id).sheet.render(true);
    }, actorId);

    const sheet = new CharacterSheet(page, actorName);
    await sheet.expectOpen();
    await sheet.openSkillsTab();

    const initialChatCount = await page.evaluate(() => game.messages.contents.length);

    // Click the Fighter row's name span. Same pattern as
    // tests/e2e/roll/skill-test-basic.spec.mjs — `#onRollTest` ignores
    // clicks on input / button.bubble / .btn-advance, and the row's grid
    // puts the rating input under the bounding-box center.
    await sheet.rollSkillRow('fighter').locator('.skill-name').click();

    const dialog = new RollDialog(page);
    await dialog.waitForOpen();
    expect(await dialog.getPoolSize()).toBe(2);
    await dialog.fillObstacle(1);
    await dialog.submit();

    await expect
      .poll(() => page.evaluate(() => game.messages.contents.length), { timeout: 10_000 })
      .toBeGreaterThan(initialChatCount);

    // Actor-scope the card lookup. Under --repeat-each we may share a
    // Foundry world across iterations; filtering on `flags.tb2e.actorId`
    // keeps us pinned to THIS test's roll card.
    const cardMessageId = await page.evaluate((id) => {
      const m = game.messages.contents.slice().reverse()
        .find(msg => msg?.flags?.tb2e?.actorId === id && msg?.flags?.tb2e?.roll);
      return m ? m.id : null;
    }, actorId);
    expect(cardMessageId).toBeTruthy();

    const card = new RollChatCard(page);
    await card.expectPresent();
    expect(await card.isPass()).toBe(true);
    expect(await card.getSuccesses()).toBe(2);

    // Pre-Finalize: pips are still at the seeded (1, 1) — the pip tick
    // happens inside `_handleFinalize`, not at roll-post time.
    const pipsBefore = await page.evaluate((id) => {
      const f = game.actors.get(id).system.skills.fighter;
      return { pass: f.pass, fail: f.fail, rating: f.rating };
    }, actorId);
    expect(pipsBefore).toEqual({ pass: 1, fail: 1, rating: 2 });

    // Clicking Finalize runs `_handleFinalize` → `logAdvancementForSide`
    // → `_logAdvancement`. `_logAdvancement` increments the pass pip
    // from 1 → 2 (the capped max for rating 2, see tb2e-roll.mjs line
    // 197-202), then calls `showAdvancementDialog` — which opens the
    // DialogV2 because pass (2) >= needed.pass (2) AND fail (1) >=
    // needed.fail (1).
    //
    // NOTE: we DON'T use `card.clickFinalize()` here because that helper
    // waits for the finalize button to detach from the re-rendered card
    // — but `_handleFinalize` `await`s `showAdvancementDialog`, which in
    // turn `await`s `DialogV2.wait(...)` (advancement.mjs line 33). The
    // chat-card re-render that strips the Finalize button does not
    // happen until the dialog resolves (_handleFinalize line 588 in
    // post-roll.mjs runs AFTER the advancement pipeline). Dispatching
    // a native click and then waiting for the advancement dialog to
    // open is the correct gate.
    await expect(card.finalizeButton).toBeVisible();
    await card.finalizeButton.evaluate(btn => btn.click());

    const advDialog = new AdvancementDialog(page);
    await advDialog.waitForOpen();

    // Localized label — en.json defines "TB2E.Skill.Fighter": "Fighter".
    // The rendered text is uppercased by CSS `text-transform`, so the DOM
    // `innerText` returns "FIGHTER". Assert case-insensitively against the
    // source label.
    expect((await advDialog.getLabel()).toLowerCase()).toBe('fighter');
    expect(await advDialog.getCurrentRating()).toBe(2);
    expect(await advDialog.getNewRating()).toBe(3);

    // Window title is formatted via "TB2E.Advance.DialogTitle":
    //   "{name} Advancement" → "Fighter Advancement".
    await expect(advDialog.title).toHaveText(/Fighter Advancement/);

    // Pip tick actually landed — pass is now capped at 2 (the rating-2
    // max per `advancementNeeded`), fail is still 1 (untouched by a
    // PASS). Rating is unchanged until the dialog is accepted (which is
    // a separate spec).
    const pipsAfterTick = await page.evaluate((id) => {
      const f = game.actors.get(id).system.skills.fighter;
      return { pass: f.pass, fail: f.fail, rating: f.rating };
    }, actorId);
    expect(pipsAfterTick).toEqual({ pass: 2, fail: 1, rating: 2 });

    // Dismiss via Cancel so we leave clean state. Cancel resolves `null`
    // which short-circuits the update (advancement.mjs line 54); rating
    // stays at 2 and pips stay at (2, 1). Verification of that behavior
    // is scoped to tests/e2e/advancement/cancel.spec.mjs.
    await advDialog.clickCancel();

    await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
  });

  test('does NOT open the dialog when the roll leaves thresholds unmet', async ({ page }) => {
    const actorName = `E2E Advance NoTrigger ${Date.now()}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Fighter rating 2, zeroed pips. A PASS ticks pass 0 → 1 (still < 2),
    // and fails are untouched (still 0 < 1). Neither threshold is met,
    // so `showAdvancementDialog` exits on its guard (advancement.mjs
    // line 21) and the dialog must not appear.
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
          skills: {
            fighter: { rating: 2, pass: 0, fail: 0, learning: 0 }
          },
          conditions: { fresh: false }
        }
      });
      return actor.id;
    }, actorName);

    await page.evaluate(() => {
      globalThis.__tb2eE2EPrevRandomUniform = CONFIG.Dice.randomUniform;
      CONFIG.Dice.randomUniform = () => 0.001;
    });

    await page.evaluate((id) => {
      game.actors.get(id).sheet.render(true);
    }, actorId);

    const sheet = new CharacterSheet(page, actorName);
    await sheet.expectOpen();
    await sheet.openSkillsTab();

    const initialChatCount = await page.evaluate(() => game.messages.contents.length);

    await sheet.rollSkillRow('fighter').locator('.skill-name').click();

    const dialog = new RollDialog(page);
    await dialog.waitForOpen();
    expect(await dialog.getPoolSize()).toBe(2);
    await dialog.fillObstacle(1);
    await dialog.submit();

    await expect
      .poll(() => page.evaluate(() => game.messages.contents.length), { timeout: 10_000 })
      .toBeGreaterThan(initialChatCount);

    const card = new RollChatCard(page);
    await card.expectPresent();
    expect(await card.isPass()).toBe(true);

    await card.clickFinalize();

    // Wait for the pip tick to land before asserting the dialog's
    // absence — polling on the actor's pass pip is the authoritative
    // completion signal for `_handleFinalize`. Without this gate, a
    // premature `.toHaveCount(0)` would pass trivially before the
    // trigger had a chance to run at all.
    await expect
      .poll(() => page.evaluate((id) => {
        const f = game.actors.get(id).system.skills.fighter;
        return { pass: f.pass, fail: f.fail, rating: f.rating };
      }, actorId), { timeout: 5_000 })
      .toEqual({ pass: 1, fail: 0, rating: 2 });

    // The advancement dialog must NOT be present — the early-return in
    // advancement.mjs line 21 guards on unmet thresholds.
    const advDialog = new AdvancementDialog(page);
    await expect(advDialog.root).toHaveCount(0);

    await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
  });
});
