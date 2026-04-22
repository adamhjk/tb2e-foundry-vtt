import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { GrindTracker } from '../pages/GrindTracker.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §10 Grind Tracker — GM advances the turn counter (DH p.75).
 *
 * Implementation map (verified against
 * `module/applications/grind-tracker.mjs`):
 *   - Grind state lives in world-scoped settings registered in tb2e.mjs L17-19:
 *     `tb2e.grindTurn` (Number, default 1), `tb2e.grindPhase`
 *     (String, default "adventure"), `tb2e.grindExtreme` (Boolean, default
 *     false).
 *   - The HUD is a singleton `HandlebarsApplicationMixin(ApplicationV2)` with
 *     `id: "grind-tracker"`. Accessed via `game.tb2e.grindTracker` /
 *     `GrindTracker.getInstance()`. Also exposed via the tokens scene-controls
 *     toolbar (tb2e.mjs L283-298).
 *   - The Advance button is `button.advance-btn[data-action="advanceTurn"]`
 *     (template L38-41) and only renders when `isAdventurePhase` is true
 *     (template L22 — phase === "adventure", the default).
 *   - Handler at grind-tracker.mjs L305-360: reads `grindTurn`, iterates
 *     scene-token actors to decrement lit light sources, optionally posts a
 *     consolidated condition card when `cyclePos === maxTurns` (4 for normal,
 *     3 for extreme), then writes `grindTurn = next` and re-renders.
 *
 * Scope — this spec only asserts the turn-counter mechanics:
 *   - Setting increments by 1.
 *   - The HUD's `input.turn-number-input[value="{{turn}}"]` reflects the new
 *     value after the Handlebars re-render.
 *   - Advancing twice from the baseline yields turn 3 (deterministic — with
 *     no scene-token character actors and a default non-extreme, non-grind
 *     cycle position, no side effects fire).
 *
 * Out of scope (covered by sibling §10 specs):
 *   - Phase cycling (set-phase.spec.mjs)
 *   - Mailbox condition apply (apply-condition-mailbox.spec.mjs)
 *   - Consolidated grind card (consolidated-card.spec.mjs)
 *   - Torch extinguish (light-extinguish.spec.mjs)
 *
 * World-state hygiene: the grind counter is world-scoped and persists across
 * tests within a worker. `afterEach` resets it to the registered defaults so
 * repeat-each runs (and subsequent specs) see a clean baseline.
 */
test.describe('§10 Grind Tracker — advance turn', () => {
  test.afterEach(async ({ page }) => {
    // Close the HUD if it's still open, then reset world-scoped state.
    await page.evaluate(async () => {
      try { game.tb2e.grindTracker?.close?.(); } catch {}
      await game.settings.set('tb2e', 'grindTurn', 1);
      await game.settings.set('tb2e', 'grindPhase', 'adventure');
      await game.settings.set('tb2e', 'grindExtreme', false);
    });
  });

  test('GM advances the turn counter; setting + HUD display update in lockstep', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Confirm we are running as GM (HUD advance controls are GM-gated by the
    // `isGM` check in the template — see grind-tracker.hbs L6).
    const isGM = await page.evaluate(() => game.user.isGM);
    expect(isGM).toBe(true);

    const tracker = new GrindTracker(page);

    // Start from a known baseline so the test's assertions are independent
    // of any prior state mutations in this worker.
    await tracker.resetState();

    // Open the HUD via the singleton entry point.
    await tracker.open();

    // Sanity: baseline settings + DOM.
    expect(await tracker.getTurnFromSettings()).toBe(1);
    expect(await tracker.getPhaseFromSettings()).toBe('adventure');
    expect(await tracker.getExtremeFromSettings()).toBe(false);
    expect(await tracker.getTurnFromDom()).toBe(1);

    // First advance: 1 → 2. Watching the setting via expect.poll lets us
    // block on the async #onAdvanceTurn handler (which awaits a settings
    // write before re-rendering).
    await tracker.advanceTurn();

    await expect
      .poll(() => tracker.getTurnFromSettings(), { timeout: 10_000 })
      .toBe(2);

    // Advance's final step is `this.render()` on the app. Poll the DOM
    // input for the new value rather than reading once — the Handlebars
    // re-render is async relative to the setting write resolving.
    await expect
      .poll(() => tracker.getTurnFromDom(), { timeout: 10_000 })
      .toBe(2);

    // Second advance: 2 → 3. cyclePos = ((3 - 1) % 4) + 1 = 3, still not
    // a grind turn (grind turns hit at cyclePos === maxTurns === 4), so
    // no consolidated condition card posts and state change stays clean.
    await tracker.advanceTurn();

    await expect
      .poll(() => tracker.getTurnFromSettings(), { timeout: 10_000 })
      .toBe(3);

    await expect
      .poll(() => tracker.getTurnFromDom(), { timeout: 10_000 })
      .toBe(3);
  });
});
