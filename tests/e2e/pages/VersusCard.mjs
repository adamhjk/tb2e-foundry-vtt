import { expect } from '@playwright/test';

/**
 * Page objects for the TB2E versus chat cards (§5 Versus Tests).
 *
 * Versus lifecycle (module/dice/versus.mjs + module/dice/tb2e-roll.mjs
 * `_handleVersusRoll`):
 *
 *   1. Initiator opens a roll dialog, clicks the `.roll-dialog-mode-toggle`
 *      badge to cycle the mode input from "independent" → "versus", and
 *      submits.  `_handleVersusRoll` posts a ChatMessage rendered from
 *      templates/chat/roll-result.hbs with `isVersus: true`; the message
 *      carries `flags.tb2e.versus = { type: "initiator", ...}` and is
 *      registered in `PendingVersusRegistry`. The banner renders as
 *      `.card-banner.banner-pending` ("Pending").
 *   2. Initiator clicks the card's Finalize button (`data-action="finalize"`
 *      in the shared roll-result.hbs post-action block). This is NOT the
 *      normal log-advancement finalize: `_handleFinalize` in post-roll.mjs
 *      (line 506-522) special-cases `tbFlags.versus` and (for GM) directly
 *      calls `processVersusFinalize` — skipping the advancement pipeline.
 *      The card re-renders with `.card-banner.banner-resolved` ("Resolved").
 *   3. Opponent opens their own roll dialog, toggles mode to versus, and
 *      selects the initiator's message id from the `select[name="challengeMessageId"]`
 *      inside `.roll-dialog-challenge`. The dropdown is kept live-populated
 *      by a `createChatMessage` hook in _showRollDialog (tb2e-roll.mjs
 *      line 1032-1045) — so any pending initiator message shows up without
 *      re-opening the dialog.
 *   4. Opponent submits. `_handleVersusRoll` posts an opponent ChatMessage
 *      with `flags.tb2e.versus.type === "opponent"` + `initiatorMessageId`
 *      linking back to the pending one.
 *   5. On `createChatMessage`, the GM-only hook in tb2e.mjs calls
 *      `resolveVersus(message)` (versus.mjs line 74) which sets
 *      `initiator.versus.opponentMessageId` — preparing for execution.
 *   6. Opponent clicks Finalize on their own card. _handleFinalize runs
 *      `processVersusFinalize` which, once both sides are `resolved:true`,
 *      calls `_executeVersusResolution`: a third ChatMessage is posted
 *      rendered from templates/chat/versus-resolution.hbs, tagged
 *      `flags.tb2e.versus.type === "resolution"`, carrying the winnerId.
 *
 * This file exposes two POMs:
 *   - `VersusPendingCard`: scopes a tb2e-chat-card by its `flags.tb2e.versus.type`
 *     === "initiator" | "opponent" via a data-message-id attribute the
 *     production template does not emit — we locate by content features
 *     (card header name + banner class) and delegate actor-scoping to the
 *     call sites that already know the actor id.
 *   - `VersusResolutionCard`: scopes a tb2e-chat-card rendered from
 *     versus-resolution.hbs; exposes winner / successes per side / margin.
 *
 * Actor-scoping: both POMs take an `actorId` so that `--repeat-each=N`
 * runs don't cross-contaminate when stale versus cards from earlier
 * iterations linger in the chat log. Rather than CSS-match flag state on
 * the DOM (flags aren't serialized into attributes), we filter in
 * `page.evaluate` to find the matching message id, then `.nth()` the
 * on-screen card.
 */

/**
 * POM for a versus-pending or versus-opponent roll-result card (the
 * initiator's or opponent's individual roll card before resolution).
 * This is just a roll-result.hbs card with `isVersus: true` — we
 * delegate the common surface to a plain locator and add the versus-
 * specific Finalize behavior.
 */
