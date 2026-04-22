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

    // "Ah, Of Course!" (Persona 1) — post-roll wise aid. Appears only when
    // all three of: `wiseSelected` (roller picked a related wise pre-roll),
    // `hasPersona` (actor has persona.current > 0), and `hasWyrms` (at
    // least one failed die in the roll). Clicking triggers `_handleOfCourse`
    // in module/dice/post-roll.mjs: spends 1 Persona, rolls `wyrmCount` new
    // d6 and appends them to the dice results (DH p.77 "reroll all failed
    // dice on a test related to your wise"), and marks `wises[index].persona
    // = true` on the actor. If all four advancement boxes (pass/fail/fate/
    // persona) are then set, `_checkWiseAdvancement` posts the wise-
    // advancement card (DH p.78).
    this.ofCourseButton = this.root.locator('.card-actions button[data-action="of-course"]');

    // "Fate: Luck" (Fate 1) — post-roll exploding 6s spend (DH p.47 / SG
    // p.87). Appears only when `hasFate` (actor.system.fate.current > 0)
    // AND `hasSuns` (at least one die rolled a 6 — an "isSun" die). Clicking
    // triggers `_handleFateLuck` in module/dice/post-roll.mjs: counts suns
    // in the ORIGINAL roll, rolls that many new dice (tagged `isLuck: true`),
    // cascades by rerolling every new 6 until no suns remain, appends all
    // luck dice to the pool, adds their successes to the tally, and flips
    // `flags.tb2e.luckUsed = true` on the message (hides the button on
    // re-render via `{{#unless luckUsed}}` in roll-result.hbs line 110).
    // Also decrements actor.system.fate.current by 1 and increments
    // actor.system.fate.spent by 1.
    this.fateLuckButton = this.root.locator('.card-actions button[data-action="fate-luck"]');

    // "Deeper Understanding" (Fate 1) — post-roll wise-aid fate spend
    // (SG p.87). Appears only when `hasFate` (actor.system.fate.current > 0),
    // `wiseSelected` (roller picked a related wise pre-roll), AND `hasWyrms`
    // (at least one failed die). Also hidden by `{{#unless deeperUsed}}` and
    // `{{#unless luckUsed}}` guards — Deeper Understanding must be used
    // BEFORE Fate: Luck per SG p.87 ("Use this option before spending fate
    // to reroll 6s"). Clicking triggers `_handleDeeperUnderstanding` in
    // module/dice/post-roll.mjs: spends 1 Fate, rerolls the first wyrm
    // (failed die) in place (tagged `isRerolled: true`, replacing — NOT
    // appending like Fate: Luck / Of Course), recalculates successes, marks
    // `wises[index].fate = true` on the actor (DH p.78 advancement box),
    // and flips `flags.tb2e.deeperUsed = true` to hide the button on
    // subsequent re-renders (roll-result.hbs line 90 `{{#unless deeperUsed}}`).
    this.deeperUnderstandingButton = this.root.locator(
      '.card-actions button[data-action="deeper-understanding"]'
    );

    // Nature Tax post-roll prompt (DH p.119). Rendered when
    // `showNatureTax = channelNature && !natureTaxResolved` (post-roll.mjs
    // line 892 / tb2e-roll.mjs line 1518). The template emits a pair of
    // buttons inside `.nature-tax-prompt` — "Yes" (`data-action="nature-yes"`)
    // marks the roll as within the character's Nature descriptors (no tax),
    // "No" (`data-action="nature-no"`) applies the nature tax to the actor:
    // `_handleNatureTax` in module/dice/post-roll.mjs (lines 328-365) deducts
    // `calculateNatureTax(...)` from `system.abilities.nature.rating`
    // (1 on pass, `obstacle - finalSuccesses` clamped to >= 1 on fail;
    // see roll-utils.mjs line 68-71). When the decrement lands nature at 0,
    // a nature-crisis chat card is posted (`_postNatureCrisis`, post-roll.mjs
    // line 600). Both buttons flip `flags.tb2e.natureTaxResolved = true` on
    // the message, which removes the prompt from the re-rendered card.
    this.natureTaxPrompt = this.root.locator('.card-actions .nature-tax-prompt');
    this.natureTaxYesButton = this.root.locator(
      '.card-actions button[data-action="nature-yes"]'
    );
    this.natureTaxNoButton = this.root.locator(
      '.card-actions button[data-action="nature-no"]'
    );

    // Helper-synergy block (SG p.87). Rendered inside `.roll-card-helpers`
    // for every synergy-marked helper that hasn't yet been processed — the
    // filter is `h.synergy && !helperSynergy[h.id] && game.actors.has(h.id)`
    // in `_buildSynergyHelpers` at module/dice/tb2e-roll.mjs L1549-1560,
    // emitted by templates/chat/roll-result.hbs L141-151. Clicking the
    // button dispatches `data-action="synergy"` to `_handleSynergy` in
    // module/dice/post-roll.mjs L376-402 — if the current user is GM, it
    // runs `_processSynergy` directly (deducts 1 fate, logs advancement,
    // marks `flags.tb2e.helperSynergy.<id> = true`); otherwise the helper's
    // owning player writes `flags.tb2e.pendingSynergy = { messageId }` on
    // the helper actor, and the GM hook at tb2e.mjs L187-188 picks it up
    // via `processSynergyMailbox` (post-roll.mjs L466-471).
    this.synergySection = this.root.locator('.roll-card-helpers');
  }

  /**
   * Locator for the post-roll synergy button for a specific helper actor id.
   * The block is rendered iff at least one helper has `synergy: true` on
   * the message's `flags.tb2e.helpers` and hasn't yet been processed (see
   * `_buildSynergyHelpers` at module/dice/tb2e-roll.mjs L1549-1560). After a
   * successful synergy invocation the button disappears via
   * `_reRenderChatCard` (module/dice/post-roll.mjs L857-906) because the
   * processed helper is filtered out at L1551.
   * @param {string} helperId  Actor id of the helper
   */
  synergyButton(helperId) {
    return this.root.locator(
      `.roll-card-helpers button[data-action="synergy"][data-helper-id="${helperId}"]`
    );
  }

  /**
   * Click the post-roll "Synergy" button for a specific helper. Uses the
   * same native-click pattern as `clickFinalize` / `clickFateLuck` — the
   * handler is wired via `addEventListener` in `activatePostRollListeners`
   * (module/dice/post-roll.mjs L15-57) so `button.click()` triggers the
   * production code path without Playwright viewport math.
   *
   * After dispatch, wait for `_processSynergy` (GM path) or
   * `processSynergyMailbox` (player path) to mark the helper as processed
   * (`flags.tb2e.helperSynergy.<id> = true` at module/dice/post-roll.mjs
   * L445) and re-render the card — the button disappears on re-render
   * because `_buildSynergyHelpers` filters processed helpers at
   * tb2e-roll.mjs L1551.
   * @param {string} helperId
   */
  async clickSynergy(helperId) {
    const btn = this.synergyButton(helperId);
    await expect(btn).toBeVisible();
    await btn.evaluate((el) => el.click());
    await expect(btn).toHaveCount(0, { timeout: 10_000 });
  }

  /**
   * Click the "No" (outside descriptors, tax applies) nature-tax button.
   * Same native-click pattern as `clickFateLuck` / `clickOfCourse` — the
   * production handler is wired via plain `addEventListener` in
   * `activatePostRollListeners`, so `button.click()` dispatches the handler
   * without Playwright viewport math. After dispatch, wait for
   * `_handleNatureTax` to flip `natureTaxResolved: true` (post-roll.mjs line
   * 360) which removes the prompt from the re-rendered card template
   * (roll-result.hbs `{{#if showNatureTax}}` at line 118, gated by
   * `channelNature && !natureTaxResolved` in buildChatTemplateData).
   */
  async clickNatureTaxNo() {
    await expect(this.natureTaxNoButton).toBeVisible();
    await this.natureTaxNoButton.evaluate(btn => btn.click());
    await expect(this.natureTaxNoButton).toHaveCount(0, { timeout: 10_000 });
  }

  /**
   * Click the "Yes" (within descriptors — no tax) nature-tax button.
   * See `clickNatureTaxNo` for the native-click rationale.
   */
  async clickNatureTaxYes() {
    await expect(this.natureTaxYesButton).toBeVisible();
    await this.natureTaxYesButton.evaluate(btn => btn.click());
    await expect(this.natureTaxYesButton).toHaveCount(0, { timeout: 10_000 });
  }

  /**
   * Click the "Deeper Understanding" (Fate 1) post-roll wise-aid button.
   * Uses the same native-click pattern as `clickFateLuck` / `clickOfCourse`
   * — the button's click handler is attached via a plain `addEventListener`
   * in `activatePostRollListeners`, so dispatching `button.click()` triggers
   * the production handler without Playwright viewport math.
   *
   * After dispatch, wait for `_handleDeeperUnderstanding` to flip
   * `deeperUsed: true` (post-roll.mjs line 234) which removes the button
   * from the re-rendered card template (roll-result.hbs `{{#unless
   * deeperUsed}}` at line 90).
   */
  async clickDeeperUnderstanding() {
    await expect(this.deeperUnderstandingButton).toBeVisible();
    await this.deeperUnderstandingButton.evaluate(btn => btn.click());
    await expect(this.deeperUnderstandingButton).toHaveCount(0, { timeout: 10_000 });
  }

  /**
   * Click the "Fate: Luck" post-roll button. Uses the same native-click
   * pattern as `clickFinalize` / `clickOfCourse` — the chat-log's inner
   * overflow scroller confuses Playwright's viewport math, but the handler
   * is a plain `addEventListener("click", ...)` so dispatching a synthetic
   * click event on the button node triggers the production code path.
   *
   * After dispatch, wait for `_handleFateLuck` to flip `luckUsed: true`
   * (post-roll.mjs line 161) which removes the button from the re-rendered
   * card template (roll-result.hbs `{{#unless luckUsed}}` at line 110).
   */
  async clickFateLuck() {
    await expect(this.fateLuckButton).toBeVisible();
    await this.fateLuckButton.evaluate(btn => btn.click());
    await expect(this.fateLuckButton).toHaveCount(0, { timeout: 10_000 });
  }

  /**
   * Click the "Ah, Of Course!" (Persona 1) post-roll button. Uses the same
   * native-click pattern as `clickFinalize` (the button's click handler is
   * attached via a plain `addEventListener` in `activatePostRollListeners`,
   * so `button.click()` dispatches the production handler without Playwright
   * viewport math). Waits for the subsequent re-render to tag the button
   * with the "used" state — after `_handleOfCourse`, the template sets
   * `ofCourseUsed: true` (post-roll.mjs line 308) which hides the button on
   * re-render (`{{#unless ofCourseUsed}}` guard in roll-result.hbs line 100).
   */
  async clickOfCourse() {
    await expect(this.ofCourseButton).toBeVisible();
    await this.ofCourseButton.evaluate(btn => btn.click());
    await expect(this.ofCourseButton).toHaveCount(0, { timeout: 10_000 });
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
