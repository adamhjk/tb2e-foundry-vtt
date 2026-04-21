import { expect } from '@playwright/test';

/**
 * Page object for a TB2E roll-result chat card.
 *
 * Source: `_handleIndependentRoll` (module/dice/tb2e-roll.mjs) renders
 * templates/chat/roll-result.hbs and `ChatMessage.create()`s a message with
 * the content injected into the sidebar chat log. The template's root is
 * `<div class="tb2e-chat-card">` with a distinctive `.roll-card-breakdown`
 * child — we filter by that presence to avoid matching other TB2E chat
 * cards (versus-resolution, grind, loot-draw, etc.) which reuse
 * `.tb2e-chat-card`.
 *
 * Selector map (roll-result.hbs):
 *   - `.tb2e-chat-card`                 card root
 *   - `.card-header .card-label`        actor + label line ("Ability Will Test")
 *   - `.roll-card-breakdown`            pool/mod breakdown block
 *   - `.breakdown-total`                final pool/obstacle summary line
 *   - `.roll-card-dice .die-result`     one span per die result
 *   - `.roll-card-tally .tally-successes` "Successes: N"
 *   - `.roll-card-tally .tally-obstacle` "Obstacle: N"
 *   - `.card-banner.banner-pass`        pass outcome banner
 *   - `.card-banner.banner-fail`        fail outcome banner
 */
export class RollChatCard {
  /**
   * @param {import('@playwright/test').Page} page
   * @param {object} [opts]
   * @param {number} [opts.nth=-1] 0-based index (−1 means the most recent).
   */
  constructor(page, { nth = -1 } = {}) {
    this.page = page;
    // Foundry V13 renders messages as `<li class="chat-message">` inside a
    // `<ol class="chat-log">` container — both the sidebar tab AND the
    // popout notifications area use these class names. We scope by
    // `.chat-message .tb2e-chat-card` (any chat-log ancestor) so the POM
    // works whether the sidebar tab is active or a popout notification is
    // the only rendered copy.
    const cards = page
      .locator('.chat-message .tb2e-chat-card')
      .filter({ has: page.locator('.roll-card-breakdown') });
    this.root = nth < 0 ? cards.last() : cards.nth(nth);

    this.label = this.root.locator('.card-header .card-label');
    this.breakdown = this.root.locator('.roll-card-breakdown');
    this.breakdownTotal = this.root.locator('.breakdown-total');
    this.diceResults = this.root.locator('.roll-card-dice .die-result');
    this.successesText = this.root.locator('.roll-card-tally .tally-successes');
    this.obstacleText = this.root.locator('.roll-card-tally .tally-obstacle');
    this.passBanner = this.root.locator('.card-banner.banner-pass');
    this.failBanner = this.root.locator('.card-banner.banner-fail');

    // Post-roll action buttons. The Finalize button is rendered inside
    // `.card-actions` and carries `data-action="finalize"`. Clicking it
    // triggers `_handleFinalize` in module/dice/post-roll.mjs, which logs
    // pass/fail pip advancement (for non-versus, non-disposition rolls).
    this.finalizeButton = this.root.locator('.card-actions button[data-action="finalize"]');
  }

  /**
   * Click the green "Finalize" button on the chat card. This triggers the
   * pass/fail pip advancement pipeline (see module/dice/post-roll.mjs
   * `_handleFinalize` → `logAdvancementForSide` → `_logAdvancement`) and
   * re-renders the card without the post-roll action buttons. Callers
   * should await this before reading actor pip counters.
   *
   * The chat log in Foundry V13 lives inside a flex column with a custom
   * scroll container, and — depending on sidebar layout — the button's
   * bounding box often sits outside the page's visual viewport even after
   * `scrollIntoViewIfNeeded` (the inner overflow scroll is the sidebar,
   * not the page). Rather than fighting geometry, dispatch a native click
   * event directly — `_attachCardEventHandlers` in module/dice/post-roll.mjs
   * wires the handler with a plain `addEventListener("click", ...)` on the
   * button node, so `button.click()` triggers the same code path as a real
   * user click.
   *
   * After dispatch, wait for the post-roll re-render to strip the
   * `.card-actions` block — which is the source-of-truth signal that
   * `_handleFinalize` has run to completion.
   */
  async clickFinalize() {
    await expect(this.finalizeButton).toBeVisible();
    await this.finalizeButton.evaluate(btn => btn.click());
    await expect(this.finalizeButton).toHaveCount(0, { timeout: 10_000 });
  }

  /** Assert that a roll card is present. */
  async expectPresent() {
    await expect(this.root).toBeVisible();
    await expect(this.breakdown).toBeVisible();
  }

  /**
   * Parse the "Successes: N" line and return N.
   * The template renders `{{successesLabel}}: {{successes}}` — we pull the
   * trailing integer to stay resilient to i18n.
   */
  async getSuccesses() {
    const txt = (await this.successesText.innerText()).trim();
    const match = txt.match(/(\d+)\s*$/);
    if (!match) throw new Error(`RollChatCard: cannot parse successes from "${txt}"`);
    return Number(match[1]);
  }

  /**
   * Parse the "Obstacle: N" line and return N. For versus/disposition cards
   * this element is not rendered — callers should guard via
   * `await card.obstacleText.count() > 0` before calling.
   */
  async getObstacle() {
    const txt = (await this.obstacleText.innerText()).trim();
    const match = txt.match(/(\d+)\s*$/);
    if (!match) throw new Error(`RollChatCard: cannot parse obstacle from "${txt}"`);
    return Number(match[1]);
  }

  /**
   * Parse the final-pool-size from the ".breakdown-total" line. For
   * independent rolls the template renders "{{poolSize}}D vs Ob {{obstacle}}";
   * we pull the leading integer.
   */
  async getPool() {
    const txt = (await this.breakdownTotal.innerText()).trim();
    const match = txt.match(/(\d+)\s*D/);
    if (!match) throw new Error(`RollChatCard: cannot parse pool from "${txt}"`);
    return Number(match[1]);
  }

  /** Count of die-result glyphs rendered on the card. */
  diceCount() {
    return this.diceResults.count();
  }

  /** True if the pass banner is visible (independent rolls only). */
  async isPass() {
    const passCount = await this.passBanner.count();
    if (passCount > 0) return true;
    const failCount = await this.failBanner.count();
    if (failCount > 0) return false;
    throw new Error('RollChatCard: neither pass nor fail banner is present');
  }
}
