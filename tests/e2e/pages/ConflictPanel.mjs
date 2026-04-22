import { expect } from '@playwright/test';

/**
 * Page object for the Conflict Panel (the 7-tab "playbook" wizard).
 *
 * Source: `module/applications/conflict/conflict-panel.mjs` — a
 * `HandlebarsApplicationMixin(ApplicationV2)` singleton accessed via
 * `ConflictPanel.getInstance()` / `game.tb2e.conflictPanel`. Rendered from
 * `templates/conflict/panel.hbs` with per-tab partials under
 * `templates/conflict/panel-{setup,disposition,weapons,script,resolve,resolution,roster}.hbs`.
 *
 * `DEFAULT_OPTIONS.id = "conflict-panel"` → outer window element is
 * `<div id="conflict-panel" class="application ... conflict-panel">`.
 *
 * The tab strip is rendered at `panel.hbs` L40-54 as `<nav class="panel-tabs">`
 * with one `<button class="panel-tab {{state}} {{isActive?active}}"
 * data-action="switchTab" data-tab="{{id}}">` per tab. Tab ids in order:
 *   setup, disposition, weapons, script, resolve, resolution
 * (see conflict-panel.mjs L510-517).
 *
 * This POM is sized for §12–§20 reuse: the active-tab assertion and
 * tab-click helper are usable for every conflict spec, and the `setup*`
 * helpers cover the §12 checkboxes.
 */
export class ConflictPanel {
  constructor(page) {
    this.page = page;
    this.root = page.locator('#conflict-panel');
    this.tabs = this.root.locator('nav.panel-tabs');
    this.setupContent = this.root.locator('.panel-tab-content.setup-tab');
    this.conflictTypeSelect = this.root.locator('select.conflict-type-select');
    this.conflictNameInput = this.root.locator('input.conflict-name-input');
    // Setup tab — group roster + per-group add-combatant select.
    // DOM contract: panel-setup.hbs L83-136 emits one `<div class="setup-group"
    // data-group-id="{{id}}">` per group with `<ul class="setup-combatant-list">`
    // → `<li class="setup-combatant" data-combatant-id="...">`.
    this.setupGroups = this.setupContent.locator('.setup-group');
    this.setupCombatants = this.setupContent.locator('li.setup-combatant');
    // Manual-config block — only rendered when `system.conflictType === "manual"`
    // AND the viewer is GM (panel-setup.hbs L38-80, conflict-panel.mjs L663-707).
    this.setupManualConfig = this.setupContent.locator('.setup-manual-config');
    this.manualActionRows = this.setupManualConfig.locator('.manual-action-row');
    // Setup-tab "Next → begin disposition" button (panel-setup.hbs L140,
    // gated by `canBeginDisposition` at conflict-panel.mjs L709-710).
    this.beginDispositionButton = this.setupContent.locator(
      'button.setup-next-btn[data-action="beginDisposition"]'
    );
    // Disposition-tab scope — one `.disp-group[data-group-id]` per
    // CombatantGroup (panel-disposition.hbs L5). Contains the roll button,
    // distribution form, and post-distribution readout.
    this.dispositionContent = this.root.locator(
      '.panel-tab-content.disposition-tab'
    );
  }

  /**
   * Render the singleton panel via its public API. Matches the flow the
   * tracker's "Open Playbook" button uses (conflict-tracker.mjs L322-324).
   */
  async open() {
    await this.page.evaluate(async () => {
      const mod = await import('/systems/tb2e/module/applications/conflict/conflict-panel.mjs');
      const panel = mod.default.getInstance();
      return panel.render({ force: true });
    });
    await expect(this.root).toBeVisible();
  }

  /** Close the panel (also unhooks updateCombat / updateCombatant listeners). */
  async close() {
    await this.page.evaluate(() => game.tb2e.conflictPanel?.close());
    await expect(this.root).toHaveCount(0);
  }

  /** The tab button for a given tab id (setup|disposition|weapons|script|resolve|resolution). */
  tab(tabId) {
    return this.tabs.locator(`button.panel-tab[data-tab="${tabId}"]`);
  }

  /** Click a tab button and wait for the switch to take effect. */
  async switchTab(tabId) {
    await this.tab(tabId).click();
    await expect(this.tab(tabId)).toHaveClass(/\bactive\b/);
  }

