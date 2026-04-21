import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { CharacterSheet } from '../pages/CharacterSheet.mjs';
import { RollDialog } from '../pages/RollDialog.mjs';
import { RollChatCard } from '../pages/RollChatCard.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §3 Rolls — basic ability test (DH pp.56–62).
 *
 * Rules under test:
 *   - Pool = ability rating + modifiers (no modifiers here).
 *   - Each die showing 4–6 counts as a success.
 *   - Pass = successes >= Ob, otherwise Fail.
 *
 * Implementation map:
 *   - `rollTest` at module/dice/tb2e-roll.mjs resolves the pool, opens
 *     `_showRollDialog` (DialogV2), evaluates `<n>d6cs>=4` via
 *     `evaluateRoll`, and (in the independent path) posts a chat message
 *     rendered from templates/chat/roll-result.hbs.
 *   - The sheet row carrying `data-action="rollTest" data-type="ability"
 *     data-key="<key>"` dispatches to CharacterSheet.#onRollTest.
 *
 * Dice determinism:
 *   - Foundry dice read `CONFIG.Dice.randomUniform()`. Each d6 face is
 *     `Math.ceil((1 - u) * 6)` — stubbing to `0.5` yields 3 on every die
 *     (not a success), so a 4D pool against Ob 3 is a deterministic FAIL
 *     with 0 successes. Stubbing to `0.0` yields 6 on every die — all
 *     successes — for the PASS branch.
 *
 * Pass/fail pip advancement:
 *   - Pips are only applied when the post-roll Finalize action runs
 *     (_handleFinalize in module/dice/post-roll.mjs calls
 *     `logAdvancementForSide` → `_logAdvancement`, which also opens a
 *     secondary dialog when a threshold is crossed). The initial card
 *     doesn't tick pips, so this spec asserts that pass/fail pip counts
 *     are UNCHANGED right after the roll posts — the pip advancement flow
 *     is its own follow-up spec.
 */
test.describe('§3 Rolls — basic ability test', () => {
  test.afterEach(async ({ page }) => {
    // Clean up the dice stub between tests — shared test files reuse the
    // same Page object, and CONFIG.Dice.randomUniform leakage would break
    // any subsequent spec that relies on true random rolls.
    await page.evaluate(() => {
      if (globalThis.__tb2eE2EPrevRandomUniform) {
        CONFIG.Dice.randomUniform = globalThis.__tb2eE2EPrevRandomUniform;
        delete globalThis.__tb2eE2EPrevRandomUniform;
      }
    });
  });

  test('rolls Will vs Ob 3 with a stubbed FAIL (all 3s → 0 successes)', async ({ page }) => {
    const actorName = `E2E Ability Roll ${Date.now()}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Create a character with Will = 4 and zeroed pass/fail pips so the
    // no-change assertion is unambiguous.
    const actorId = await page.evaluate(async (n) => {
      const actor = await Actor.create({
        name: n,
        type: 'character',
        system: {
          abilities: {
            will:   { rating: 4, pass: 0, fail: 0 },
            // Keep health / nature nonzero so prepareDerivedData has sane
            // values, but not relevant to the will test.
            health: { rating: 3, pass: 0, fail: 0 },
            nature: { rating: 3, max: 3, pass: 0, fail: 0 }
          },
          // Data model defaults `conditions.fresh = true` (DH p.85), which
          // adds +1D via gatherConditionModifiers. Turn it off so the
          // "no modifiers" pool is exactly the ability rating.
          conditions: { fresh: false }
        }
      });
      return actor.id;
    }, actorName);
    expect(actorId).toBeTruthy();

    // Stub the PRNG BEFORE clicking the row — the roll evaluates after the
    // dialog submits, so the stub just needs to be in place prior to submit.
    // u=0.5 → Math.ceil((1-0.5)*6) = 3 on every d6 → 0 successes.
    await page.evaluate(() => {
      globalThis.__tb2eE2EPrevRandomUniform = CONFIG.Dice.randomUniform;
      CONFIG.Dice.randomUniform = () => 0.5;
    });

    // Open the sheet and switch to Abilities.
    await page.evaluate((id) => {
      game.actors.get(id).sheet.render(true);
    }, actorId);

    const sheet = new CharacterSheet(page, actorName);
    await sheet.expectOpen();
    await sheet.openAbilitiesTab();

    // Snapshot chat count — we assert the card posts by watching the
    // count increase rather than relying on a fixed timeout.
    const initialChatCount = await page.evaluate(() => game.messages.contents.length);

    // Click the Will row to open the roll dialog. `#onRollTest` ignores
    // clicks on input / button.bubble / .btn-advance — we click the row
    // itself, letting Playwright land on the row's dead space (not an
    // input/bubble child).
    await sheet.rollAbilityRow('will').click();

    const dialog = new RollDialog(page);
    await dialog.waitForOpen();

    // Dialog pre-fills pool from the actor's rating; sanity-check so a
    // regression in _resolveRollData fails here loudly.
    expect(await dialog.getPoolSize()).toBe(4);

    // Set obstacle = 3 and submit.
    await dialog.fillObstacle(3);
    await dialog.submit();

    // Wait for the chat message to post.
    await expect
      .poll(() => page.evaluate(() => game.messages.contents.length), { timeout: 10_000 })
      .toBeGreaterThan(initialChatCount);

    // The new card should be the latest TB2E roll-result message.
    const card = new RollChatCard(page);
    await card.expectPresent();

    // Deterministic shape — 4 dice, all 3s → 0 successes, FAIL vs Ob 3.
    expect(await card.getPool()).toBe(4);
    await expect(card.diceResults).toHaveCount(4);
    expect(await card.getSuccesses()).toBe(0);
    expect(await card.getObstacle()).toBe(3);
    expect(await card.isPass()).toBe(false);

    // Confirm the latest ChatMessage carries our tb2e roll flags.
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
      poolSize: 4,
      successes: 0,
      obstacle: 3,
      pass: false
    });

    // Pass/fail pips are applied on Finalize, not immediately on roll post.
    // Without clicking Finalize the actor's pip counters should be untouched.
    const pips = await page.evaluate((id) => {
      const w = game.actors.get(id).system.abilities.will;
      return { pass: w.pass, fail: w.fail };
    }, actorId);
    expect(pips).toEqual({ pass: 0, fail: 0 });

    await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
  });

  test('rolls Will vs Ob 3 with a stubbed PASS (all 6s → 4 successes)', async ({ page }) => {
    const actorName = `E2E Ability Roll Pass ${Date.now()}`;

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
          // Same rationale as the FAIL test — disable the default Fresh
          // condition so the pool is exactly the will rating.
          conditions: { fresh: false }
        }
      });
      return actor.id;
    }, actorName);

    // u → 0 makes each d6 roll 6 (a "sun"). 4D = 4 successes vs Ob 3 → PASS.
    // Pick 0.001 to stay strictly inside (0, 1] and avoid any degenerate
    // rounding in Math.ceil; `Math.ceil((1 - 0.001) * 6) = 6`.
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

    expect(await card.getPool()).toBe(4);
    await expect(card.diceResults).toHaveCount(4);
    expect(await card.getSuccesses()).toBe(4);
    expect(await card.getObstacle()).toBe(3);
    expect(await card.isPass()).toBe(true);

    await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
  });
});