export class VersusPendingCard {
  /**
   * @param {import('@playwright/test').Page} page
   * @param {string} messageId Foundry ChatMessage id of the pending card
   */
  constructor(page, messageId) {
    this.page = page;
    this.messageId = messageId;
    // Foundry V13 emits each chat message as `<li class="chat-message"
    // data-message-id="<id>">`. The SAME message renders in up to three
    // places concurrently:
    //   - the sidebar chat log (`#chat ol.chat-log`)
    //   - the floating notifications stack (`#chat-notifications`)
    //   - any popped-out chat log window
    // Each copy has the same `data-message-id`, so a bare message-id
    // selector yields 2+ elements in strict mode. We pin to the FIRST
    // rendered copy — Foundry renders the notifications pane first when
    // it's the only layout, and the sidebar copy gets the same mutations
    // (it's the same message), so `.first()` is stable regardless of
    // sidebar visibility state. Buttons wired by
    // `activatePostRollListeners` attach to each re-render; clicking
    // either copy reaches the same handler.
    this.root = page
      .locator(`li.chat-message[data-message-id="${messageId}"] .tb2e-chat-card`)
      .first();
    this.pendingBanner = this.root.locator('.card-banner.banner-pending');
    this.resolvedBanner = this.root.locator('.card-banner.banner-resolved');
    // Post-action buttons (shared with independent roll-result.hbs).
    this.finalizeButton = this.root.locator(
      '.card-actions button[data-action="finalize"]'
    );
  }

  async expectPresent() {
    await expect(this.root).toBeVisible();
  }

  async expectPending() {
    await expect(this.pendingBanner).toBeVisible();
  }

  /**
   * Click the green Finalize button. Same native-click pattern as
   * `RollChatCard.clickFinalize` — Foundry's chat-log scroll container
   * confuses Playwright's viewport math but the production handler is a
   * plain `addEventListener("click", ...)` wired in
   * `activatePostRollListeners` (module/dice/post-roll.mjs). After
   * dispatch, `_handleFinalize` takes the versus branch (line 506-522):
   * sets `flags.tb2e.resolved: true`, re-renders the card without the
   * action bar, and (for the GM path used by the E2E harness) directly
   * calls `processVersusFinalize` which may post a resolution card if
   * both sides are now resolved.
   */
  async clickFinalize() {
    await expect(this.finalizeButton).toBeVisible();
    await this.finalizeButton.evaluate(btn => btn.click());
    // Wait for the post-finalize re-render to strip the action bar.
    await expect(this.finalizeButton).toHaveCount(0, { timeout: 10_000 });
  }
}

/**
 * POM for a versus-resolution card posted by `_executeVersusResolution`
 * (module/dice/versus.mjs line 184-222). The card content template is
 * templates/chat/versus-resolution.hbs — it shows both combatants, their
 * successes, and a `banner-pass` block naming the winner.
 *
 * Selector map (versus-resolution.hbs):
 *   - `.versus-combatants`             combatants wrapper
 *   - `.versus-combatant`              per-side block (initiator first, then opponent)
 *   - `.versus-combatant.versus-winner` winning side gets an extra class
 *   - `.versus-name`                   actor display name
 *   - `.versus-successes`              "N Successes" string per side
 *   - `.versus-divider`                "VS" divider between the two
 *   - `.card-banner.banner-pass`       winner banner with `.versus-winner-name`
 *   - `.maneuver-spend-prompt-card`    only renders on conflict maneuver wins
 *
 * The template does NOT render a margin value — margin = |iSuccesses - oSuccesses|
 * has to be computed from the two `.versus-successes` texts (or read from
 * the `flags.tb2e.maneuverSpend.margin` flag when the winner was a
 * maneuver in a conflict, which is not the scope of this POM's users).
 */
export class VersusResolutionCard {
  /**
   * @param {import('@playwright/test').Page} page
   * @param {string} messageId ChatMessage id of the resolution card
   */
  constructor(page, messageId) {
    this.page = page;
    this.messageId = messageId;
    // See VersusPendingCard constructor for the `.first()` rationale — the
    // same message renders in both the sidebar chat log and the floating
    // notifications stack.
    this.root = page
      .locator(`li.chat-message[data-message-id="${messageId}"] .tb2e-chat-card`)
      .first();
    this.combatants = this.root.locator('.versus-combatants .versus-combatant');
    this.initiator = this.combatants.nth(0);
    this.opponent = this.combatants.nth(1);
    this.winnerBanner = this.root.locator('.card-banner.banner-pass');
    this.winnerName = this.winnerBanner.locator('.versus-winner-name');
  }

  async expectPresent() {
    await expect(this.root).toBeVisible();
    await expect(this.combatants).toHaveCount(2);
  }

  /**
   * Return the winner actor's display name from the banner.
   *
   * `.versus-winner-name` in the resolution card's banner-pass block carries
   * a CSS `text-transform: uppercase` (via the themed banner styles in
   * less/chat/versus-card.less). Playwright's `innerText` honors CSS
   * transforms, so a lowercase-named actor ("E2E Versus B") would read back
   * as "E2E VERSUS B". We pull the raw DOM text via `textContent` so the
   * assertion matches the actor's actual `name` field regardless of the
   * theme's casing style.
   */
  async getWinnerName() {
    const raw = await this.winnerName.evaluate(el => el.textContent ?? '');
    return raw.trim();
  }