  /**
   * Locator for a specific setup-tab group by CombatantGroup id.
   * @param {string} groupId
   */
  setupGroup(groupId) {
    return this.setupContent.locator(`.setup-group[data-group-id="${groupId}"]`);
  }

  /**
   * Locator for the combatant list items inside a given setup-tab group.
   * @param {string} groupId
   */
  setupGroupCombatants(groupId) {
    return this.setupGroup(groupId).locator('li.setup-combatant');
  }

  /**
   * Programmatic combatant-add helper that mirrors the panel's own
   * `#onDropActor` path (conflict-panel.mjs L2189-2197) — we use the same
   * `combat.createEmbeddedDocuments("Combatant", …)` call the UI makes, with
   * the same `{ type: "conflict", actorId, name, img, group }` payload.
   *
   * Chosen over native HTML5 drag-and-drop because the setup select dropdown
   * (add-combatant-select) is filtered to `character`/`npc` actors present
   * on the current scene (conflict-panel.mjs L657-660) — monsters can only
   * be added via drop — and DnD is flaky in Playwright.
   */
  async addCombatant({ combatId, actorId, groupId }) {
    return this.page.evaluate(async ({ cId, aId, gId }) => {
      const combat = game.combats.get(cId);
      const actor = game.actors.get(aId);
      if ( !combat || !actor ) throw new Error('addCombatant: missing combat or actor');
      const [created] = await combat.createEmbeddedDocuments('Combatant', [{
        actorId: actor.id,
        name: actor.name,
        img: actor.img,
        group: gId,
        type: 'conflict'
      }]);
      // The panel subscribes to updateCombat/updateCombatant/updateActor
      // (conflict-panel.mjs L120-129) but *not* createCombatant, so a bare
      // create doesn't trigger a re-render. Force one so the DOM reflects
      // the new roster. (In the real UI, users typically add combatants
      // before the panel opens, or the select dropdown's own flow runs,
      // so this hasn't been a production issue.)
      const panel = game.tb2e?.conflictPanel;
      if ( panel?.rendered ) await panel.render();
      return created?.id ?? null;
    }, { cId: combatId, aId: actorId, gId: groupId });
  }

  /**
   * Read the currently active tab id. ApplicationV2 exposes the underlying
   * instance on the singleton; its private #activeTab is reflected by the
   * `.active` class on the tab button in the DOM.
   */
  async activeTabId() {
    return this.root
      .locator('nav.panel-tabs button.panel-tab.active')
      .getAttribute('data-tab');
  }

  /**
   * Captain button for a given combatant (GM-only affordance, emitted by
   * `panel-setup.hbs` L92-96 with `data-action="setCaptain"`
   * `data-combatant-id`). Clicking it dispatches to
   * `ConflictPanel.#onSetCaptain` (conflict-panel.mjs L1479-1486) which
   * calls `TB2ECombat.setCaptain(groupId, combatantId)` (combat.mjs
   * L101-106), persisting the id at
   * `combat.system.groupDispositions[groupId].captainId`.
   *
   * @param {string} combatantId
   */
  captainButton(combatantId) {
    return this.setupContent.locator(
      `button.setup-captain-btn[data-combatant-id="${combatantId}"]`
    );
  }

  /**
   * Combatant row `<li>` for a given id. Used to assert the `.is-captain`
   * class added by `panel-setup.hbs` L88 when the combatant is the captain.
   * @param {string} combatantId
   */
  setupCombatantRow(combatantId) {
    return this.setupContent.locator(
      `li.setup-combatant[data-combatant-id="${combatantId}"]`
    );
  }

  /**
   * Click the captain button for a combatant and wait for the re-render to
   * reflect the new captain. The panel hooks updateCombat (conflict-panel.mjs
   * L120-129) so the server-side update drives a re-render of the setup tab.
   * @param {string} combatantId
   */
  async clickCaptainButton(combatantId) {
    await this.captainButton(combatantId).click();
    await expect(this.setupCombatantRow(combatantId)).toHaveClass(/\bis-captain\b/);
  }

