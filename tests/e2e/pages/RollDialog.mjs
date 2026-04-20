import { expect } from '@playwright/test';

/**
 * Page object for the TB2E roll configuration dialog.
 *
 * Source: `_showRollDialog` in module/dice/tb2e-roll.mjs renders
 * templates/dice/roll-dialog.hbs inside `DialogV2.wait({ classes: ["tb2e",
 * "roll-dialog"] })`. Foundry emits the dialog as
 * `<dialog class="application dialog tb2e roll-dialog">`.
 *
 * Form shape (see roll-dialog.hbs):
 *   - `input[name="poolSize"]` — base dice (pre-filled with the actor's rating)
 *   - `input[name="obstacle"]` — obstacle (defaults to 1; hidden in disposition mode)
 *   - `input[name="logAdvancement"]` — checkbox; determines whether
 *     pass/fail pips tick on Finalize (defaults checked for non-conflict rolls)
 *   - `input[name="mode"]` (hidden) — "independent" | "disposition"
 *   - persona stepper `.stepper-value[data-field="personaAdvantage"]`
 *   - `.channelNature` checkbox
 *   - submit: `button[data-action="roll"]`
 *
 * Meant to be reused by any spec that exercises the roll pipeline —
 * ability-test, skill-test, roll-dialog-modifiers, help, fate, etc.
 */
export class RollDialog {
  constructor(page) {
    this.page = page;
    /**
     * Scope to the most recently opened TB2E roll dialog. DialogV2 emits a
     * `<dialog>` element with the classes passed to the constructor; we also
     * filter on the `.tb2e-roll-dialog-form` wrapper rendered by the hbs.
     */
    this.root = page
      .locator('dialog.application.dialog.tb2e.roll-dialog')
      .filter({ has: page.locator('.tb2e-roll-dialog-form') })
      .last();

    this.poolSizeInput = this.root.locator('input[name="poolSize"]');
    this.obstacleInput = this.root.locator('input[name="obstacle"]');
    this.logAdvancementCheckbox = this.root.locator('input[name="logAdvancement"]');
    this.modeInput = this.root.locator('input[name="mode"]');

    // Manual modifier controls
    this.addModifierButton = this.root.locator('.add-modifier-btn');
    this.modifierList = this.root.locator('.roll-dialog-modifiers');

    // Persona controls
    this.personaAdvantageValue = this.root.locator(
      '.stepper-value[data-field="personaAdvantage"]'
    );
    this.personaAdvantagePlus = this.root.locator(
      '.persona-advantage .stepper-btn[data-delta="1"]'
    );
    this.personaAdvantageMinus = this.root.locator(
      '.persona-advantage .stepper-btn[data-delta="-1"]'
    );
    this.channelNatureCheckbox = this.root.locator('input[name="channelNature"]');

    // Submit / cancel. DialogV2 renders button[data-action="roll"] / "cancel".
    this.submitButton = this.root.locator('button[data-action="roll"]');
    this.cancelButton = this.root.locator('button[data-action="cancel"]');

    // Live summary at the bottom of the form
    this.summaryText = this.root.locator('.roll-dialog-summary-text');
  }

  /** Wait for the dialog to be rendered and visible. */
  async waitForOpen() {
    await expect(this.root).toBeVisible();
    await expect(this.submitButton).toBeVisible();
  }

  /** Wait for the dialog to close (after submit or cancel). */
  async waitForClosed() {
    await expect(this.root).toBeHidden();
  }

  /**
   * Set the obstacle input. Triggers the dialog's summary re-render via the
   * input event listener in tb2e-roll.mjs.
   * @param {number} n
   */
  async fillObstacle(n) {
    await this.obstacleInput.fill(String(n));
  }

  /**
   * Set the dice pool input (rarely needed — the dialog pre-fills with the
   * actor's rating). Exposed for future specs that override the pool.
   * @param {number} n
   */
  async fillPoolSize(n) {
    await this.poolSizeInput.fill(String(n));
  }

  /**
   * Toggle the "Log Advancement" checkbox. Off means no pass/fail pip is
   * applied when the card is finalized. Passing `false` un-checks the box.
   * @param {boolean} value
   */
  async setLogAdvancement(value) {
    if (value) await this.logAdvancementCheckbox.check();
    else await this.logAdvancementCheckbox.uncheck();
  }

  /** Click the "Roll" button to submit the dialog. */
  async submit() {
    await this.submitButton.click();
    await this.waitForClosed();
  }

  /** Click the "Cancel" button to dismiss the dialog without rolling. */
  async cancel() {
    await this.cancelButton.click();
    await this.waitForClosed();
  }

  /** Read the current pool-size input value as a number. */
  async getPoolSize() {
    const v = await this.poolSizeInput.inputValue();
    return Number(v);
  }

  /** Read the current obstacle input value as a number. */
  async getObstacle() {
    const v = await this.obstacleInput.inputValue();
    return Number(v);
  }
}
