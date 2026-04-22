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

  /* -------------------------------------------- */
  /*  Weapons tab                                  */
  /* -------------------------------------------- */

  /**
   * "Next → Weapons" button at the bottom of the disposition tab
   * (panel-disposition.hbs L166-170, gated by `allDistributed`).
   * Dispatches to `ConflictPanel.#onBeginWeapons` (conflict-panel.mjs
   * L1691-1697), which calls `combat.beginWeapons()` (combat.mjs
   * L249-255) and flips `system.phase = "weapons"`. The phase-to-tab
   * sync at conflict-panel.mjs L490-499 advances the active tab
   * accordingly on the next render.
   */
  get beginWeaponsButton() {
    return this.dispositionContent.locator(
      'button.setup-next-btn[data-action="beginWeapons"]'
    );
  }

  /** Click "Next → Weapons" and wait for the weapons tab to become active. */
  async clickBeginWeapons() {
    await this.beginWeaponsButton.click();
    await expect.poll(() => this.activeTabId()).toBe('weapons');
  }

  /**
   * Locator for the weapons-tab content region. Rendered by
   * `panel-weapons.hbs` as `<div class="panel-tab-content weapons-tab">`
   * (L2). Contains one `.weapon-group[data-group-id]` per CombatantGroup,
   * each holding a `<ul class="weapon-list">` of per-combatant rows.
   */
  get weaponsContent() {
    return this.root.locator('.panel-tab-content.weapons-tab');
  }

  /**
   * Per-group container on the weapons tab (panel-weapons.hbs L5).
   * @param {string} groupId
   */
  weaponGroup(groupId) {
    return this.weaponsContent.locator(
      `.weapon-group[data-group-id="${groupId}"]`
    );
  }

  /**
   * Per-combatant weapon-select dropdown (panel-weapons.hbs L16).
   * Each option's `value` is a weapon id or sentinel
   * (`__unarmed__`, `__improvised__`, `__monster_{N}__`, item id, or
   * spell/invocation id — conflict-panel.mjs L933-970). A `change` event
   * on this select dispatches through the `_onRender` handler at
   * `conflict-panel.mjs L146-167` which calls
   * `combat.setWeapon(combatantId, name, weaponId)` (combat.mjs
   * L268-274), persisting both `system.weapon` / `system.weaponId` on
   * the combatant AND mirroring `system.conflict.weapon` /
   * `system.conflict.weaponId` onto the actor.
   *
   * @param {string} combatantId
   */
  weaponSelect(combatantId) {
    return this.weaponsContent.locator(
      `select.weapon-select[data-combatant-id="${combatantId}"]`
    );
  }

  /**
   * Options available inside a combatant's weapon dropdown, in rendered
   * order. Each entry returns the raw `value` attribute — i.e. the
   * weapon id / sentinel — which is what gets written to
   * `combatant.system.weaponId` (conflict-panel.mjs L158, L164).
   * @param {string} combatantId
   */
  async weaponOptionValues(combatantId) {
    return this.weaponSelect(combatantId)
      .locator('option')
      .evaluateAll((opts) => opts.map((o) => o.value));
  }

  /**
   * Select a weapon for a combatant by its dropdown value (weapon id or
   * sentinel — see `weaponSelect` jsdoc). Triggers the `change` event
   * that fires `combat.setWeapon`, then waits for the combatant's
   * `system.weaponId` to reflect the selection. The change listener at
   * `conflict-panel.mjs` L146-167 invokes `combat.setWeapon` without
   * awaiting it; `combat.setWeapon` itself awaits the combatant.update
   * BEFORE the actor.update mirror (combat.mjs L268-274), so polling on
   * the combatant field is sufficient to know the combatant write
   * landed. The actor mirror is only present on actor types whose data
   * model declares `system.conflict.{weapon,weaponId}` (characters do —
   * `character.mjs` L161-168; monsters don't — `monster.mjs` L46-52),
   * so its presence/absence is verified at the call-site, not here.
   *
   * @param {string} combatantId
   * @param {string} weaponId  — e.g. "__unarmed__", "__monster_0__",
   *   or an item id returned by `actor.createEmbeddedDocuments`.
   */
  async selectWeapon(combatantId, weaponId) {
    await this.weaponSelect(combatantId).selectOption(weaponId);
    await expect
      .poll(() =>
        this.page.evaluate((id) => {
          for ( const c of game.combats ) {
            const co = c.combatants.get(id);
            if ( co ) return co.system.weaponId ?? null;
          }
          return null;
        }, combatantId)
      )
      .toBe(weaponId);
  }

  /**
   * Per-combatant weapon row (panel-weapons.hbs L9). Scoped locator
   * used to find sibling affordances (improvised input, assignment
   * select, unarmed badge, display span) for a specific combatant.
   * @param {string} combatantId
   */
  weaponRow(combatantId) {
    return this.weaponsContent.locator(
      `li.weapon-row:has(select.weapon-select[data-combatant-id="${combatantId}"])`
    );
  }

  /**
   * Improvised-weapon name input (panel-weapons.hbs L24-29). Only
   * rendered when the parent conflict is `usesGear` (Kill, Capture,
   * Drive Off per `config.mjs`); toggled visible by removing the
   * `hidden` class when the dropdown value is `__improvised__`
   * (conflict-panel.mjs L152-160 on change, or initially via the
   * template's `{{#unless this.isImprovised}}hidden{{/unless}}`).
   *
   * A `change` event on this input dispatches to the handler at
   * `conflict-panel.mjs L181-189`, which calls
   * `combat.setWeapon(combatantId, name, "__improvised__")` —
   * storing the trimmed custom name as `system.weapon` and the
   * sentinel as `system.weaponId` (combat.mjs L268-274). Empty/
   * whitespace-only values fall back to the localized
   * "Improvised" label.
   *
   * @param {string} combatantId
   */
  improvisedInput(combatantId) {
    return this.weaponsContent.locator(
      `input.weapon-improvised-input[data-combatant-id="${combatantId}"]`
    );
  }

  /**
   * Set a custom improvised-weapon name. Fills the input, then
   * dispatches `change` (Playwright's `fill` only dispatches `input`,
   * and the panel listens for `change` — conflict-panel.mjs L182).
   * Polls the combatant's `system.weapon` until it reflects the
   * trimmed value, so the caller knows the server-side write landed.
   *
   * @param {string} combatantId
   * @param {string} name  — arbitrary user-provided weapon label.
   */
  async setImprovisedName(combatantId, name) {
    const input = this.improvisedInput(combatantId);
    await input.fill(name);
    await input.dispatchEvent('change');
    const expected = name.trim();
    await expect
      .poll(() =>
        this.page.evaluate((id) => {
          for ( const c of game.combats ) {
            const co = c.combatants.get(id);
            if ( co ) return co.system.weapon ?? null;
          }
          return null;
        }, combatantId)
      )
      .toBe(expected);
  }

  /**
   * Target-action select for assignable conflict weapons (panel-weapons.hbs
   * L30-37). Only rendered when the selected weapon's config entry has
   * `assignable: true` — `isAssignable` is derived at conflict-panel.mjs
   * L894 from `conflictWeapons.find(w => w.id === weaponId)?.assignable`.
   *
   * A `change` event on this select dispatches to the handler at
   * `conflict-panel.mjs L170-178` which calls
   * `combatant.update({ "system.weaponAssignment": <action> })`. The field
   * is declared on `CombatantData` at `module/data/combat/combatant.mjs`
   * L12. The stored action key is later consumed by `#onRollAction` at
   * `conflict-panel.mjs L1953` — when a bonus has `assignable: true`, the
   * `targetAction` switches from the static `bonus.action` to
   * `resolvedCombatant.system.weaponAssignment`.
   *
   * @param {string} combatantId
   */
  weaponAssignmentSelect(combatantId) {
    return this.weaponsContent.locator(
      `select.weapon-assignment-select[data-combatant-id="${combatantId}"]`
    );
  }

  /**
   * Pick a target action for an assignable weapon. Options are the four
   * conflict actions ("attack", "defend", "feint", "maneuver") — populated
   * from `weaponAssignmentChoices` at conflict-panel.mjs L906-911. Polls
   * the combatant's `system.weaponAssignment` until it reflects the value
   * (the change handler at conflict-panel.mjs L170-178 fires the update
   * without awaiting; combatant.update is async).
   *
   * @param {string} combatantId
   * @param {"attack"|"defend"|"feint"|"maneuver"} actionKey
   */
  async selectWeaponAssignment(combatantId, actionKey) {
    await this.weaponAssignmentSelect(combatantId).selectOption(actionKey);
    await expect
      .poll(() =>
        this.page.evaluate((id) => {
          for ( const c of game.combats ) {
            const co = c.combatants.get(id);
            if ( co ) return co.system.weaponAssignment ?? null;
          }
          return null;
        }, combatantId)
      )
      .toBe(actionKey);
  }

  /**
   * "Next → Script" button at the bottom of the weapons tab
   * (panel-weapons.hbs L52-56). Gated by `canBeginScripting`, which
   * only flips true once every non-KO'd combatant has a weapon set
   * (conflict-panel.mjs L978-979). Clicking dispatches to
   * `ConflictPanel.#onBeginScripting` (conflict-panel.mjs L1720-1726)
   * which calls `combat.beginScripting()` (combat.mjs L282-312), flips
   * `system.phase = "scripting"`, and (on round 1) allocates the
   * per-group 3-slot action arrays.
   */
  get beginScriptingButton() {
    return this.weaponsContent.locator(
      'button.setup-next-btn[data-action="beginScripting"]'
    );
  }

  /** Click "Next → Script" and wait for the script tab to become active. */
  async clickBeginScripting() {
    await this.beginScriptingButton.click();
    await expect.poll(() => this.activeTabId()).toBe('script');
  }
}
