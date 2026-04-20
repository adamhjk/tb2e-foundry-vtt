import { expect } from '@playwright/test';

/**
 * Page object for the Character Creation Wizard (`module/applications/actor/
 * character-wizard.mjs`). The wizard is an ApplicationV2 window with
 * classes=["character-wizard"] and title "Character Creation" (localization
 * key `TB2E.Wizard.Title`).
 *
 * Because the wizard is rendered as a separate top-level Foundry window
 * (outside the character sheet DOM), we scope this POM to the wizard window
 * itself — matched by its `.character-wizard` class and window title.
 *
 * The wizard walks up to 12 steps: class, upbringing (human/changeling only),
 * hometown, social, specialty, wises, nature, circles, gear, weapons, armor,
 * finishing. Most selection cards have `data-action="select*"` attributes,
 * so data-attribute lookups are stable against locale changes. Some steps
 * render text inputs whose state is synced via `_onRender` listeners on
 * the `change` or `input` events — this POM fires `.fill(...).blur()` to
 * mimic that flow.
 */
export class CharacterWizard {
  constructor(page, actorName) {
    this.page = page;
    this.actorName = actorName;
    // Wizard is a top-level ApplicationV2. We filter by class and — to be
    // robust against opening multiple wizards in parallel — also by the
    // window title (which is always the localized "Character Creation"
    // string, not tied to the actor). The `actorName` parameter is kept
    // for future multi-actor scenarios but we do not currently scope by it.
    this.root = page
      .locator('.application.character-wizard')
      .filter({ has: page.locator('.window-title', { hasText: /Character Creation/i }) });
  }

  async expectOpen() {
    await expect(this.root).toBeVisible();
  }

  async expectClosed() {
    await expect(this.root).toHaveCount(0);
  }

  /**
   * Heading text of the currently-rendered step panel. Each step template
   * emits an `<h2 class="step-heading">` as its first content.
   */
  get currentStepHeading() {
    return this.root.locator('.wizard-content .step-heading').first();
  }

  /* ------------------------------------------------------------------ */
  /*  Footer Navigation                                                 */
  /* ------------------------------------------------------------------ */

  get nextButton() {
    return this.root.locator('button.wizard-btn.next[data-action="next"]');
  }

  get prevButton() {
    return this.root.locator('button.wizard-btn.prev[data-action="prev"]');
  }

  get finishButton() {
    return this.root.locator('button.wizard-btn.finish[data-action="finish"]');
  }

  /** Advance to the next step. Asserts the Next button is enabled. */
  async next() {
    await expect(this.nextButton).toBeEnabled();
    await this.nextButton.click();
  }

  /** Click Finish. Asserts the Finish button is enabled. */
  async finish() {
    await expect(this.finishButton).toBeEnabled();
    await this.finishButton.click();
  }

  /* ------------------------------------------------------------------ */
  /*  Step 1: Class & Stock                                             */
  /* ------------------------------------------------------------------ */

  /**
   * Click the class card for the given class key (e.g. "ranger").
   * Selecting a class with a single stock option auto-selects the stock
   * and sets default will/health, so the class step becomes complete
   * immediately without requiring further interaction.
   */
  async selectClass(key) {
    await this.root
      .locator(`.class-card[data-action="selectClass"][data-class-key="${key}"]`)
      .click();
  }

  /** Select a stock when the class has multiple options. */
  async selectStock(key) {
    await this.root
      .locator(`.stock-btn[data-action="selectStock"][data-stock="${key}"]`)
      .click();
  }

  /* ------------------------------------------------------------------ */
  /*  Step 2: Upbringing (human/changeling only — skipped otherwise)   */
  /* ------------------------------------------------------------------ */

  async selectUpbringing(skillKey) {
    await this.root
      .locator(`[data-action="selectUpbringing"][data-skill="${skillKey}"]`)
      .click();
  }

  /* ------------------------------------------------------------------ */
  /*  Step 3: Hometown + hometown skill + home trait                    */
  /* ------------------------------------------------------------------ */

  async selectHometown(key) {
    await this.root
      .locator(`.hometown-card[data-action="selectHometown"][data-hometown="${key}"]`)
      .click();
  }

  async selectHometownSkill(skillKey) {
    await this.root
      .locator(`[data-action="selectHometownSkill"][data-skill="${skillKey}"]`)
      .click();
  }

  async selectHomeTrait(traitName) {
    await this.root
      .locator(`[data-action="selectHomeTrait"][data-trait="${traitName}"]`)
      .click();
  }

  /* ------------------------------------------------------------------ */
  /*  Step 4: Social grace                                              */
  /* ------------------------------------------------------------------ */

  async selectSocial(skillKey) {
    await this.root
      .locator(`[data-action="selectSocial"][data-skill="${skillKey}"]`)
      .click();
  }

  /* ------------------------------------------------------------------ */
  /*  Step 5: Specialty                                                 */
  /* ------------------------------------------------------------------ */

  async selectSpecialty(skillKey) {
    await this.root
      .locator(`[data-action="selectSpecialty"][data-skill="${skillKey}"]`)
      .click();
  }

  /* ------------------------------------------------------------------ */
  /*  Step 6: Wises                                                     */
  /* ------------------------------------------------------------------ */

