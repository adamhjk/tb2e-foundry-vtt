import { expect } from '@playwright/test';

/**
 * Page object for the Grind Tracker HUD (DH p.75 — phases / grind turn).
 *
 * Source: `module/applications/grind-tracker.mjs` — singleton
 * `HandlebarsApplicationMixin(ApplicationV2)` rendered from
 * `templates/grind-tracker.hbs`. Access via `game.tb2e.grindTracker` or
 * `GrindTracker.getInstance()`. Also exposed on the tokens scene-controls
 * toolbar as the "grind-tracker" tool (see tb2e.mjs around L286).
 *
 * DEFAULT_OPTIONS.id = "grind-tracker" → the outer element is
 * `<div id="grind-tracker" class="application ... tb2e grind-tracker">`.
 *
 * State — stored in world-scoped settings registered in tb2e.mjs L17-19:
 *   - `tb2e.grindTurn`    (Number, default 1)
 *   - `tb2e.grindPhase`   (String, default "adventure")
 *   - `tb2e.grindExtreme` (Boolean, default false)
 *
 * Advance turn:
 *   - Click `button.advance-btn[data-action="advanceTurn"]` (only rendered
 *     when `isAdventurePhase` — i.e. phase === "adventure") — handler at
 *     grind-tracker.mjs L305 increments the `grindTurn` setting by 1 and
 *     calls `this.render()`.
 *   - The turn number is displayed in `input.turn-number-input` with
 *     `value="{{turn}}"`.
 */
export class GrindTracker {
  constructor(page) {
    this.page = page;
    this.root = page.locator('#grind-tracker');
    this.turnInput = this.root.locator('input.turn-number-input');
    this.advanceButton = this.root.locator('button.advance-btn[data-action="advanceTurn"]');
    this.phaseButton = this.root.locator('button.phase-btn[data-action="setPhase"]');
    this.turnPips = this.root.locator('.turn-pips .turn-pip');
  }

  /** Open the grind tracker HUD via the singleton API. */
  async open() {
    // `game.tb2e.grindTracker` is initialized to null in tb2e.mjs L14 and
    // only populated lazily by `GrindTracker.getInstance()` (grind-tracker.mjs
    // L52). Import the module directly and call getInstance() so the singleton
    // is guaranteed to exist before we render.
    await this.page.evaluate(async () => {
      const mod = await import('/systems/tb2e/module/applications/grind-tracker.mjs');
      const tracker = mod.default.getInstance();
      return tracker.render({ force: true });
    });
    await expect(this.root).toBeVisible();
  }

  /** Close the HUD (also teardown hook listeners — see _onClose). */
  async close() {
    await this.page.evaluate(() => game.tb2e.grindTracker?.close());
    await expect(this.root).toHaveCount(0);
  }

  /** Read the current turn number from the settings store (source of truth). */
  async getTurnFromSettings() {
    return this.page.evaluate(() => game.settings.get('tb2e', 'grindTurn'));
  }

  /** Read the current phase string from the settings store. */
  async getPhaseFromSettings() {
    return this.page.evaluate(() => game.settings.get('tb2e', 'grindPhase'));
  }

  /** Read the extreme-toggle state from the settings store. */
  async getExtremeFromSettings() {
    return this.page.evaluate(() => game.settings.get('tb2e', 'grindExtreme'));
  }

  /** Read the turn displayed in the HUD's number input. */
  async getTurnFromDom() {
    const v = await this.turnInput.inputValue();
    return Number(v);
  }

  /** Click the Advance button; returns when the button handler has resolved. */
  async advanceTurn() {
    await this.advanceButton.click();
  }

  /**
   * Reset the world-scoped grind state to its registered defaults. Tests
   * share a single Foundry world per worker — without this, a spec that
   * mutates the turn counter leaks into subsequent runs (and subsequent
   * repeat-each iterations).
   */
  async resetState() {
    await this.page.evaluate(async () => {
      await game.settings.set('tb2e', 'grindTurn', 1);
      await game.settings.set('tb2e', 'grindPhase', 'adventure');
      await game.settings.set('tb2e', 'grindExtreme', false);
    });
  }
}
