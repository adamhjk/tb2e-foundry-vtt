import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { CharacterSheet } from '../pages/CharacterSheet.mjs';
import { RollDialog } from '../pages/RollDialog.mjs';
import { RollChatCard } from '../pages/RollChatCard.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §3 Rolls — basic skill test (DH pp.56–62, p.84).
 *
 * Rules under test:
 *   - Pool = skill rating + modifiers (no modifiers here).
 *   - Each die showing 4–6 counts as a success.
 *   - Pass = successes >= Ob, otherwise Fail.
 *   - Each completed test ticks one pip — a pass increments
 *     `system.skills.<key>.pass`, a fail increments `.fail` — up to the
 *     advancement thresholds for the current rating (DH p.84). For rating N
 *     the caps are N passes, N-1 fails (see `advancementNeeded` in
 *     module/config.mjs).
 *
 * Implementation map:
 *   - The sheet row carrying `data-action="rollTest" data-type="skill"
 *     data-key="<key>"` dispatches to `CharacterSheet.#onRollTest`.
 *   - `rollTest` resolves the pool, opens the DialogV2 roll dialog via
 *     `_showRollDialog`, evaluates `<n>d6cs>=4` via `evaluateRoll`, and
 *     posts the chat card rendered from templates/chat/roll-result.hbs.
 *   - Pass/fail pips are applied by `_handleFinalize` in
 *     module/dice/post-roll.mjs (→ `logAdvancementForSide` →
 *     `_logAdvancement`) — not immediately on roll post. The Finalize
 *     button is rendered inside `.card-actions` with `data-action="finalize"`
 *     and re-renders the card without the button after running.
 *
 * Dice determinism:
 *   - Foundry dice read `CONFIG.Dice.randomUniform()`. Each d6 face is
 *     `Math.ceil((1 - u) * 6)` — stub to 0.001 for all-6s (PASS), or 0.5
 *     for all-3s (FAIL with 0 successes). This is the same technique as
 *     tests/e2e/roll/ability-test-basic.spec.mjs.
 *
 * Advancement-dialog suppression:
 *   - `showAdvancementDialog` only opens when BOTH pass and fail rows are
 *     filled (`data.pass >= needed.pass && data.fail >= needed.fail`).
 *   - For Fighter rating 3, `advancementNeeded` returns `{ pass: 3, fail: 2 }`.
 *     Starting from (0, 0), a single pass (→1,0) or a single fail (→0,1)
 *     does not meet either threshold, so the dialog stays closed and the
 *     test does not need to dismiss it.
 */