  async selectRequiredWise(name) {
    await this.root
      .locator(`[data-action="selectRequiredWise"][data-wise="${name}"]`)
      .click();
  }

  /**
   * Fill the free-choice wise input at the given 0-based index within the
   * free-wise slots. Template-wise the wise-input field carries
   * `data-wise-index="<absolute index>"`, where absolute index = required
   * picks + free slot index.
   */
  async fillFreeWise(absoluteIndex, value) {
    const input = this.root.locator(`input.wise-input[data-wise-index="${absoluteIndex}"]`);
    await input.fill(value);
    // `_onRender` binds `change` on this input, then re-renders. We use blur
    // to trigger change without relying on wholesale Playwright commit rules.
    await input.blur();
  }

  /* ------------------------------------------------------------------ */
  /*  Step 7: Nature                                                    */
  /* ------------------------------------------------------------------ */

  /**
   * Answer a nature question. `answer` is "yes" or "no" to match the
   * data-answer attribute emitted by step-nature.hbs.
   */
  async answerNature(questionIndex, answer) {
    await this.root
      .locator(
        `[data-action="answerNature"][data-question-index="${questionIndex}"][data-answer="${answer}"]`,
      )
      .click();
  }

  async selectNatureWise(name) {
    await this.root
      .locator(`[data-action="selectNatureWise"][data-wise="${name}"]`)
      .click();
  }

  async selectNatureHomeTrait(name) {
    await this.root
      .locator(`[data-action="selectNatureHomeTrait"][data-trait="${name}"]`)
      .click();
  }

  /* ------------------------------------------------------------------ */
  /*  Step 8: Circles                                                   */
  /* ------------------------------------------------------------------ */

  /**
   * Answer one of the four circles questions. `question` is the flag name
   * ("hasFriend", "hasParents", "hasMentor", "hasEnemy"), `answer` is
   * "yes" or "no".
   */
  async answerCircles(question, answer) {
    await this.root
      .locator(
        `[data-action="answerCircles"][data-question="${question}"][data-answer="${answer}"]`,
      )
      .click();
  }

  /**
   * Fill the text field for a circles relationship (only rendered when
   * the corresponding answer is "yes"). `field` is one of
   * "friend" | "parents" | "mentor" | "enemy".
   */
  async fillCirclesDetail(field, value) {
    const input = this.root.locator(`input.circles-input[data-field="${field}"]`);
    await input.fill(value);
    await input.blur();
  }

  /* ------------------------------------------------------------------ */
  /*  Step 9: Gear                                                      */
  /* ------------------------------------------------------------------ */

  /** Select a pack type — "satchel" or "backpack". */
  async selectPackType(type) {
    await this.root
      .locator(`.pack-btn[data-action="selectPackType"][data-pack="${type}"]`)
      .click();
  }

  /**
   * Roll the theurge/shaman relic table (3d6) — triggers
   * `#onRollRelics`, which populates state.relics + state.invocations
   * from `THEURGE_RELIC_TABLE`/`SHAMAN_RELIC_TABLE` and re-renders. The
   * button is only visible while `needsRelicRoll` is true; after the
   * roll the gear step renders `.relic-list` and `.invocation-list`
   * badges instead.
   */
  async rollRelics() {
    await this.root.locator('button.roll-btn[data-action="rollRelics"]').click();
  }

  /** Locator for the list of relic badges rendered after rollRelics(). */
  get relicBadges() {
    return this.root.locator('.relic-list .relic-badge');
  }

  /** Locator for the list of invocation badges rendered after rollRelics(). */
  get invocationBadges() {
    return this.root.locator('.invocation-list .invocation-badge');
  }

  /** Roll the magician spell-school table (2d6). Parallel to rollRelics(). */
  async rollSpells() {
    await this.root.locator('button.roll-btn[data-action="rollSpells"]').click();
  }

  /**
   * Locator for the list of spell-name badges rendered after rollSpells().
   * Template (step-gear.hbs) emits `.spell-list .spell-badge` for each name
   * in `state.spells`. Present only for `isMagician` classes.
   */
  get spellBadges() {
    return this.root.locator('.spell-list .spell-badge');
  }

  /* ------------------------------------------------------------------ */
  /*  Step 10: Weapons                                                  */
  /* ------------------------------------------------------------------ */

  async selectWeapon(name) {
    await this.root
      .locator(`.weapon-card[data-action="selectWeapon"][data-weapon="${name}"]`)
      .click();
  }

  async toggleShield() {
    await this.root.locator('[data-action="toggleShield"]').click();
  }

  /* ------------------------------------------------------------------ */
  /*  Step 11: Armor                                                    */
  /* ------------------------------------------------------------------ */

  async selectArmor(name) {
    await this.root
      .locator(`.armor-card[data-action="selectArmor"][data-armor="${name}"]`)
      .click();
  }

  /* ------------------------------------------------------------------ */
  /*  Step 12: Finishing                                                */
  /* ------------------------------------------------------------------ */

  /**
   * Fill a finishing-step field by its `data-field` attribute. Finishing
   * inputs fire both `input` and `change` listeners via `_onRender`, so
   * `.fill()` + `.blur()` is sufficient to persist state.
   */
  async fillFinishing(field, value) {
    const input = this.root.locator(`input.finishing-input[data-field="${field}"]`);
    await input.fill(String(value));
    await input.blur();
  }
}
