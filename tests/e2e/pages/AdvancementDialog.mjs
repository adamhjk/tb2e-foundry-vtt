import { expect } from '@playwright/test';

/**
 * Page object for the TB2E advancement-prompt dialog.
 *
 * Source: `showAdvancementDialog` in module/dice/advancement.mjs renders
 * templates/dice/advancement-dialog.hbs inside
 * `foundry.applications.api.DialogV2.wait({ classes: ["tb2e",
 * "advancement-dialog"], ... })`. Foundry emits it as a `<dialog
 * class="application dialog tb2e advancement-dialog">` with:
 *   - `.window-title`                             localized "<Name> Advancement"
 *   - `.advancement-dialog-body`                  the content block
 *   - `.advancement-dialog-title`                 ability/skill label
 *   - `.advancement-dialog-prompt`                localized prompt line
 *   - `.advancement-rating-display .old`          current rating span
 *   - `.advancement-rating-display .new`          proposed rating span
 *   - `button[data-action="accept"]`              "Advance" (DialogV2 default)
 *   - `button[data-action="cancel"]`              "Cancel"
 *
 * The dialog auto-opens from the Finalize step of a chat card when the
 * pass/fail pip totals reach `advancementNeeded(rating)` (DH p.84 — rating
 * N advances at N passes + N-1 fails). It is NOT opened directly by the
 * post-roll UI — it runs inside `_logAdvancement` (tb2e-roll.mjs line 203)
 * which is fired from `logAdvancementForSide` inside the `_handleFinalize`
 * pipeline in post-roll.mjs.
 *
 * Used by:
 *   - tests/e2e/advancement/auto-trigger.spec.mjs  (this POM's first caller)
 *   - tests/e2e/advancement/accept.spec.mjs        (next §4 checkbox)
 *   - tests/e2e/advancement/cancel.spec.mjs        (next §4 checkbox)
 */
export class AdvancementDialog {
  /**
   * @param {import('@playwright/test').Page} page
   */
  constructor(page) {
    this.page = page;
    // Scope to the most recently opened TB2E advancement dialog. DialogV2
    // emits a `<dialog>` element with the classes passed to the constructor;
    // also filter on the `.advancement-dialog-body` content wrapper from the
    // hbs template so we never match unrelated TB2E dialogs that happen to
    // share the base class list.
    this.root = page
      .locator('dialog.application.dialog.tb2e.advancement-dialog')
      .filter({ has: page.locator('.advancement-dialog-body') })
      .last();

    this.title = this.root.locator('.window-title');
    this.body = this.root.locator('.advancement-dialog-body');
    this.labelText = this.root.locator('.advancement-dialog-title');
    this.promptText = this.root.locator('.advancement-dialog-prompt');
    this.oldRatingSpan = this.root.locator('.advancement-rating-display .advancement-rating.old');
    this.newRatingSpan = this.root.locator('.advancement-rating-display .advancement-rating.new');

    // DialogV2 renders each declared button with `data-action="<action>"` in
    // the footer. advancement.mjs declares exactly two actions: "accept" and
    // "cancel".
    this.acceptButton = this.root.locator('button[data-action="accept"]');
    this.cancelButton = this.root.locator('button[data-action="cancel"]');
  }

  /** Wait for the dialog to be rendered and visible. */
  async waitForOpen() {
    await expect(this.root).toBeVisible();
    await expect(this.acceptButton).toBeVisible();
    await expect(this.cancelButton).toBeVisible();
  }

  /** Wait for the dialog to close (after accept or cancel). */
  async waitForClosed() {
    await expect(this.root).toHaveCount(0);
  }

  /** Read the localized ability/skill label from the dialog body. */
  async getLabel() {
    return (await this.labelText.innerText()).trim();
  }

  /** Read the current rating displayed on the dialog. */
  async getCurrentRating() {
    const txt = (await this.oldRatingSpan.innerText()).trim();
    return Number(txt);
  }

  /** Read the proposed (new) rating displayed on the dialog. */
  async getNewRating() {
    const txt = (await this.newRatingSpan.innerText()).trim();
    return Number(txt);
  }

  /**
   * Click the "Advance" button. Runs the actor.update() that bumps the
   * rating by +1 and resets pass/fail pips to 0 (advancement.mjs lines
   * 57-69), then posts the celebration chat card.
   */
  async clickAccept() {
    await expect(this.acceptButton).toBeVisible();
    await this.acceptButton.click();
    await this.waitForClosed();
  }

  /**
   * Click the "Cancel" button. DialogV2 resolves `null` from the close
   * handler, so the guard at advancement.mjs line 54 (`if (!result) return`)
   * short-circuits before any actor update — rating and pips stay as they
   * were after the pip tick that triggered the prompt.
   */
  async clickCancel() {
    await expect(this.cancelButton).toBeVisible();
    await this.cancelButton.click();
    await this.waitForClosed();
  }
}