  /**
   * Boss button for a given combatant. Emitted by `panel-setup.hbs` L97-103
   * as `<button class="setup-boss-btn" data-action="setBoss"
   * data-combatant-id>`, *only* on rows whose combatant resolves to a
   * `monster` actor (the `{{#if this.isMonster}}` guard at L97; the
   * `isMonster` flag is derived at conflict-panel.mjs L648 from
   * `actor.type === "monster"`). Clicking dispatches to
   * `ConflictPanel.#onSetBoss` (conflict-panel.mjs L1494-1501) which toggles
   * `combatant.system.isBoss` via a direct `combatant.update` (no per-group
   * mailbox — boss is a per-combatant bit on `CombatantData` at
   * data/combat/combatant.mjs L8). The button gets an `.active` class when
   * `isBoss` is true (panel-setup.hbs L98).
   *
   * @param {string} combatantId
   */
  bossButton(combatantId) {
    return this.setupContent.locator(
      `button.setup-boss-btn[data-combatant-id="${combatantId}"]`
    );
  }

  /**
   * Click the boss button for a combatant and wait for the re-render to
   * reflect the toggled boss state. Unlike `is-captain` (which tags the
   * whole `<li>`), boss state is only surfaced on the button itself via
   * `.active` — see `panel-setup.hbs` L98. We pass the expected post-click
   * state so the wait can key off the right class transition.
   *
   * @param {string} combatantId
   * @param {object} [opts]
   * @param {boolean} [opts.expectActive=true] — whether the boss button
   *   should end up active after the click (false when toggling off).
   */
  async clickBossButton(combatantId, { expectActive = true } = {}) {
    await this.bossButton(combatantId).click();
    if ( expectActive ) {
      await expect(this.bossButton(combatantId)).toHaveClass(/\bactive\b/);
    } else {
      await expect(this.bossButton(combatantId)).not.toHaveClass(/\bactive\b/);
    }
  }

  /**
   * Read the list of option values available on the conflict-type select.
   * Mirrors panel-setup.hbs L8-12 output which is populated from
   * `context.conflictTypes` (conflict-panel.mjs L585-589 — one entry per
   * key in `CONFIG.TB2E.conflictTypes`).
   */
  async conflictTypeOptionValues() {
    return this.conflictTypeSelect.locator('option').evaluateAll((opts) =>
      opts.map((o) => o.value)
    );
  }

  /**
   * Change the conflict type via the `<select>` element (the user-facing UI
   * path — `change` listener at conflict-panel.mjs L201-207 dispatches to
   * `combat.update({ "system.conflictType": value })`). We use
   * `selectOption` + then wait for `combat.system.conflictType` to reflect
   * the change, since the update + re-render is async and Playwright's own
   * `toHaveValue` assertion would race against the panel re-rendering the
   * whole select element.
   *
   * @param {string} typeKey  One of `CONFIG.TB2E.conflictTypes` keys.
   */
  async selectConflictType(typeKey) {
    await this.conflictTypeSelect.selectOption(typeKey);
    await expect
      .poll(() =>
        this.page.evaluate(() => {
          const c = game.combats.find((x) => x.isConflict);
          return c?.system.conflictType ?? null;
        })
      )
      .toBe(typeKey);
    // Wait for the setup-tab select to re-render with the new selected
    // value (the updateCombat hook at conflict-panel.mjs L120-122 triggers
    // this.render()).
    await expect(this.conflictTypeSelect).toHaveValue(typeKey);
  }

  /**
   * Click "Next → Disposition" in the setup tab. Dispatches to
   * `ConflictPanel.#onBeginDisposition` (conflict-panel.mjs L1543-1574)
   * which calls `combat.beginDisposition()` (combat.mjs L144-174) and
   * advances the active tab to "disposition" (conflict-panel.mjs L1546).
   * Waits for the disposition tab to become active.
   */
  async clickBeginDisposition() {
    await this.beginDispositionButton.click();
    await expect
      .poll(() => this.activeTabId())
      .toBe('disposition');
  }

  /**
   * Locator for a disposition-tab group section by CombatantGroup id.
   * Rendered by panel-disposition.hbs L5 as
   * `<div class="disp-group" data-group-id>`. The group section is the
   * scope for the per-side roll button, the distribution form, and the
   * post-distribution readout — all targeted by helper methods below.
   * @param {string} groupId
   */
  dispositionGroup(groupId) {
    return this.dispositionContent.locator(
      `.disp-group[data-group-id="${groupId}"]`
    );
  }