  /** True if the initiator (first combatant block) is marked as winner. */
  async initiatorIsWinner() {
    const classAttr = (await this.initiator.getAttribute('class')) ?? '';
    return classAttr.split(/\s+/).includes('versus-winner');
  }

  /** Parse the numeric successes count from a combatant's `.versus-successes` line. */
  async getInitiatorSuccesses() {
    return this.#parseSuccesses(this.initiator);
  }

  async getOpponentSuccesses() {
    return this.#parseSuccesses(this.opponent);
  }

  /**
   * Compute the margin = |initiatorSuccesses - opponentSuccesses|. Matches
   * versus.mjs line 170 (`const margin = Math.abs(iSuccesses - oSuccesses)`).
   */
  async getMargin() {
    const i = await this.getInitiatorSuccesses();
    const o = await this.getOpponentSuccesses();
    return Math.abs(i - o);
  }

  async #parseSuccesses(scope) {
    const txt = (await scope.locator('.versus-successes').innerText()).trim();
    // Template emits "{{initiatorSuccesses}} {{successesLabel}}" — leading
    // integer is the successes count; label text is i18n-dependent so we
    // pull the integer.
    const match = txt.match(/^\s*(\d+)/);
    if (!match) throw new Error(`VersusResolutionCard: cannot parse successes from "${txt}"`);
    return Number(match[1]);
  }
}

/**
 * POM for a versus-tied chat card posted by `_handleVersusTied`
 * (module/dice/versus.mjs line 309-394). Rendered from
 * templates/chat/versus-tied.hbs — it shows both combatants, their
 * (equal) successes, a `banner-amber` "Tied" banner, and per-side
 * trait-spend buttons.
 *
 * Selector map (versus-tied.hbs):
 *   - `.versus-combatants .versus-combatant`  per-side block
 *   - `.card-banner.banner-amber`             "Tied" banner
 *   - `.tied-actions`                         container for tie-break buttons
 *   - `[data-action="level3-break-tie"]`      L3 "win the tie" buttons (blue)
 *                                              (see versus-tied.hbs line 37-40,
 *                                               55-58)
 *   - `[data-action="trait-break-tie"]`       "concede / earn 2 checks" buttons
 *                                              (amber; line 77-79, 91-93)
 *   - `[data-actor-id]`                       buttons carry their actor id so
 *                                              we can filter per-side
 *
 * Buttons are wired in tb2e.mjs line 167-180 (renderChatMessageHTML hook) —
 * native click handlers calling `handleLevel3TraitBreakTie` /
 * `handleTraitBreakTie` from versus.mjs.
 */
export class VersusTiedCard {
  /**
   * @param {import('@playwright/test').Page} page
   * @param {string} messageId ChatMessage id of the tied card
   */
  constructor(page, messageId) {
    this.page = page;
    this.messageId = messageId;
    // Same `.first()` rationale as VersusPendingCard — the message renders
    // in both the chat log and the floating `#chat-notifications` stack;
    // button handlers attach to each re-render so clicking either reaches
    // the same handleTraitBreakTie / handleLevel3TraitBreakTie path.
    this.root = page
      .locator(`li.chat-message[data-message-id="${messageId}"] .tb2e-chat-card`)
      .first();
    this.tiedBanner = this.root.locator('.card-banner.banner-amber');
    this.actions = this.root.locator('.tied-actions');
  }

  async expectPresent() {
    await expect(this.root).toBeVisible();
    await expect(this.tiedBanner).toBeVisible();
  }

  /**
   * Locator for a specific actor's L3 tie-break button. Buttons are emitted
   * one-per-L3-trait in versus-tied.hbs line 37-40 / 55-58 with
   * `data-action="level3-break-tie"` + `data-actor-id` + `data-trait-id`.
   * @param {string} actorId
   * @param {string} traitId
   */
  level3BreakTieButton(actorId, traitId) {
    return this.root.locator(
      `button[data-action="level3-break-tie"][data-actor-id="${actorId}"][data-trait-id="${traitId}"]`
    );
  }

  /**
   * Count of L3 "win the tie" buttons currently rendered for an actor.
   * Used to assert the absent case (B has no L3 trait → 0 buttons).
   */
  level3BreakTieButtonsFor(actorId) {
    return this.root.locator(
      `button[data-action="level3-break-tie"][data-actor-id="${actorId}"]`
    );
  }

