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
    this.personaSection = this.root.locator('.roll-dialog-persona');

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
   * Locator for the `.roll-dialog-helpers` section wrapper. Rendered only
   * when `hasHelpers` is true (at least one non-blocked eligible helper on
   * the scene — see `getEligibleHelpers` + `isBlockedFromHelping` in
   * module/dice/help.mjs and the `{{#if hasHelpers}}` guard in
   * templates/dice/roll-dialog.hbs line 202). Use `.toHaveCount(0)` to
   * assert the helpers block is entirely absent, e.g. when the only
   * candidate is KO'd / afraid / dead (help.mjs lines 53-59).
   */
  get helpersSection() {
    return this.root.locator('.roll-dialog-helpers');
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
   * section before clicking. For absence checks (e.g. KO'd helper filtered
   * out of the pool), `.toHaveCount(0)` works against a scoped locator that
   * only exists inside `.roll-dialog-helpers`.
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
    const section = this.helpersSection;
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
   * The `.helper-row` wrapper for a specific helper id. Contains both the
   * `.helper-toggle` and (when the helper is a character with fate > 0) the
   * `.helper-synergy-btn` — see templates/dice/roll-dialog.hbs L215-228.
   * When the synergy button is clicked, this row gets the `.synergy-active`
   * class added (module/dice/tb2e-roll.mjs L707).
   * @param {string} helperId
   */
  helperRow(helperId) {
    return this.root.locator(
      `.roll-dialog-helpers .helper-row[data-helper-id="${helperId}"]`
    );
  }

  /**
   * The star-icon synergy button inside a specific helper's row. Rendered
   * iff the helper is a character with `fate.current > 0` (`{{#if hasFate}}`
   * guard at templates/dice/roll-dialog.hbs L224). Clicking it auto-toggles
   * the help on (tb2e-roll.mjs L695-705) AND marks the row
   * `.synergy-active` (L707) — on submit, the helper's `synergy` field is
   * set to `true` in `selectedHelpers` (L1122). That flows into the chat
   * card's `synergyHelpers` array (roll-utils.mjs L133) which renders the
   * post-roll synergy button for this helper.
   * @param {string} helperId
   */
  helperSynergyButton(helperId) {
    return this.root.locator(
      `.roll-dialog-helpers .helper-synergy-btn[data-helper-id="${helperId}"]`
    );
  }

  /**
   * Click the synergy (star) button on a helper row. Expands the helpers
   * section first (same collapsed-section handling as `toggleHelper`), then
   * dispatches the native click so the production handler at tb2e-roll.mjs
   * L691-708 runs. Asserts both post-conditions:
   *   - the row ends up `.synergy-active` (tb2e-roll.mjs L707)
   *   - the sibling `.helper-toggle` becomes `.active` (auto-engaged at
   *     L696-704 when the help wasn't previously active)
   * so callers can trust both the +1D help contribution and the
   * synergy marker by the time this resolves.
   * @param {string} helperId
   */
  async toggleHelperSynergy(helperId) {
    const section = this.helpersSection;
    await expect(section).toHaveCount(1);
    await section.evaluate(el => el.classList.remove('collapsed'));
    const btn = this.helperSynergyButton(helperId);
    await expect(btn).toBeVisible();
    await btn.click();
    await expect(this.helperRow(helperId)).toHaveClass(
      /(^|\s)synergy-active(\s|$)/
    );
    await expect(this.helperToggle(helperId)).toHaveClass(
      /(^|\s)active(\s|$)/
    );
  }

  /**
   * Locator for the wise-selector section wrapper. Rendered only when
   * `hasWises` is true (the roller is a character with at least one named
   * wise on `system.wises`, and is not Angry — see tb2e-roll.mjs lines
   * 391-392 and the `{{#if hasWises}}` guard in templates/dice/roll-dialog.hbs
   * line 260). Use `.toHaveCount(0)` to assert the wise block is absent
   * when the actor has no wises.
   */
  get wiseSection() {
    return this.root.locator('.roll-dialog-wises');
  }

  /**
   * The native `<select name="wise">` element inside the wise section.
   * Wise entries are emitted in actor-array order with `option[value="<index>"]`;
   * the default "None" is `value="-1"` (see roll-dialog.hbs line 268).
   */
  get wiseSelect() {
    return this.root.locator('select[name="wise"]');
  }

  /**
   * Choose the wise at the given `system.wises[index]` as the "Related Wise"
   * for this roll. Expands the collapsed wise section (same pattern as
   * `toggleHelper`) and sets the select value. Selecting a wise enables the
   * post-roll "Ah, Of Course!" (Persona) and "Deeper Understanding" (Fate)
   * buttons on the chat card (DH p.77) — see `wiseSelected` in
   * roll-utils.mjs `buildChatTemplateData` line 130 and the template guards
   * in templates/chat/roll-result.hbs lines 92-107.
   *
   * On submit the selected index travels as `config.wiseIndex`
   * (tb2e-roll.mjs line 1136/1158/1184) into `_buildRollFlags` where it
   * becomes `flags.tb2e.roll.wise = { name, index }` (line 1451).
   * @param {number} index 0-based index into actor.system.wises
   */
  async selectWise(index) {
    const section = this.wiseSection;
    await expect(section).toHaveCount(1);
    // Same collapsed-section handling as `toggleHelper` — the section body
    // is hidden by `display: none` until `.collapsed` is removed. Playwright
    // can `selectOption` a visible select, so we expand the section first.
    await section.evaluate(el => el.classList.remove('collapsed'));
    await expect(this.wiseSelect).toBeVisible();
    await this.wiseSelect.selectOption(String(index));
  }

  /**
   * Toggle "Channel Your Nature" (SG p.87 / DH p.119) in the roll dialog's
   * persona section. Channeling your Nature costs 1 Persona and adds
   * `natureRating` dice to the pool (tb2e-roll.mjs lines 615-622). It also
   * sets `flags.tb2e.channelNature = true` on the resulting chat message
   * (tb2e-roll.mjs line 1452), which gates the post-roll Nature Tax prompt
   * (`showNatureTax` in roll-utils.mjs and tb2e-roll.mjs line 1518 / post-
   * roll.mjs line 892).
   *
   * The persona section is rendered `.collapsible.collapsed` (roll-dialog.hbs
   * line 164) — its CSS hides the section body via `display: none`. Same
   * pattern as `toggleHelper` / `selectWise`: expand the section first, then
   * click the checkbox so Playwright sees it as visible.
   *
   * The `change` handler in tb2e-roll.mjs line 831-841 also clamps persona
   * advantage if the available persona drops below the current advantage +
   * channel-nature cost — stage actors with persona.current >= 1 + any
   * advantage needed.
   */
  async toggleChannelNature() {
    const section = this.personaSection;
    await expect(section).toHaveCount(1);
    await section.evaluate(el => el.classList.remove('collapsed'));
    await expect(this.channelNatureCheckbox).toBeVisible();
    await this.channelNatureCheckbox.check();
    await expect(this.channelNatureCheckbox).toBeChecked();
  }

  /**
   * Increment the pre-roll Persona Advantage stepper by `n` clicks of the
   * `+` button (SG p.88 — "Advantage: each persona point adds +1D to the
   * roll"). Each click fires the handler wired at tb2e-roll.mjs L820-829:
   * clamps `personaState.advantage` to [0, min(3, personaAvailable − (chan
   * ? 1 : 0))], updates the `.stepper-value[data-field='personaAdvantage']`
   * readout, re-renders the modifier list (which now contains `advantage`
   * copies of a +1D source="persona" modifier — tb2e-roll.mjs L607-613),
   * and refreshes the live `.roll-dialog-summary-text` pool.
   *
   * Expands the collapsed persona section first — same pattern as
   * `toggleChannelNature` / `toggleHelper` / `selectWise`. The section body
   * is hidden by `display: none` until `.collapsed` is removed (`less/dice/
   * roll-dialog.less`), so we drop the class to make the stepper button
   * hittable by click without relying on the heading's layout position.
   *
   * Asserts the visible stepper value lands at exactly `n` so callers can
   * trust the +nD advantage contribution has been registered by the time
   * this resolves — catches a regression where the stepper clamps silently
   * (e.g. `personaAvailable < n` would pin advantage below n).
   *
   * Stage actors with `persona.current >= n` for this to reach exactly n.
   * @param {number} n  Number of persona points to spend on advantage (1-3).
   */
  async incrementPersonaAdvantage(n = 1) {
    const section = this.personaSection;
    await expect(section).toHaveCount(1);
    await section.evaluate(el => el.classList.remove('collapsed'));
    await expect(this.personaAdvantagePlus).toBeVisible();
    for ( let i = 0; i < n; i++ ) await this.personaAdvantagePlus.click();
    await expect(this.personaAdvantageValue).toHaveText(String(n));
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