  /**
   * Roll-disposition button for a given group. Rendered inside
   * `.disp-roll-area` (panel-disposition.hbs L40, L52) when `canRoll` is
   * true (conflict-panel.mjs L838-840). Clicking dispatches to
   * `ConflictPanel.#onRollDisposition` (conflict-panel.mjs L1582-1653)
   * which calls `rollTest({...testContext: { isDisposition: true, …}})`.
   * @param {string} groupId
   */
  rollDispositionButton(groupId) {
    return this.dispositionGroup(groupId).locator(
      'button[data-action="rollDisposition"]'
    );
  }

  /**
   * Locator for the distribution form inside a group. Rendered by
   * panel-disposition.hbs L84 after a roll is stored (`hasRolled` true,
   * `hasDistributed` false). The form contains one `input.dist-value`
   * per team member pre-filled with the suggested split
   * (conflict-panel.mjs L791-820).
   * @param {string} groupId
   */
  distributionSection(groupId) {
    return this.dispositionGroup(groupId).locator('.distribution-section');
  }

  /**
   * "Distribute" submit button inside the distribution form. Clicking
   * dispatches to `ConflictPanel.#onDistribute` (conflict-panel.mjs
   * L1661-1683) which reads each `.dist-value` input and calls
   * `combat.distributeDisposition(groupId, distribution)` (combat.mjs
   * L219-242). That update applies `system.conflict.hp.{value,max}` to
   * each member's actor.
   * @param {string} groupId
   */
  distributeButton(groupId) {
    return this.distributionSection(groupId).locator(
      'button[data-action="distribute"]'
    );
  }

  /**
   * The rendered "Disposition: N" value inside a group section. Rendered
   * by panel-disposition.hbs L79 once `hasRolled` is true.
   * @param {string} groupId
   */
  dispositionRolledValue(groupId) {
    return this.dispositionGroup(groupId).locator('.disp-rolled-value');
  }

  /**
   * The post-distribution "Distributed" badge for a group. Rendered by
   * panel-disposition.hbs L110 once `hasDistributed` is true — surfaces
   * that `distributeDisposition` has run to completion.
   * @param {string} groupId
   */
  dispositionDistributedBadge(groupId) {
    return this.dispositionGroup(groupId).locator('.disp-distributed-badge');
  }

  /**
   * Locator for the GM-only "flat disposition" block inside a group
   * section — rendered by panel-disposition.hbs L60-72 when the viewer is
   * GM AND the group has not yet rolled. Contains `.gm-disposition-input`
   * (prefilled with `suggestedDisposition` on listed monster conflicts,
   * conflict-panel.mjs L751) and a submit button wired to
   * `ConflictPanel.#onSetFlatDisposition` (conflict-panel.mjs L1509-1521),
   * which calls `combat.storeDispositionRoll(groupId, { rolled, … })`
   * directly — no dice, no chat-card finalize step.
   * @param {string} groupId
   */
  flatDispositionSection(groupId) {
    return this.dispositionGroup(groupId).locator('.disp-gm-flat');
  }

  /**
   * Number input inside the flat-disposition block. For monster groups on
   * a listed conflict, panel-disposition.hbs L63 pre-fills `value` with
   * `suggestedDisposition` (= matchingDisp.hp + helpDice per
   * conflict-panel.mjs L751). For unlisted / character groups it is blank
   * and uses `placeholder` instead.
   * @param {string} groupId
   */
  flatDispositionInput(groupId) {
    return this.flatDispositionSection(groupId).locator('.gm-disposition-input');
  }

  /**
   * Confirm button inside the flat-disposition block. Clicking dispatches
   * to `ConflictPanel.#onSetFlatDisposition` (conflict-panel.mjs
   * L1509-1521), which reads the sibling input's value and calls
   * `combat.storeDispositionRoll(groupId, { rolled: value, diceResults: [],
   * cardHtml: "<em>GM set disposition to N</em>" })` (combat.mjs
   * L201-210) — unlike the roll path, there is no chat-card finalize step,
   * so `rolled` is stamped immediately.
   * @param {string} groupId
   */
  setFlatDispositionButton(groupId) {
    return this.flatDispositionSection(groupId).locator(
      'button[data-action="setFlatDisposition"]'
    );
  }

  /**
   * Hint span rendered on monster groups (panel-disposition.hbs L70)
   * showing the predetermined disposition (+ optional group-help math).
   * Text is built from conflict-panel.mjs L752-760.
   * @param {string} groupId
   */
  monsterDispositionHint(groupId) {
    return this.flatDispositionSection(groupId).locator('.disp-monster-hint');
  }
}
