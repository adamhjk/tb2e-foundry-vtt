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

  /**
   * Read the live summary text at the bottom of the form (e.g. "5D vs Ob 3").
   * Source: `updateSummary` in module/dice/tb2e-roll.mjs writes to
   * `.roll-dialog-summary-text` on every relevant input event. Useful for
   * asserting that the pool size reflects dialog-side modifiers before submit.
   */
  async getSummaryText() {
    return (await this.summaryText.innerText()).trim();
  }

  /**
   * Parse the leading NN from the summary's "ND vs Ob M" line. For the
   * independent/disposition/versus templates alike, the summary starts with
   * a pool-size integer followed by `D`.
   */
  async getSummaryPool() {
    const text = await this.getSummaryText();
    const match = text.match(/(\d+)\s*D/);
    if (!match) throw new Error(`RollDialog: cannot parse summary pool from "${text}"`);
    return Number(match[1]);
  }

  /** All currently-rendered modifier rows (conditions + helpers + manual + ...). */
  get modifierRows() {
    return this.modifierList.locator('.roll-modifier');
  }

  /**
   * Locator for a PC helper-toggle button by helper actor id. The helpers
   * block only renders when `hasHelpers` is true (roller has eligible, non-
   * blocked helpers on the scene); see module/dice/help.mjs `getEligibleHelpers`
   * and the `.roll-dialog-helpers` block in templates/dice/roll-dialog.hbs.
   *
   * The helpers section is rendered collapsed by default
   * (`.collapsible.collapsed` in the template), and the CSS hides the
   * section body via `display: none` — callers should use `.toHaveCount(1)`
   * for existence assertions or call `toggleHelper()` which expands the
   * section before clicking.
   * @param {string} helperId  The actor id of the helper
   */
  helperToggle(helperId) {
    return this.root.locator(
      `.roll-dialog-helpers .helper-toggle[data-helper-id="${helperId}"]`
    );
  }

  /**
   * Toggle a specific helper ON in the dialog. Expands the collapsed helpers
   * section (`.roll-dialog-helpers.collapsed` → remove `.collapsed`) and clicks
   * the helper's toggle button. The dialog's JS click handler (module/dice/
   * tb2e-roll.mjs near line 669) adds `.active` to the button, bumps
   * `helperBonus`, re-renders the modifier list, and updates the summary.
   *
   * Asserts the button ends up in the `.active` state so callers can trust
   * the pool includes the +1D by the time this resolves (DH p.63 — help is
   * +1D per helper).
   * @param {string} helperId
   */
  async toggleHelper(helperId) {
    const section = this.root.locator('.roll-dialog-helpers');
    await expect(section).toHaveCount(1);
    // The helpers block starts with `.collapsed`, which applies
    // `display: none` to its `.section-body` (see
    // less/dice/roll-dialog.less line 977) — expand it so the toggle
    // button inside is hittable by click. The production render() wires a
    // click listener on `.helpers-heading` that toggles `.collapsed` on
    // the parent; we replicate the end state directly to avoid relying
    // on the (visible) heading's layout position.
    await section.evaluate(el => el.classList.remove('collapsed'));
    const btn = this.helperToggle(helperId);
    await expect(btn).toBeVisible();
    await btn.click();
    await expect(btn).toHaveClass(/(^|\s)active(\s|$)/);
  }

  /**
   * Add a manual modifier via the dialog's inline form (DH "no RAW modifiers
   * added by UI" — this is the dialog's free-form field the player fills out
   * at the table). Clicks "Add Manual Modifier" to reveal the label/type/value
   * row, fills it, and presses the confirm button which rolls up into the
   * modifier list and `updateSummary()`.
   *
   * Source: tb2e-roll.mjs `render()` wires `.add-modifier-btn` to an inline
   * `.manual-modifier-input` row with:
   *   - `input.manual-label` — free-text label
   *   - `select.manual-type`  — "dice" | "success" | "obstacle"
   *   - `input.manual-value`  — signed integer
   *   - `button.manual-confirm` — commits the modifier
   *
   * @param {object} opts
   * @param {string} [opts.label] label text (free-form); defaults to the input's placeholder
   * @param {'dice'|'success'|'obstacle'} [opts.type='dice']
   * @param {number} [opts.value=1]
   */
  async addManualModifier({ label, type = 'dice', value = 1 } = {}) {
    await this.addModifierButton.click();
    const row = this.root.locator('.manual-modifier-input').last();
    await expect(row).toBeVisible();
    if (label !== undefined) await row.locator('.manual-label').fill(label);
    await row.locator('.manual-type').selectOption(type);
    await row.locator('.manual-value').fill(String(value));
    await row.locator('.manual-confirm').click();
    // Confirm strips the inline row; wait for it to detach so subsequent
    // assertions see the committed modifier list.
    await expect(row).toHaveCount(0);
  }
}