test.describe('§3 Rolls — basic skill test', () => {
  test.afterEach(async ({ page }) => {
    // Clean up the dice stub between tests — the shared Page object persists
    // across specs; leaked stubs would break any downstream spec relying on
    // real randomness.
    await page.evaluate(() => {
      if (globalThis.__tb2eE2EPrevRandomUniform) {
        CONFIG.Dice.randomUniform = globalThis.__tb2eE2EPrevRandomUniform;
        delete globalThis.__tb2eE2EPrevRandomUniform;
      }
    });
  });

  test('rolls Fighter vs Ob 3 on a stubbed PASS (all 6s → 4 successes) — pass pip ticks', async ({ page }) => {
    const actorName = `E2E Skill Roll Pass ${Date.now()}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Create a character with Fighter rating 3 and zeroed pass/fail pips so
    // the one-pip tick is unambiguous.
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
            fighter: { rating: 3, pass: 0, fail: 0, learning: 0 }
          },
          // Data-model default `conditions.fresh = true` adds +1D via
          // `gatherConditionModifiers` (DH p.85). Disable so the pool is
          // exactly the Fighter rating.
          conditions: { fresh: false }
        }
      });
      return actor.id;
    }, actorName);
    expect(actorId).toBeTruthy();

    // Stub the PRNG BEFORE clicking the row — u=0.001 → Math.ceil((1-0.001)*6) = 6,
    // so every d6 face is 6 (a "sun") → 4D vs Ob 3 is a deterministic PASS
    // with 4 successes.
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

    // Click the Fighter row's name span. `#onRollTest` filters clicks that
    // land on `input`, `button.bubble`, or `.btn-advance`; Playwright's
    // default click lands on the bounding-box center, which at rating 3
    // coincides with the rating `<input>` cell (see skill-row CSS grid
    // `1fr 1.5rem 1.5rem 3rem 9rem`). Targeting `.skill-name` guarantees
    // we land on a non-input span so the row's `rollTest` action fires.
    await sheet.rollSkillRow('fighter').locator('.skill-name').click();

    const dialog = new RollDialog(page);
    await dialog.waitForOpen();

    // Dialog pre-fills pool from the actor's rating; sanity-check so a
    // regression in `_resolveRollData` fails here loudly.
    expect(await dialog.getPoolSize()).toBe(3);

    await dialog.fillObstacle(3);
    await dialog.submit();

    await expect
      .poll(() => page.evaluate(() => game.messages.contents.length), { timeout: 10_000 })
      .toBeGreaterThan(initialChatCount);

    const card = new RollChatCard(page);
    await card.expectPresent();

    // Deterministic shape — 3 dice, all 6s → 3 successes, PASS vs Ob 3.
    expect(await card.getPool()).toBe(3);
    await expect(card.diceResults).toHaveCount(3);
    expect(await card.getSuccesses()).toBe(3);
    expect(await card.getObstacle()).toBe(3);
    expect(await card.isPass()).toBe(true);

    // Confirm the latest ChatMessage carries our tb2e roll flags for skill.
    const flags = await page.evaluate(() => {
      const msg = game.messages.contents.at(-1);
      const f = msg?.flags?.tb2e?.roll;
      return f ? {
        type: f.type, key: f.key, baseDice: f.baseDice,
        poolSize: f.poolSize, successes: f.successes,
        obstacle: f.obstacle, pass: f.pass
      } : null;
    });
    expect(flags).toEqual({
      type: 'skill',
      key: 'fighter',
      baseDice: 3,
      poolSize: 3,
      successes: 3,
      obstacle: 3,
      pass: true
    });

    // Pips before Finalize — still zero per the Finalize-driven advancement
    // pipeline in module/dice/post-roll.mjs.
    const pipsBefore = await page.evaluate((id) => {
      const f = game.actors.get(id).system.skills.fighter;
      return { pass: f.pass, fail: f.fail };
    }, actorId);
    expect(pipsBefore).toEqual({ pass: 0, fail: 0 });

    // Click Finalize — this ticks the pass pip via `_logAdvancement`
    // (DH p.84). Rating 3 needs 3 passes / 2 fails to advance, so a single
    // pass (→1,0) does NOT open the advancement dialog (guarded by
    // `needed.pass <= 0 || data.pass < needed.pass || data.fail < needed.fail`
    // in module/dice/advancement.mjs).
    await card.clickFinalize();

    // Authoritative check: data-model pip counters.
    await expect
      .poll(() => page.evaluate((id) => {
        const f = game.actors.get(id).system.skills.fighter;
        return { pass: f.pass, fail: f.fail };
      }, actorId), { timeout: 5_000 })
      .toEqual({ pass: 1, fail: 0 });

    await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
  });

  test('rolls Fighter vs Ob 3 on a stubbed FAIL (all 3s → 0 successes) — fail pip ticks', async ({ page }) => {
    const actorName = `E2E Skill Roll Fail ${Date.now()}`;

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
            will:   { rating: 4, pass: 0, fail: 0 },
            health: { rating: 3, pass: 0, fail: 0 },
            nature: { rating: 3, max: 3, pass: 0, fail: 0 }
          },
          skills: {
            fighter: { rating: 3, pass: 0, fail: 0, learning: 0 }
          },
          conditions: { fresh: false }
        }
      });
      return actor.id;
    }, actorName);

    // u=0.5 → Math.ceil((1-0.5)*6) = 3 on every d6 → 0 successes → FAIL.
    await page.evaluate(() => {
      globalThis.__tb2eE2EPrevRandomUniform = CONFIG.Dice.randomUniform;
      CONFIG.Dice.randomUniform = () => 0.5;
    });

    await page.evaluate((id) => {
      game.actors.get(id).sheet.render(true);
    }, actorId);

    const sheet = new CharacterSheet(page, actorName);
    await sheet.expectOpen();
    await sheet.openSkillsTab();

    const initialChatCount = await page.evaluate(() => game.messages.contents.length);

    // See PASS test above — click the `.skill-name` span to avoid landing
    // on the rating input (which short-circuits `#onRollTest`).
    await sheet.rollSkillRow('fighter').locator('.skill-name').click();

    const dialog = new RollDialog(page);
    await dialog.waitForOpen();
    expect(await dialog.getPoolSize()).toBe(3);
    await dialog.fillObstacle(3);
    await dialog.submit();

    await expect
      .poll(() => page.evaluate(() => game.messages.contents.length), { timeout: 10_000 })
      .toBeGreaterThan(initialChatCount);

    const card = new RollChatCard(page);
    await card.expectPresent();

    expect(await card.getPool()).toBe(3);
    await expect(card.diceResults).toHaveCount(3);
    expect(await card.getSuccesses()).toBe(0);
    expect(await card.getObstacle()).toBe(3);
    expect(await card.isPass()).toBe(false);

    // Finalize the fail. Rating 3 needs 2 fails to advance, so 1 fail
    // (→0,1) stays below the threshold and the advancement dialog does
    // not open.
    await card.clickFinalize();

    await expect
      .poll(() => page.evaluate((id) => {
        const f = game.actors.get(id).system.skills.fighter;
        return { pass: f.pass, fail: f.fail };
      }, actorId), { timeout: 5_000 })
      .toEqual({ pass: 0, fail: 1 });

    await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
  });
});