  /**
   * Click an actor's L3 "Win the tie" button by trait id. Uses the native-
   * click evaluate pattern from VersusPendingCard.clickFinalize — the
   * chat-log scroll container confuses Playwright's viewport math but the
   * production handler is a plain `addEventListener("click", ...)` wired
   * in tb2e.mjs line 174-180. After dispatch, `handleLevel3TraitBreakTie`
   * (versus.mjs line 485-518) sets `flags.tb2e.tiedResolved: true` on this
   * card and posts a new resolution card naming the acting actor as winner.
   * @param {string} actorId
   * @param {string} traitId
   */
  async clickLevel3BreakTie(actorId, traitId) {
    const btn = this.level3BreakTieButton(actorId, traitId);
    await expect(btn).toBeVisible();
    await btn.evaluate(el => el.click());
  }
}

/**
 * Utility locator for the roll dialog's "mode" toggle badge + challenge
 * dropdown. Not a full POM — just the selectors a versus spec needs in
 * addition to the generic RollDialog surface.
 *
 * Source: templates/dice/roll-dialog.hbs lines 3-7 render the mode toggle
 * as `<button class="roll-dialog-badge roll-dialog-mode-toggle">` with a
 * sibling `<input type="hidden" name="mode">`. Clicking the button cycles
 * mode values: "independent" → "versus" → "disposition" → "independent".
 * See tb2e-roll.mjs lines 964-1005 for the handler.
 *
 * The `.roll-dialog-challenge` block (line 52-60) is hidden by default
 * (`hidden` class); clicking the toggle once reveals it. It contains
 * `select[name="challengeMessageId"]` populated with all open initiator
 * messages for actors other than the current one.
 */
export const VersusDialogExtras = {
  /** Root scope query to match the RollDialog POM's `.root` locator. */
  scopeOf(dialog) {
    return {
      /** The mode-toggle badge button (cycles independent→versus→disposition). */
      modeToggle: dialog.root.locator('button.roll-dialog-mode-toggle'),
      /** Hidden input carrying the current mode string. */
      modeInput: dialog.root.locator('input[name="mode"]'),
      /** Versus challenge wrapper (hidden unless mode === "versus"). */
      challengeBlock: dialog.root.locator('.roll-dialog-challenge'),
      /** Challenge select — options live-populated by `createChatMessage` hook. */
      challengeSelect: dialog.root.locator('select[name="challengeMessageId"]')
    };
  },

  /**
   * Cycle the roll dialog's mode from "independent" (the default) into
   * "versus" by clicking the mode toggle once. Asserts the mode input
   * ends at "versus" and the challenge block is un-hidden.
   * @param {import('./RollDialog.mjs').RollDialog} dialog
   */
  async switchToVersus(dialog) {
    const extras = VersusDialogExtras.scopeOf(dialog);
    await expect(extras.modeInput).toHaveValue('independent');
    await extras.modeToggle.click();
    await expect(extras.modeInput).toHaveValue('versus');
    // The `.roll-dialog-challenge` block is toggled by removing/adding
    // the `hidden` class in the mode handler (tb2e-roll.mjs line 988).
    // `toBeVisible` would require the element's computed layout; assert
    // the class absence directly for resilience against DialogV2 layout
    // quirks.
    await expect(extras.challengeBlock).not.toHaveClass(/(^|\s)hidden(\s|$)/);
  },

  /**
   * Select a specific initiator message as the challenge this dialog is
   * responding to. The option's `value` is the ChatMessage id; options are
   * appended by the `createChatMessage` hook in _showRollDialog
   * (tb2e-roll.mjs lines 1032-1045) whenever a new initiator message
   * arrives with `versus.type === "initiator"` and `initiatorActorId !==
   * self`. Asserts the option exists before selecting.
   * @param {import('./RollDialog.mjs').RollDialog} dialog
   * @param {string} messageId Foundry ChatMessage id of the pending initiator
   */
  async selectChallenge(dialog, messageId) {
    const extras = VersusDialogExtras.scopeOf(dialog);
    await expect(extras.challengeSelect).toHaveCount(1);
    await expect(
      extras.challengeSelect.locator(`option[value="${messageId}"]`)
    ).toHaveCount(1);
    await extras.challengeSelect.selectOption(messageId);
    await expect(extras.challengeSelect).toHaveValue(messageId);
  }
};
