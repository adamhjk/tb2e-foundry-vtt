import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { GrindTracker } from '../pages/GrindTracker.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §10 Grind Tracker — GM cycles phases (DH p.75).
 *
 * Implementation map (verified against
 * `module/applications/grind-tracker.mjs`):
 *   - Phase state: `game.settings` `tb2e.grindPhase` (String, default
 *     "adventure"), registered in tb2e.mjs L17-19.
 *   - Phase enum is hard-coded in the handler at grind-tracker.mjs L407:
 *     `["adventure", "camp", "town"]`. Cycling from "town" wraps to
 *     "adventure" AND resets `grindTurn` to 1 (L412-414).
 *   - UI: single cycle button `button.phase-btn[data-action="setPhase"]`
 *     (grind-tracker.hbs L10-13). There is no dropdown — the button
 *     advances one step per click.
 *   - Label: `<span class="phase-btn-label">{{phaseLabel}}</span>`, where
 *     `phaseLabel` is mapped in `_prepareContext` (L124):
 *     `{ adventure: "Adventure", camp: "Camp", town: "Town" }`.
 *   - During non-adventure phases, the turn-counter / advance-button block
 *     is hidden and replaced by `.phase-name-large` (template L42-44) — we
 *     also assert that signal to catch regressions where the conditional
 *     doesn't react to the setting change.
 *
 * Scope — this spec only asserts phase cycling:
 *   - All three phase values are reachable in the documented order.
 *   - The `tb2e.grindPhase` setting and the HUD DOM label stay in lockstep.
 *   - The phase-specific UI toggles (advance button appears only in
 *     adventure; the large phase name appears only outside adventure).
 *
 * Out of scope:
 *   - Advance-turn behavior (advance-turn.spec.mjs).
 *   - Turn-reset on town→adventure wrap (covered by the advance spec's reset
 *     helper; this spec exercises it incidentally but does not assert it).
 *   - Mailbox conditions / consolidated card / light extinguish (sibling
 *     specs on §10 checklist).
 *
 * World-state hygiene: the phase setting is world-scoped and persists
 * across tests. `afterEach` resets to registered defaults so repeat-each
 * runs (and subsequent specs) see a clean baseline.
 */
test.describe('§10 Grind Tracker — set phase', () => {
  test.afterEach(async ({ page }) => {
    await page.evaluate(async () => {
      try { game.tb2e.grindTracker?.close?.(); } catch {}
      await game.settings.set('tb2e', 'grindTurn', 1);
      await game.settings.set('tb2e', 'grindPhase', 'adventure');
      await game.settings.set('tb2e', 'grindExtreme', false);
    });
  });

  test('GM cycles adventure → camp → town → adventure; setting + DOM stay in lockstep', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Phase button is gated behind the `isGM` check (grind-tracker.hbs L6).
    const isGM = await page.evaluate(() => game.user.isGM);
    expect(isGM).toBe(true);

    const tracker = new GrindTracker(page);

    // Known baseline — independent of any prior mutations in this worker.
    await tracker.resetState();

    await tracker.open();

    // Baseline: adventure. Advance button visible, phase-name-large absent.
    expect(await tracker.getPhaseFromSettings()).toBe('adventure');
    expect(await tracker.getPhaseLabelFromDom()).toBe('Adventure');
    await expect(tracker.advanceButton).toBeVisible();
    await expect(tracker.phaseNameLarge).toHaveCount(0);

    // adventure → camp.
    await tracker.cyclePhase();

    await expect
      .poll(() => tracker.getPhaseFromSettings(), { timeout: 10_000 })
      .toBe('camp');
    // The setting write is awaited inside the handler before `this.render()`,
    // but the Handlebars re-render is still async relative to the POM
    // reading the DOM — poll the label too.
    await expect
      .poll(() => tracker.getPhaseLabelFromDom(), { timeout: 10_000 })
      .toBe('Camp');

    // Advance button must disappear outside adventure (template L22 / L42).
    await expect(tracker.advanceButton).toHaveCount(0);
    await expect(tracker.phaseNameLarge).toBeVisible();
    expect(await tracker.getPhaseNameLargeFromDom()).toBe('Camp');

    // camp → town.
    await tracker.cyclePhase();

    await expect
      .poll(() => tracker.getPhaseFromSettings(), { timeout: 10_000 })
      .toBe('town');
    await expect
      .poll(() => tracker.getPhaseLabelFromDom(), { timeout: 10_000 })
      .toBe('Town');

    await expect(tracker.advanceButton).toHaveCount(0);
    await expect(tracker.phaseNameLarge).toBeVisible();
    expect(await tracker.getPhaseNameLargeFromDom()).toBe('Town');

    // town → adventure (wraps; handler also resets turn to 1 — L412-414).
    await tracker.cyclePhase();

    await expect
      .poll(() => tracker.getPhaseFromSettings(), { timeout: 10_000 })
      .toBe('adventure');
    await expect
      .poll(() => tracker.getPhaseLabelFromDom(), { timeout: 10_000 })
      .toBe('Adventure');

    // Back in adventure: advance button visible, no phase-name-large.
    await expect(tracker.advanceButton).toBeVisible();
    await expect(tracker.phaseNameLarge).toHaveCount(0);
  });
});
