import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { CharacterSheet } from '../pages/CharacterSheet.mjs';
import { RollDialog } from '../pages/RollDialog.mjs';
import { RollChatCard } from '../pages/RollChatCard.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §3 Rolls — wise aid "Ah, Of Course!" spends Persona to reroll failed dice
 * on a test related to your wise, and advances the wise on milestone (DH p.77-78).
 *
 * Rules under test (DH p.77 "Of Course!"):
 *   - Pre-roll: pick a related wise on the roll dialog (enables the post-
 *     roll wise-aid buttons).
 *   - Post-roll: spend 1 Persona to **reroll all failed dice** on a test
 *     related to your wise.
 *
 * Important — checkbox description vs. RAW:
 *   TEST_PLAN.md line 161 originally said "verify wise added as +1s". That's
 *   not what the rule says and not what the code does: DH p.77 specifies
 *   "reroll all failed dice", and `_handleOfCourse` in module/dice/post-
 *   roll.mjs implements that verbatim — it rolls `wyrmCount` NEW d6 and
 *   appends them (line 280-281), then recomputes successes from the whole
 *   pool (line 284). So the success delta is `new successes among the reroll
 *   batch` (0 to wyrmCount), not flat +1. The checkbox description is
 *   updated to reflect RAW.
 *
 * Wise advancement milestone (DH p.78):
 *   Each use of a wise ticks one of four boxes — `pass`, `fail`, `fate`
 *   (Deeper Understanding), `persona` (Of Course!). When all four are
 *   ticked, `_checkWiseAdvancement` (post-roll.mjs line 719) posts the
 *   wise-advancement chat card offering the three perk options. This spec
 *   covers the `persona` tick and the milestone card.
 *
 * Implementation map:
 *   - Pre-roll wise selector:
 *       templates/dice/roll-dialog.hbs line 260 → `<select name="wise">`
 *       tb2e-roll.mjs line 1136 reads the value into `config.wiseIndex`
 *       tb2e-roll.mjs line 1420-1451 maps into `flags.tb2e.roll.wise`
 *   - Of Course button conditions (roll-utils.mjs line 130-132):
 *       `wiseSelected` (chose a wise), `hasPersona` (persona.current > 0),
 *       `hasWyrms` (at least one failed die)
 *   - Of Course handler (post-roll.mjs line 256-322):
 *       1. Re-validate persona and usage flags
 *       2. Count wyrms, roll `wyrmCount` new dice
 *       3. Append to `diceResults` tagged with `isOfCourse: true`
 *       4. Recalculate successes; deduct 1 Persona; mark wise.persona = true
 *       5. `_checkWiseAdvancement` posts advancement card if all 4 marks set
 *
 * Dice determinism (same pattern as ability-test-basic / help-accept):
 *   - u=0.5 → Math.ceil((1-u)*6) = 3 on every d6 (all wyrms, 0 successes)
 *   - u=0.001 → Math.ceil((1-u)*6) = 6 on every d6 (all suns, all successes)
 *   - Stubbing `CONFIG.Dice.randomUniform` is persistent across both the
 *     initial roll (via `evaluateRoll`) and the Of Course reroll — we swap
 *     the stub between them to produce a deterministic "0 → 4 successes"
 *     trajectory.
 */
