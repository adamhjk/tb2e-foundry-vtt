import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { CharacterSheet } from '../pages/CharacterSheet.mjs';
import { RollDialog } from '../pages/RollDialog.mjs';
import { RollChatCard } from '../pages/RollChatCard.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §3 Rolls — roll-dialog manual modifier (DH pp.56–62).
 *
 * Rules under test:
 *   - Pool = rating + modifiers (DH p.56). The dialog exposes a free-form
 *     "Add Manual Modifier" control so the GM/player can stack any table
 *     adjudication the codified modifiers (conditions, help, traits, gear,
 *     persona, wises, nature) don't cover.
 *   - A +1D manual modifier raises the pool by exactly one die and is
 *     evaluated alongside the base roll (not post-roll): it contributes to
 *     both the displayed pool in the dialog summary AND the `poolSize` flag
 *     on the posted chat card.
 *
 * Implementation map:
 *   - `_showRollDialog` in module/dice/tb2e-roll.mjs renders
 *     templates/dice/roll-dialog.hbs. The `.add-modifier-btn` click handler
 *     appends a `.manual-modifier-input` row with label / type / value inputs
 *     (see render() block near line 871). Confirming pushes a `createModifier`
 *     entry into the closure-local `manualModifiers` array, which is then
 *     included by `_collectAllModifiers()` and drives:
 *       - `renderModifierList()` (UI — the new row appears in
 *         `.roll-dialog-modifiers`).
 *       - `updateSummary()` (UI — "<N>D vs Ob <M>" reflects +1D).
 *       - the submit callback's `poolSize: baseDice + totalDiceBonus`, which
 *         `rollTest` then feeds to `evaluateRoll()` and stamps on the chat
 *         message flags.
 *   - Note: `baseDice` is kept as the raw `poolSize` input value — it is
 *     NOT incremented by manual modifiers. The card's `poolSize` is the one
 *     that reflects the +1D.
 *
 * Dice determinism:
 *   - Stub `CONFIG.Dice.randomUniform = () => 0.001` → Math.ceil((1-u)*6) = 6
 *     on every die. A 5D pool vs Ob 3 yields 5 successes → PASS. This mirrors
 *     the pattern in tests/e2e/roll/ability-test-basic.spec.mjs (PASS branch).
 */
test.describe('§3 Rolls — roll-dialog manual modifier', () => {
  test.afterEach(async ({ page }) => {
    // Clean up the dice stub between tests — the shared Page object persists
    // across specs; a leaked stub would break any downstream spec that relies
    // on real randomness.
    await page.evaluate(() => {
      if (globalThis.__tb2eE2EPrevRandomUniform) {
        CONFIG.Dice.randomUniform = globalThis.__tb2eE2EPrevRandomUniform;
        delete globalThis.__tb2eE2EPrevRandomUniform;
      }
    });
  });

  test('adds +1D manual modifier in the roll dialog and rolls with the enlarged pool', async ({ page }) => {
    const actorName = `E2E Roll Modifier ${Date.now()}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Will 4, fresh=false so the baseline pool is exactly the rating (DH p.56);
    // any other auto-modifier (conditions/gear/etc.) would muddy the "+1"
    // assertion. Matches the pattern used by ability-test-basic.
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

    // u → 0.001 → Math.ceil((1 - 0.001) * 6) = 6 on every d6 → every die is
    // a success. 5D vs Ob 3 is then a deterministic PASS with 5 successes.
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

    // Open the roll dialog via the Will row (the row click is what triggers
    // `rollTest` → `_showRollDialog`).
    await sheet.rollAbilityRow('will').click();

    const dialog = new RollDialog(page);
    await dialog.waitForOpen();

    // Baseline — pool reflects rating only; no conditions or other auto-mods
    // (fresh was disabled above).
    expect(await dialog.getPoolSize()).toBe(4);
    expect(await dialog.getSummaryPool()).toBe(4);
    // Baseline: no modifier rows yet.
    expect(await dialog.modifierRows.count()).toBe(0);

    // Add +1D manual modifier (default type="dice", value=1 in the POM).
    await dialog.addManualModifier({ label: 'Test Bonus', value: 1 });

    // UI assertions: summary pool bumped by 1; exactly one modifier row.
    expect(await dialog.getSummaryPool()).toBe(5);
    await expect(dialog.modifierRows).toHaveCount(1);
    // `baseDice` input does NOT change — only the derived summary pool does.
    // This matches tb2e-roll.mjs where submit reads
    // `baseDice = form.elements.poolSize.valueAsNumber` and the +1D comes
    // from `totalDiceBonus`.
    expect(await dialog.getPoolSize()).toBe(4);

    await dialog.fillObstacle(3);
    await dialog.submit();

    await expect
      .poll(() => page.evaluate(() => game.messages.contents.length), { timeout: 10_000 })
      .toBeGreaterThan(initialChatCount);

    const card = new RollChatCard(page);
    await card.expectPresent();

    // Deterministic shape — 5 dice (4 from rating + 1 manual), all 6s →
    // 5 successes, PASS vs Ob 3.
    expect(await card.getPool()).toBe(5);
    await expect(card.diceResults).toHaveCount(5);
    expect(await card.getSuccesses()).toBe(5);
    expect(await card.getObstacle()).toBe(3);
    expect(await card.isPass()).toBe(true);

    // Flag-level assertions: `baseDice` reflects the rating alone (4);
    // `poolSize` reflects the rolled pool (5). Regression-guards
    // `_buildRollFlags` and the submit callback in tb2e-roll.mjs.
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
      poolSize: 5,
      successes: 5,
      obstacle: 3,
      pass: true
    });

    await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
  });
});