test.describe('§3 Rolls — wise aid (Of Course!) spends Persona', () => {
  test.afterEach(async ({ page }) => {
    // Restore the PRNG stub so the next spec on a shared Page gets real
    // randomness. Same pattern as ability-test-basic / help-accept.
    await page.evaluate(() => {
      if (globalThis.__tb2eE2EPrevRandomUniform) {
        CONFIG.Dice.randomUniform = globalThis.__tb2eE2EPrevRandomUniform;
        delete globalThis.__tb2eE2EPrevRandomUniform;
      }
    });
  });

  test('spends 1 Persona, rerolls wyrms, and marks wise.persona (DH p.77)', async ({ page }) => {
    const suffix = Date.now();
    const actorName = `E2E Wise Aid ${suffix}`;
    const wiseName = `Kobold-wise ${suffix}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Character with Will 4 (deterministic pool), Persona 2 so we can
    // confirm the -1 decrement unambiguously, and exactly one named wise so
    // the wise-selector dropdown exposes it at index 0. Fresh disabled so
    // the baseline pool is exactly the ability rating (same rationale as
    // ability-test-basic).
    const actorId = await page.evaluate(async ({ n, w }) => {
      const actor = await Actor.create({
        name: n,
        type: 'character',
        system: {
          abilities: {
            will:   { rating: 4, pass: 0, fail: 0 },
            health: { rating: 3, pass: 0, fail: 0 },
            nature: { rating: 3, max: 3, pass: 0, fail: 0 }
          },
          persona: { current: 2, spent: 0 },
          fate:    { current: 0, spent: 0 },
          // One named wise at index 0 with ALL advancement boxes OFF so the
          // post-roll tick is the only thing that sets `persona = true`.
          wises: [
            { name: w, pass: false, fail: false, fate: false, persona: false }
          ],
          conditions: { fresh: false }
        }
      });
      return actor.id;
    }, { n: actorName, w: wiseName });
    expect(actorId).toBeTruthy();

    // Stub PRNG to all-3s for the initial roll — 4D = 0 successes = all
    // wyrms. `hasWyrms` flips true on the card so the Of Course button is
    // eligible to render.
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

    // The wise section must render for a character with a named wise (the
    // wise-selector is gated by `hasWises` in tb2e-roll.mjs line 391-392).
    await expect(dialog.wiseSection).toHaveCount(1);
    await dialog.selectWise(0);

    // Ob 1 so the raw roll at 0 successes is a clear FAIL (will demonstrate
    // the Of Course reroll can flip the outcome when reroll dice are all 6s).
    await dialog.fillObstacle(1);
    await dialog.submit();

    await expect
      .poll(() => page.evaluate(() => game.messages.contents.length), { timeout: 10_000 })
      .toBeGreaterThan(initialChatCount);

    const card = new RollChatCard(page);
    await card.expectPresent();

    // Initial roll shape — 4 wyrms, 0 successes, FAIL vs Ob 1.
    expect(await card.getPool()).toBe(4);
    await expect(card.diceResults).toHaveCount(4);
    expect(await card.getSuccesses()).toBe(0);
    expect(await card.isPass()).toBe(false);

    // The Of Course button must be visible — all three conditions hold:
    // `wiseSelected` (we picked the wise), `hasPersona` (current=2 > 0),
    // `hasWyrms` (4 failed dice).
    await expect(card.ofCourseButton).toBeVisible();

    // Swap PRNG stub to all-6s so the Of Course reroll is deterministic:
    // 4 new dice, all successes. DH p.77 says "reroll all failed dice" —
    // `_handleOfCourse` counts wyrms and rolls `wyrmCount` new dice, which
    // for us is the full 4 from the initial roll.
    await page.evaluate(() => {
      CONFIG.Dice.randomUniform = () => 0.001;
    });

    // Click Of Course. `_handleOfCourse` deducts 1 Persona, rolls wyrmCount
    // new dice, appends them to the dice results, recalculates successes,
    // marks wise.persona = true, and calls `_checkWiseAdvancement`.
    await card.clickOfCourse();

    // Persona decremented by exactly 1 (current: 2 → 1, spent: 0 → 1).
    const personaAfter = await page.evaluate((id) => {
      const a = game.actors.get(id);
      return { current: a.system.persona.current, spent: a.system.persona.spent };
    }, actorId);
    expect(personaAfter).toEqual({ current: 1, spent: 1 });

    // Card updated — 4 original wyrms + 4 reroll successes = 4 successes,
    // 8 total dice rendered. The reroll dice are tagged `isOfCourse: true`
    // (post-roll.mjs line 281) and render with the `.die-of-course` class.
    await expect
      .poll(() => card.getSuccesses(), { timeout: 5_000 })
      .toBe(4);
    await expect(card.diceResults).toHaveCount(8);

    // Outcome flipped FAIL → PASS (0 successes was below Ob 1; now 4 successes
    // is well above). `_handleOfCourse` runs `recalculateSuccesses`
    // (post-roll.mjs line 311-316) to update `pass`.
    expect(await card.isPass()).toBe(true);

    // wise.persona flag flipped on the actor — the advancement mark that
    // Of Course leaves behind (DH p.78 "mark how it was used: ... Of Course!").
    const wiseAfter = await page.evaluate((id) => {
      const w = game.actors.get(id).system.wises[0];
      return { name: w.name, pass: w.pass, fail: w.fail, fate: w.fate, persona: w.persona };
    }, actorId);
    expect(wiseAfter).toEqual({
      name: wiseName,
      pass: false,
      fail: false,
      fate: false,
      persona: true
    });

    // Flag-level assertions on the chat message — confirms the roll card
    // records the `ofCourseUsed: true` marker that hides the button on
    // subsequent re-renders.
    const msgFlags = await page.evaluate(() => {
      // Our roll-result is the 2nd-latest card iff the wise-advancement
      // card also posted. For this test (wise had no prior marks) the
      // milestone isn't hit — no advancement card posts — so the roll
      // result IS the latest tb2e.roll message.
      // Note: the selected wise is stored at top-level `flags.tb2e.wise`
      // (tb2e-roll.mjs line 1451 in `_buildRollFlags`), NOT nested under
      // `flags.tb2e.roll`. Don't pull from `.roll.wise` — that field does
      // not exist.
      const msgs = game.messages.contents.filter(m => m.flags?.tb2e?.roll).slice(-1);
      const m = msgs[0];
      if (!m) return null;
      return {
        ofCourseUsed: !!m.flags.tb2e.ofCourseUsed,
        wise: m.flags.tb2e.wise
      };
    });
    expect(msgFlags).toEqual({
      ofCourseUsed: true,
      wise: { name: wiseName, index: 0 }
    });

    // Only one mark set → no milestone → no wise-advancement card posted
    // for THIS actor. (Filter by actorId — a repeated run on the same
    // Foundry world could otherwise see advancement cards left by earlier
    // iterations of the milestone test.)
    const advancementCount = await page.evaluate((id) => {
      return game.messages.contents.filter(
        m => m.flags?.tb2e?.wiseAdvancement && m.flags.tb2e.actorId === id
      ).length;
    }, actorId);
    expect(advancementCount).toBe(0);

    await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
  });

  test('milestone: marking the 4th advancement box posts the wise-advancement card (DH p.78)', async ({ page }) => {
    const suffix = Date.now();
    const actorName = `E2E Wise Milestone ${suffix}`;
    const wiseName = `Kobold-wise ${suffix}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Pre-stage the wise with pass=true, fail=true, fate=true so the
    // Of Course mark (persona=true) is the 4th and final box —
    // `_checkWiseAdvancement` triggers iff `wise.pass && wise.fail && wise.fate
    // && wise.persona` (post-roll.mjs line 721). Seeding these directly is
    // equivalent to the player having already used "I Am Wise to aid passed
    // / failed a test" and "Deeper Understanding" — DH p.78.
    const actorId = await page.evaluate(async ({ n, w }) => {
      const actor = await Actor.create({
        name: n,
        type: 'character',
        system: {
          abilities: {
            will:   { rating: 4, pass: 0, fail: 0 },
            health: { rating: 3, pass: 0, fail: 0 },
            nature: { rating: 3, max: 3, pass: 0, fail: 0 }
          },
          persona: { current: 1, spent: 0 },
          fate:    { current: 0, spent: 0 },
          wises: [
            { name: w, pass: true, fail: true, fate: true, persona: false }
          ],
          conditions: { fresh: false }
        }
      });
      return actor.id;
    }, { n: actorName, w: wiseName });
    expect(actorId).toBeTruthy();

    // Stub PRNG → all 3s so we land on FAIL with 4 wyrms and the Of Course
    // button appears. We don't bother flipping to 6s before Of Course —
    // the outcome of the reroll is irrelevant to the milestone assertion.
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
    await dialog.fillObstacle(3);
    await dialog.submit();

    // Wait for the roll card to post.
    await expect
      .poll(() => page.evaluate(() => game.messages.contents.length), { timeout: 10_000 })
      .toBeGreaterThan(initialChatCount);

    const card = new RollChatCard(page);
    await card.expectPresent();
    await expect(card.ofCourseButton).toBeVisible();

    // Click Of Course → marks wise.persona = true → all 4 boxes are now
    // true → `_checkWiseAdvancement` posts the advancement chat card.
    await card.clickOfCourse();

    // Wise-advancement card is identified by `flags.tb2e.wiseAdvancement`
    // (post-roll.mjs line 752). Poll until the card posts — the advancement
    // card is created asynchronously after `_handleOfCourse` awaits the
    // actor update that flips the 4th mark. Filter by actorId so repeated
    // runs on a shared Foundry world don't see stale advancement cards
    // from earlier iterations.
    await expect
      .poll(() => page.evaluate((id) => {
        return game.messages.contents.filter(
          m => m.flags?.tb2e?.wiseAdvancement && m.flags.tb2e.actorId === id
        ).length;
      }, actorId), { timeout: 10_000 })
      .toBe(1);

    // The card carries the actor id, wise index, and wise name in its flags
    // (post-roll.mjs line 752) so downstream handlers can route the perk
    // choice back to the right wise.
    const advFlags = await page.evaluate((id) => {
      const m = game.messages.contents.find(
        msg => msg.flags?.tb2e?.wiseAdvancement && msg.flags.tb2e.actorId === id
      );
      return m ? {
        actorId: m.flags.tb2e.actorId,
        wiseIndex: m.flags.tb2e.wiseIndex,
        wiseName: m.flags.tb2e.wiseName,
        resolved: !!m.flags.tb2e.wiseAdvResolved
      } : null;
    }, actorId);
    expect(advFlags).toEqual({
      actorId,
      wiseIndex: 0,
      wiseName,
      resolved: false
    });

    // The advancement card's HTML should include the three perk buttons
    // (Change / BL / Skill Test) per DH p.78. The template emits them with
    // `data-action="wise-change" / "wise-bl" / "wise-skill-test"`.
    const perkActions = await page.evaluate(() => {
      const m = game.messages.contents.find(msg => msg.flags?.tb2e?.wiseAdvancement);
      if (!m) return [];
      const tmp = document.createElement('div');
      tmp.innerHTML = m.content;
      return Array.from(tmp.querySelectorAll('.wise-adv-btn[data-action]')).map(b => b.dataset.action);
    });
    expect(perkActions).toEqual(['wise-change', 'wise-bl', 'wise-skill-test']);

    // Sanity: the actor's wise now has all 4 boxes set (the card hasn't
    // been resolved, so no reset has happened yet — DH p.78 "Once you've
    // chosen your perk, reset your marks").
    const wiseAfter = await page.evaluate((id) => {
      const w = game.actors.get(id).system.wises[0];
      return { pass: w.pass, fail: w.fail, fate: w.fate, persona: w.persona };
    }, actorId);
    expect(wiseAfter).toEqual({ pass: true, fail: true, fate: true, persona: true });

    await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
  });
});
