import { evaluateRoll, gatherHelpModifiers, rollTest } from "../../dice/tb2e-roll.mjs";
import { getInteraction, buildResolutionContext, resolveActionEffect } from "../../dice/conflict-roll.mjs";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

/**
 * Floating wizard panel for managing Torchbearer 2E conflicts.
 * Provides tabbed interface for setup, disposition, weapons, scripting, and resolution.
 * Singleton pattern — access via ConflictPanel.getInstance().
 */
export default class ConflictPanel extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @type {string} Currently active tab. */
  #activeTab = "setup";

  /** @type {string} Last-seen combat phase for detecting phase transitions. */
  #lastPhase = "setup";

  /** @type {Object<string, number>} Hook IDs for cleanup. */
  #hookIds = {};

  /** @type {Map<string, Array<Object>>} Pending action selections per group, preserved across re-renders. */
  #pendingSelections = new Map();

  /** @type {Set<string>} Group IDs the GM has collapsed in the script tab. */
  #collapsedGroups = new Set();

  /** @type {number} Round number when auto-collapse was last applied. */
  #collapseInitRound = 0;

  static DEFAULT_OPTIONS = {
    id: "conflict-panel",
    classes: ["conflict-panel"],
    position: { width: 520, height: 620 },
    window: {
      title: "TB2E.Conflict.Playbook",
      resizable: true,
      minimizable: true
    },
    actions: {
      switchTab: ConflictPanel.#onSwitchTab,
      beginDisposition: ConflictPanel.#onBeginDisposition,
      rollDisposition: ConflictPanel.#onRollDisposition,
      distribute: ConflictPanel.#onDistribute,
      beginWeapons: ConflictPanel.#onBeginWeapons,
      setWeapon: ConflictPanel.#onSetWeapon,
      beginScripting: ConflictPanel.#onBeginScripting,
      lockActions: ConflictPanel.#onLockActions,
      beginResolve: ConflictPanel.#onBeginResolve,
      revealAction: ConflictPanel.#onRevealAction,
      rollAction: ConflictPanel.#onRollAction,
      resolveAction: ConflictPanel.#onResolveAction,
      nextAction: ConflictPanel.#onNextAction,
      removeCombatant: ConflictPanel.#onRemoveCombatant,
      nextRound: ConflictPanel.#onNextRound,
      endConflict: ConflictPanel.#onEndConflict,
      setCaptain: ConflictPanel.#onSetCaptain,
      chooseSkill: ConflictPanel.#onChooseSkill
    }
  };

  static PARTS = {
    panel: {
      template: "systems/tb2e/templates/conflict/panel.hbs",
      scrollable: [".panel-content"]
    }
  };

  static PARTIALS = [
    "systems/tb2e/templates/conflict/panel-setup.hbs",
    "systems/tb2e/templates/conflict/panel-disposition.hbs",
    "systems/tb2e/templates/conflict/panel-weapons.hbs",
    "systems/tb2e/templates/conflict/panel-script.hbs",
    "systems/tb2e/templates/conflict/panel-resolve.hbs",
    "systems/tb2e/templates/conflict/panel-roster.hbs"
  ];

  static {
    Hooks.once("init", () => {
      loadTemplates(ConflictPanel.PARTIALS);
    });
  }

  /* -------------------------------------------- */
  /*  Singleton Pattern                           */
  /* -------------------------------------------- */

  /**
   * Get or create the singleton ConflictPanel instance.
   * @returns {ConflictPanel}
   */
  static getInstance() {
    if ( !game.tb2e.conflictPanel ) {
      game.tb2e.conflictPanel = new ConflictPanel();
    }
    return game.tb2e.conflictPanel;
  }

  /* -------------------------------------------- */
  /*  Lifecycle                                    */
  /* -------------------------------------------- */

  /** @override */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this.#hookIds.updateCombat = Hooks.on("updateCombat", (combat) => {
      if ( combat.isConflict ) this.render();
    });
    this.#hookIds.updateCombatant = Hooks.on("updateCombatant", (combatant) => {
      if ( combatant.combat?.isConflict ) this.render();
    });
    this.#hookIds.updateActor = Hooks.on("updateActor", (actor) => {
      const combat = this.#getCombat();
      if ( combat?.combatants.some(c => c.actorId === actor.id) ) this.render();
    });
  }

  /** @override */
  async _onClose(options) {
    if ( this.#hookIds.updateCombat != null ) Hooks.off("updateCombat", this.#hookIds.updateCombat);
    if ( this.#hookIds.updateCombatant != null ) Hooks.off("updateCombatant", this.#hookIds.updateCombatant);
    if ( this.#hookIds.updateActor != null ) Hooks.off("updateActor", this.#hookIds.updateActor);
    this.#hookIds = {};
    await super._onClose(options);
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);

    // Handle weapon input changes (non-gear conflicts).
    for ( const input of this.element.querySelectorAll(".weapon-input") ) {
      input.addEventListener("change", (event) => {
        const combatantId = event.target.dataset.combatantId;
        const combat = this.#getCombat();
        if ( combat && combatantId ) combat.setWeapon(combatantId, event.target.value.trim());
      });
    }

    // Handle weapon select changes (gear conflicts).
    for ( const select of this.element.querySelectorAll(".weapon-select") ) {
      select.addEventListener("change", (event) => {
        const combatantId = event.target.dataset.combatantId;
        const combat = this.#getCombat();
        if ( !combat || !combatantId ) return;
        const weaponId = event.target.value;
        const row = event.target.closest(".weapon-row");
        const improvisedInput = row?.querySelector(".weapon-improvised-input");

        if ( weaponId === "__improvised__" ) {
          improvisedInput?.classList.remove("hidden");
          const name = improvisedInput?.value.trim() || game.i18n.localize("TB2E.Conflict.WeaponImprovised");
          combat.setWeapon(combatantId, name, "__improvised__");
        } else {
          improvisedInput?.classList.add("hidden");
          const selectedOption = event.target.options[event.target.selectedIndex];
          const name = weaponId ? selectedOption.text : "";
          combat.setWeapon(combatantId, name, weaponId);
        }
      });
    }

    // Handle improvised weapon name changes (gear conflicts).
    for ( const input of this.element.querySelectorAll(".weapon-improvised-input") ) {
      input.addEventListener("change", (event) => {
        const combatantId = event.target.dataset.combatantId;
        const combat = this.#getCombat();
        if ( !combat || !combatantId ) return;
        const name = event.target.value.trim() || game.i18n.localize("TB2E.Conflict.WeaponImprovised");
        combat.setWeapon(combatantId, name, "__improvised__");
      });
    }

    // Handle conflict name input.
    const conflictNameInput = this.element.querySelector(".conflict-name-input");
    if ( conflictNameInput ) {
      conflictNameInput.addEventListener("change", (event) => {
        const combat = this.#getCombat();
        if ( combat ) combat.update({ "system.conflictName": event.target.value.trim() });
      });
    }

    // Handle conflict type change.
    const typeSelect = this.element.querySelector(".conflict-type-select");
    if ( typeSelect ) {
      typeSelect.addEventListener("change", (event) => {
        const combat = this.#getCombat();
        if ( combat ) combat.update({ "system.conflictType": event.target.value });
      });
    }

    // Handle disposition distribution live validation.
    for ( const section of this.element.querySelectorAll(".distribution-section") ) {
      const total = parseInt(section.dataset.total) || 0;
      const inputs = section.querySelectorAll(".dist-value");
      const remainingEl = section.querySelector(".dist-remaining");
      const updateRemaining = () => {
        let sum = 0;
        for ( const inp of inputs ) sum += parseInt(inp.value) || 0;
        const rem = total - sum;
        if ( remainingEl ) {
          remainingEl.textContent = rem;
          remainingEl.classList.toggle("invalid", rem !== 0);
        }
      };
      for ( const inp of inputs ) inp.addEventListener("input", updateRemaining);
      updateRemaining();
    }

    // Handle action card clicks (script tab).
    for ( const card of this.element.querySelectorAll(".action-card") ) {
      card.addEventListener("click", (event) => {
        const btn = event.currentTarget;
        if ( btn.disabled ) return;
        const slot = btn.closest(".script-slot");
        const group = btn.closest("[data-group-id]");
        const actionKey = btn.dataset.actionKey;
        // Update hidden input.
        const hiddenInput = slot.querySelector(".action-select");
        if ( hiddenInput ) hiddenInput.value = actionKey;
        // Toggle selected class.
        for ( const sibling of slot.querySelectorAll(".action-card") ) {
          sibling.classList.toggle("selected", sibling === btn);
        }
        // Cache the selection so it survives re-renders.
        if ( group ) {
          const slotIndex = parseInt(slot.dataset.slotIndex);
          this.#cachePendingSelection(group.dataset.groupId, slotIndex, { action: actionKey });
        }
      });
    }

    // Handle combatant select changes (script tab) — cache to survive re-renders.
    for ( const select of this.element.querySelectorAll(".script-slots:not(.locked) .combatant-select") ) {
      select.addEventListener("change", (event) => {
        const group = event.target.closest("[data-group-id]");
        const slot = event.target.closest(".script-slot");
        if ( group && slot ) {
          const slotIndex = parseInt(slot.dataset.slotIndex);
          this.#cachePendingSelection(group.dataset.groupId, slotIndex, { combatantId: event.target.value });
        }
      });
    }

    // Handle collapse toggle on locked script group headers.
    for ( const header of this.element.querySelectorAll(".script-group-header[data-collapse-toggle]") ) {
      header.addEventListener("click", () => {
        const groupId = header.closest("[data-group-id]")?.dataset.groupId;
        if ( !groupId ) return;
        if ( this.#collapsedGroups.has(groupId) ) this.#collapsedGroups.delete(groupId);
        else this.#collapsedGroups.add(groupId);
        this.render();
      });
    }

    // Handle adding combatants via select dropdown (setup tab).
    for ( const select of this.element.querySelectorAll(".setup-add-combatant .add-combatant-select") ) {
      select.addEventListener("change", (event) => this.#onAddCombatant(event));
    }

    // Handle drag-and-drop of actors onto groups (setup tab).
    for ( const group of this.element.querySelectorAll(".setup-group") ) {
      group.addEventListener("dragover", (event) => event.preventDefault());
      group.addEventListener("drop", (event) => this.#onDropActor(event));
    }

    // Handle manual conflict configuration changes (setup tab).
    const manualDispAbility = this.element.querySelector(".manual-disp-ability");
    if ( manualDispAbility ) {
      manualDispAbility.addEventListener("change", (event) => {
        const combat = this.#getCombat();
        if ( combat ) combat.update({ "system.manualDispositionAbility": event.target.value });
      });
    }
    const manualDispSkill = this.element.querySelector(".manual-disp-skill");
    if ( manualDispSkill ) {
      manualDispSkill.addEventListener("change", (event) => {
        const combat = this.#getCombat();
        if ( !combat ) return;
        const value = event.target.value;
        combat.update({ "system.manualDispositionSkills": value ? [value] : [] });
      });
    }
    for ( const select of this.element.querySelectorAll(".manual-action-type") ) {
      select.addEventListener("change", (event) => this.#onManualActionChange(event));
    }
    for ( const select of this.element.querySelectorAll(".manual-action-key") ) {
      select.addEventListener("change", (event) => this.#onManualActionChange(event));
    }

    // Handle GM flat disposition input.
    for ( const input of this.element.querySelectorAll(".gm-disposition-input") ) {
      input.addEventListener("change", async (event) => {
        const groupId = event.target.dataset.groupId;
        const value = parseInt(event.target.value) || 0;
        if ( !groupId || value <= 0 ) return;
        const combat = this.#getCombat();
        if ( !combat ) return;
        await combat.storeDispositionRoll(groupId, {
          rolled: value,
          diceResults: [],
          cardHtml: `<em>GM set disposition to ${value}</em>`
        });
      });
    }

    // Handle per-side interaction override selects (resolve tab).
    for ( const select of this.element.querySelectorAll(".side-interaction-select") ) {
      select.addEventListener("change", async (event) => {
        const combat = this.#getCombat();
        if ( !combat ) return;
        const actionIndex = parseInt(event.target.dataset.actionIndex);
        const groupId = event.target.dataset.groupId;
        const value = event.target.value;
        await combat.setInteractionOverride(actionIndex, groupId, value);
      });
    }

    // Handle roster HP editing.
    for ( const input of this.element.querySelectorAll(".roster-hp-input") ) {
      input.addEventListener("change", async (event) => {
        const actorId = event.target.dataset.actorId;
        const actor = game.actors.get(actorId);
        if ( !actor ) return;
        const max = actor.system.conflict?.hp?.max || 0;
        const newValue = Math.max(0, Math.min(parseInt(event.target.value) || 0, max));
        if ( game.user.isGM || actor.isOwner ) {
          await actor.update({ "system.conflict.hp.value": newValue });
        } else {
          await actor.setFlag("tb2e", "pendingConflictHP", { newValue });
        }
      });
    }
  }

  /* -------------------------------------------- */
  /*  Helpers                                      */
  /* -------------------------------------------- */

  /**
   * Get the active conflict combat.
   * @returns {TB2ECombat|null}
   */
  #getCombat() {
    return game.combats?.find(c => c.isConflict) ?? null;
  }

  /**
   * Cache a pending selection for a script slot (survives re-renders).
   * @param {string} groupId
   * @param {number} slotIndex
   * @param {Object} updates  e.g. { action: "attack" } or { combatantId: "abc123" }
   */
  #cachePendingSelection(groupId, slotIndex, updates) {
    if ( !this.#pendingSelections.has(groupId) ) {
      this.#pendingSelections.set(groupId, [{}, {}, {}]);
    }
    Object.assign(this.#pendingSelections.get(groupId)[slotIndex], updates);
  }

  /**
   * Get the tab state based on combat phase.
   * @param {string} tabId
   * @param {string} phase
   * @returns {string} "completed", "current", or "upcoming"
   */
  #getTabState(tabId, phase) {
    const order = ["setup", "disposition", "weapons", "scripting", "resolve"];
    const phaseIndex = order.indexOf(phase);
    const tabIndex = order.indexOf(tabId === "script" ? "scripting" : tabId);
    if ( tabIndex < phaseIndex ) return "completed";
    if ( tabIndex === phaseIndex ) return "current";
    return "upcoming";
  }

  /* -------------------------------------------- */
  /*  Context                                      */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const combat = this.#getCombat();

    if ( !combat ) {
      context.hasCombat = false;
      return context;
    }

    context.hasCombat = true;
    context.isGM = game.user.isGM;
    const phase = combat.system.phase;
    const gd = combat.system.groupDispositions || {};
    const groups = Array.from(combat.groups);
    const conflictCfg = combat.getEffectiveConflictConfig();

    // Header data.
    context.conflictTypeLabel = game.i18n.localize(conflictCfg?.label ?? "TB2E.Conflict.Title");
    context.conflictType = combat.system.conflictType;
    context.conflictName = combat.system.conflictName || "";
    context.round = combat.system.currentRound || 0;
    context.currentAction = combat.system.currentAction || 0;
    context.actionNum = (combat.system.currentAction || 0) + 1;
    context.phase = phase;

    // Sync active tab to phase when phase advances.
    const phaseToTab = { setup: "setup", disposition: "disposition", weapons: "weapons", scripting: "script", resolve: "resolve" };
    const recommendedTab = phaseToTab[phase] || "setup";

    // Detect forward phase transition — advance all clients to the new tab.
    const order = ["setup", "disposition", "weapons", "scripting", "resolve"];
    const lastIdx = order.indexOf(this.#lastPhase);
    const phaseIdx = order.indexOf(phase);
    if ( phaseIdx > lastIdx ) {
      this.#activeTab = recommendedTab;
    }
    this.#lastPhase = phase;

    // Also catch tabs that are ahead of the current phase (e.g., after a round reset).
    const currentState = this.#getTabState(this.#activeTab, phase);
    if ( currentState === "upcoming" ) {
      this.#activeTab = recommendedTab;
    }
    context.activeTab = this.#activeTab;

    // Tab definitions.
    const tabDefs = [
      { id: "setup", label: "TB2E.Conflict.Tab.Setup", icon: "fa-solid fa-users-gear" },
      { id: "disposition", label: "TB2E.Conflict.Tab.Disposition", icon: "fa-solid fa-dice" },
      { id: "weapons", label: "TB2E.Conflict.Tab.Weapons", icon: "fa-solid fa-sword" },
      { id: "script", label: "TB2E.Conflict.Tab.Script", icon: "fa-solid fa-scroll" },
      { id: "resolve", label: "TB2E.Conflict.Tab.Resolve", icon: "fa-solid fa-swords" }
    ];
    context.tabs = tabDefs.map(t => ({
      ...t,
      label: game.i18n.localize(t.label),
      state: this.#getTabState(t.id, phase),
      isActive: t.id === this.#activeTab
    }));

    // Active tab flags.
    context.isSetupTab = this.#activeTab === "setup";
    context.isDispositionTab = this.#activeTab === "disposition";
    context.isWeaponsTab = this.#activeTab === "weapons";
    context.isScriptTab = this.#activeTab === "script";
    context.isResolveTab = this.#activeTab === "resolve";
    context.isResolve = phase === "resolve";

    // Group disposition bars for header.
    context.headerGroups = [];
    for ( const group of groups ) {
      const members = combat.combatants.filter(c => c._source.group === group.id);
      let current = 0, max = 0;
      for ( const c of members ) {
        const actor = game.actors.get(c.actorId);
        const hp = actor?.system.conflict?.hp || { value: 0, max: 0 };
        current += hp.value;
        max += hp.max;
      }
      context.headerGroups.push({
        id: group.id,
        name: group.name,
        current, max,
        percent: max > 0 ? Math.round((current / max) * 100) : 0,
        hasDisposition: max > 0
      });
    }

    // Prepare tab-specific context.
    switch ( this.#activeTab ) {
      case "setup":
        this.#prepareSetupContext(context, combat, groups, gd);
        break;
      case "disposition":
        this.#prepareDispositionContext(context, combat, groups, gd);
        break;
      case "weapons":
        this.#prepareWeaponsContext(context, combat, groups);
        break;
      case "script":
        this.#prepareScriptContext(context, combat, groups, gd);
        break;
      case "resolve":
        this.#prepareResolveContext(context, combat, groups, gd);
        break;
    }

    // Roster data.
    this.#prepareRosterContext(context, combat, groups, gd);

    return context;
  }

  /* -------------------------------------------- */

  #prepareSetupContext(context, combat, groups, gd) {
    context.conflictTypes = Object.entries(CONFIG.TB2E.conflictTypes).map(([key, cfg]) => ({
      key,
      label: game.i18n.localize(cfg.label),
      selected: key === combat.system.conflictType
    }));

    context.setupGroups = [];
    for ( const group of groups ) {
      const members = combat.combatants.filter(c => c._source.group === group.id);
      const groupData = gd[group.id] || {};
      context.setupGroups.push({
        id: group.id,
        name: group.name,
        captainId: groupData.captainId || null,
        hasCaptain: !!groupData.captainId,
        combatants: members.map(c => ({
          id: c.id,
          name: c.name,
          img: c.img,
          isCaptain: groupData.captainId === c.id
        }))
      });
    }

    // Available actors for adding to groups.
    const existingActorIds = new Set(combat.combatants.map(c => c.actorId));
    context.availableActors = game.actors
      .filter(a => (a.type === "character" || a.type === "npc") && !existingActorIds.has(a.id))
      .map(a => ({ id: a.id, name: a.name }));

    // Manual conflict configuration.
    context.isManual = combat.system.conflictType === "manual";
    if ( context.isManual && context.isGM ) {
      const currentAbility = combat.system.manualDispositionAbility || "will";
      const currentSkills = combat.system.manualDispositionSkills || [];
      const currentActions = combat.system.manualActions || {};

      // Ability options for disposition.
      context.abilityOptions = Object.entries(CONFIG.TB2E.abilities)
        .filter(([, cfg]) => cfg.rollable !== false)
        .map(([key, cfg]) => ({
          key,
          label: game.i18n.localize(cfg.label),
          selected: key === currentAbility
        }));

      // Skill options for disposition (single selection).
      const selectedSkill = currentSkills[0] || "";
      context.skillOptions = Object.entries(CONFIG.TB2E.skills).map(([key, cfg]) => ({
        key,
        label: game.i18n.localize(cfg.label),
        selected: key === selectedSkill
      }));

      // Build combined options list (abilities + skills) for action key dropdowns.
      const allAbilityOptions = Object.entries(CONFIG.TB2E.abilities)
        .filter(([, cfg]) => cfg.rollable !== false)
        .map(([key, cfg]) => ({ key, label: game.i18n.localize(cfg.label) }));
      const allSkillOptions = Object.entries(CONFIG.TB2E.skills)
        .map(([key, cfg]) => ({ key, label: game.i18n.localize(cfg.label) }));

      // Per-action configuration rows.
      context.manualActionRows = Object.entries(CONFIG.TB2E.conflictActions).map(([key, cfg]) => {
        const actionCfg = currentActions[key] || { type: "ability", keys: ["health"] };
        const isSkill = actionCfg.type === "skill";
        const selectedKey = actionCfg.keys?.[0] || "";
        const options = isSkill ? allSkillOptions : allAbilityOptions;
        return {
          key,
          label: game.i18n.localize(cfg.label),
          isAbility: !isSkill,
          isSkill,
          keyOptions: options.map(o => ({ ...o, selected: o.key === selectedKey }))
        };
      });
    }

    const allHaveCaptains = groups.every(g => gd[g.id]?.captainId);
    context.canBeginDisposition = allHaveCaptains;
  }

  /* -------------------------------------------- */

  #prepareDispositionContext(context, combat, groups, gd) {
    const conflictCfg = combat.getEffectiveConflictConfig();
    context.dispGroups = [];

    for ( const group of groups ) {
      const groupData = gd[group.id] || {};
      const members = combat.combatants.filter(c => c._source.group === group.id);
      const captain = groupData.captainId ? combat.combatants.get(groupData.captainId) : null;
      const captainActor = captain ? game.actors.get(captain.actorId) : null;

      const hasRolled = groupData.rolled != null;
      const hasDistributed = !!groupData.distributed;

      // Skill choice state.
      const hasMultipleSkills = (conflictCfg?.dispositionSkills?.length || 0) > 1;
      const chosenSkill = groupData.chosenSkill || (hasMultipleSkills ? null : conflictCfg?.dispositionSkills?.[0]);
      const needsSkillChoice = !chosenSkill && hasMultipleSkills;

      let skillOptions = [];
      if ( needsSkillChoice && captainActor ) {
        skillOptions = (conflictCfg.dispositionSkills || []).map(k => ({
          key: k,
          label: game.i18n.localize(CONFIG.TB2E.skills[k]?.label || k),
          rating: captainActor.system.skills[k]?.rating || 0
        }));
      }

      let skillLabel = "";
      let abilityLabel = "";
      if ( chosenSkill && captainActor ) {
        skillLabel = game.i18n.localize(CONFIG.TB2E.skills[chosenSkill]?.label || chosenSkill);
        abilityLabel = game.i18n.localize(
          CONFIG.TB2E.abilities[conflictCfg.dispositionAbility]?.label || conflictCfg.dispositionAbility
        );
      }

      // Distribution rows.
      let distributionRows = [];
      if ( hasRolled && !hasDistributed ) {
        const total = groupData.rolled;
        const base = Math.floor(total / (members.length || 1));
        let remainder = total - (base * (members.length || 1));
        distributionRows = members.map(c => {
          const suggested = base + (remainder > 0 ? 1 : 0);
          if ( remainder > 0 ) remainder--;
          return { id: c.id, name: c.name, isCaptain: groupData.captainId === c.id, suggested };
        });
      }

      // Permission checks.
      const captainActorId = captain?.actorId;
      const canRoll = !hasRolled && !!chosenSkill && (game.user.isGM || game.user.character?.id === captainActorId);
      const canDistribute = hasRolled && !hasDistributed && (game.user.isGM || game.user.character?.id === captainActorId);
      const canChooseSkill = !hasRolled && needsSkillChoice && (game.user.isGM || game.user.character?.id === captainActorId);

      context.dispGroups.push({
        id: group.id,
        name: group.name,
        captainName: captain?.name || "???",
        captainId: groupData.captainId,
        chosenSkill,
        needsSkillChoice,
        skillOptions,
        skillLabel,
        abilityLabel,
        hasRolled,
        rolled: groupData.rolled,
        hasDistributed,
        distributionRows,
        dispositionTotal: groupData.rolled || 0,
        canRoll,
        canDistribute,
        canChooseSkill
      });
    }

    const allDistributed = groups.every(g => gd[g.id]?.distributed);
    context.allDistributed = allDistributed;
  }

  /* -------------------------------------------- */

  #prepareWeaponsContext(context, combat, groups) {
    const conflictCfg = combat.getEffectiveConflictConfig();
    const usesGear = !!conflictCfg?.usesGear;
    context.usesGear = usesGear;
    context.weaponGroups = [];
    for ( const group of groups ) {
      const members = combat.combatants.filter(c => c._source.group === group.id);
      context.weaponGroups.push({
        id: group.id,
        name: group.name,
        combatants: members.map(c => {
          const actor = game.actors.get(c.actorId);
          const canEdit = game.user.isGM || game.user.character?.id === c.actorId;
          const weaponId = c.system.weaponId || "";
          const data = {
            id: c.id,
            name: c.name,
            img: c.img,
            weapon: c.system.weapon || actor?.system.conflict?.weapon || "",
            weaponId,
            knockedOut: c.system.knockedOut,
            canEdit,
            isUnarmed: weaponId === "__unarmed__",
            isImprovised: weaponId === "__improvised__"
          };

          // Build weapon choices for gear-based conflicts.
          if ( usesGear && actor && !c.system.knockedOut ) {
            const weapons = (actor.itemTypes.weapon || []).filter(w => !w.system.dropped);
            data.weaponChoices = [
              { id: "__unarmed__", name: game.i18n.localize("TB2E.Conflict.WeaponUnarmed"), selected: weaponId === "__unarmed__" },
              ...weapons.map(w => ({ id: w.id, name: w.name, selected: weaponId === w.id })),
              { id: "__improvised__", name: game.i18n.localize("TB2E.Conflict.WeaponImprovised"), selected: weaponId === "__improvised__" }
            ];
          }

          return data;
        })
      });
    }
    const allArmed = Array.from(combat.combatants).every(c => c.system.knockedOut || c.system.weapon);
    context.canBeginScripting = allArmed;
  }

  /* -------------------------------------------- */

  #prepareScriptContext(context, combat, groups, gd) {
    const roundNum = combat.system.currentRound || 0;
    const round = combat.system.rounds?.[roundNum];

    context.scriptGroups = [];
    context.roundNum = roundNum;

    for ( const group of groups ) {
      const allMembers = combat.combatants.filter(c => c._source.group === group.id);
      const members = allMembers.filter(c => !c.system.knockedOut);
      const isLocked = round?.locked?.[group.id] || false;
      const actions = round?.actions?.[group.id] || [null, null, null];
      const teamSize = members.length;

      // Permission.
      const groupData = gd[group.id] || {};
      const captainActorId = groupData.captainId
        ? combat.combatants.get(groupData.captainId)?.actorId
        : null;
      const canScript = game.user.isGM || game.user.character?.id === captainActorId;

      // Last-round tracking for validation.
      const combatantActedMap = {};
      for ( const c of members ) {
        combatantActedMap[c.id] = c.system.actedLastRound || [];
      }

      // Build action slots.
      const pending = (!isLocked && this.#pendingSelections.has(group.id))
        ? this.#pendingSelections.get(group.id) : null;
      const slots = [];
      for ( let i = 0; i < 3; i++ ) {
        const entry = actions[i] || {};
        let action = entry.action || "";
        let combatantId = (teamSize === 1 ? members[0].id : entry.combatantId) || "";

        // Merge cached pending selections for unlocked groups.
        if ( pending && pending[i] ) {
          if ( pending[i].action ) action = pending[i].action;
          if ( pending[i].combatantId ) combatantId = pending[i].combatantId;
        }

        const slotData = {
          index: i,
          volleyNum: i + 1,
          action,
          combatantId,
          isSet: teamSize === 1 ? !!action : (!!action && !!combatantId)
        };

        // Enrich locked slots with display data.
        if ( isLocked && action ) {
          const cfg = CONFIG.TB2E.conflictActions[action];
          if ( cfg ) {
            slotData.actionLabel = game.i18n.localize(cfg.label);
            slotData.actionIcon = cfg.icon;
            slotData.actionColorClass = `action-${action}`;
          }
          const combatant = combat.combatants.get(combatantId);
          slotData.combatantName = combatant?.name || "";
        }

        slots.push(slotData);
      }

      // Available actions.
      const actionChoices = Object.entries(CONFIG.TB2E.conflictActions).map(([key, cfg]) => ({
        key,
        label: game.i18n.localize(cfg.label),
        icon: cfg.icon
      }));

      // Available combatants — includes KO'd as disabled.
      const combatantChoices = allMembers.map(c => ({
        id: c.id,
        name: c.name,
        knockedOut: c.system.knockedOut,
        actedLastRound: combatantActedMap[c.id] || [],
        mustActFirst: roundNum > 1 && !c.system.knockedOut && (combatantActedMap[c.id] || []).length === 0,
        cantBeSlot0: roundNum > 1 && teamSize > 1 && !c.system.knockedOut
          && (combatantActedMap[c.id] || []).includes(2)
      }));

      // Last-round summary for display.
      let lastRoundSummary = null;
      if ( roundNum > 1 ) {
        lastRoundSummary = members.map(c => {
          const acted = combatantActedMap[c.id] || [];
          return {
            name: c.name,
            actedSlots: acted.length ? acted.map(s => s + 1).join(", ") : "—"
          };
        });
      }

      const allSet = slots.every(s => s.isSet);

      // Determine if current user can view this group's locked actions.
      const canViewActions = game.user.isGM
        || allMembers.some(c => c.actorId === game.user.character?.id);

      // Party detection for GM auto-collapse.
      const isPartyGroup = allMembers.some(c => {
        const actor = game.actors.get(c.actorId);
        return actor?.hasPlayerOwner;
      });

      // Auto-collapse party group for GM when it locks (once per round).
      if ( isLocked && game.user.isGM && isPartyGroup && roundNum !== this.#collapseInitRound ) {
        this.#collapsedGroups.add(group.id);
        this.#collapseInitRound = roundNum;
      }

      const isCollapsed = isLocked && this.#collapsedGroups.has(group.id);

      context.scriptGroups.push({
        id: group.id,
        name: group.name,
        isLocked,
        canScript,
        canLock: canScript && !isLocked,
        slots,
        actionChoices,
        combatantChoices,
        allSet,
        teamSize,
        isSolo: teamSize === 1,
        lastRoundSummary,
        canViewActions,
        isCollapsed
      });
    }

    const allLocked = round ? Object.values(round.locked || {}).every(v => v) : false;
    context.allLocked = allLocked;
    context.canBeginResolve = allLocked;
  }

  /* -------------------------------------------- */

  #prepareResolveContext(context, combat, groups, gd) {
    const roundNum = combat.system.currentRound || 0;
    const round = combat.system.rounds?.[roundNum];
    if ( !round ) return;

    const currentAction = combat.system.currentAction || 0;
    context.resolveActions = [];

    for ( let i = 0; i < 3; i++ ) {
      const volley = round.volleys?.[i] || {};
      const isCurrent = i === currentAction;
      const isPast = i < currentAction;
      const isFuture = i > currentAction;

      // Get actions for both sides.
      const sides = [];
      for ( const group of groups ) {
        const entry = round.actions[group.id]?.[i];
        if ( !entry ) continue;
        const combatant = combat.combatants.get(entry.combatantId);
        const actor = combatant ? game.actors.get(combatant.actorId) : null;

        // Get the skill/ability for this action.
        const conflictCfg = combat.getEffectiveConflictConfig();
        const actionCfg = conflictCfg?.actions?.[entry.action];
        let testLabel = "";
        if ( actionCfg ) {
          const key = actionCfg.keys[0];
          const labelKey = actionCfg.type === "skill"
            ? CONFIG.TB2E.skills[key]?.label
            : CONFIG.TB2E.abilities[key]?.label;
          testLabel = labelKey ? game.i18n.localize(labelKey) : key;
        }

        sides.push({
          groupId: group.id,
          groupName: group.name,
          action: entry.action,
          actionLabel: game.i18n.localize(CONFIG.TB2E.conflictActions[entry.action]?.label || entry.action),
          actionIcon: CONFIG.TB2E.conflictActions[entry.action]?.icon || "",
          combatantId: entry.combatantId,
          combatantName: combatant?.name || "???",
          actorId: actor?.id,
          testLabel
        });
      }

      // Determine per-side interactions if revealed.
      let interaction = null;
      let interactionLabel = "";
      if ( volley.revealed && sides.length >= 2 ) {
        sides[0].sideInteraction = getInteraction(sides[0].action, sides[1].action);
        sides[1].sideInteraction = getInteraction(sides[1].action, sides[0].action);

        // Apply per-side overrides from volley data.
        if ( volley.interactionOverrides ) {
          if ( volley.interactionOverrides[sides[0].groupId] ) {
            sides[0].sideInteraction = volley.interactionOverrides[sides[0].groupId];
          }
          if ( volley.interactionOverrides[sides[1].groupId] ) {
            sides[1].sideInteraction = volley.interactionOverrides[sides[1].groupId];
          }
        }

        // Mark as overridable for GM on current unreesolved actions.
        const isOverridable = isCurrent && !volley.result && context.isGM;
        sides[0].interactionOverridable = isOverridable;
        sides[1].interactionOverridable = isOverridable;

        // Overall interaction label for display (use group 0's perspective).
        interaction = sides[0].sideInteraction;
        interactionLabel = game.i18n.localize(`TB2E.Conflict.Interaction.${interaction}`);
      }

      // Enrich past actions with stored result data.
      let resultSides = sides;
      let resultInteraction = interaction;
      let resultInteractionLabel = interactionLabel;
      if ( isPast && volley.result?.sides?.length ) {
        resultSides = volley.result.sides;
        resultInteraction = volley.result.interaction;
        resultInteractionLabel = volley.result.interactionLabel;
      }

      context.resolveActions.push({
        index: i,
        actionNum: i + 1,
        isCurrent,
        isPast,
        isFuture,
        isRevealed: volley.revealed || false,
        hasResult: volley.result != null,
        isLastAction: i === 2,
        result: volley.result,
        sides: isCurrent ? sides : resultSides,
        interaction: isCurrent ? interaction : resultInteraction,
        interactionLabel: isCurrent ? interactionLabel : resultInteractionLabel
      });
    }

    const allRevealed = round.volleys?.every(v => v.revealed) || false;
    const allResolved = round.volleys?.every(v => v.result != null) || false;
    context.allRevealed = allRevealed;
    context.allResolved = allResolved;

    // Interaction labels lookup for template.
    context.interactionLabels = {
      versus: game.i18n.localize("TB2E.Conflict.Interaction.versus"),
      independent: game.i18n.localize("TB2E.Conflict.Interaction.independent"),
      none: game.i18n.localize("TB2E.Conflict.Interaction.none")
    };
  }

  /* -------------------------------------------- */

  #prepareRosterContext(context, combat, groups, gd) {
    const roundNum = combat.system.currentRound || 0;
    context.roster = [];
    for ( const group of groups ) {
      const members = combat.combatants.filter(c => c._source.group === group.id);
      const captainId = gd[group.id]?.captainId;
      const captainActorId = captainId ? combat.combatants.get(captainId)?.actorId : null;
      const isCaptain = captainActorId && captainActorId === game.user.character?.id;
      for ( const c of members ) {
        const actor = game.actors.get(c.actorId);
        const hp = actor?.system.conflict?.hp || { value: 0, max: 0 };
        const actedLastRound = c.system.actedLastRound || [];
        const actedLastRoundLabel = actedLastRound.length
          ? actedLastRound.map(s => s + 1).join(", ")
          : "—";
        context.roster.push({
          id: c.id,
          name: c.name,
          img: c.img,
          actorId: c.actorId,
          groupId: group.id,
          groupName: group.name,
          hp,
          hpPercent: hp.max > 0 ? Math.round((hp.value / hp.max) * 100) : 0,
          hasHP: hp.max > 0,
          canEditHP: hp.max > 0 && (game.user.isGM || isCaptain),
          knockedOut: c.system.knockedOut,
          weapon: c.system.weapon || actor?.system.conflict?.weapon || "",
          actedLastRoundLabel,
          mustAct: roundNum > 1 && !c.system.knockedOut && actedLastRound.length === 0
        });
      }
    }
  }

  /* -------------------------------------------- */
  /*  Action Handlers                             */
  /* -------------------------------------------- */

  /**
   * Switch to a different tab.
   * @this {ConflictPanel}
   */
  static #onSwitchTab(event, target) {
    const tab = target.dataset.tab;
    if ( tab ) {
      this.#activeTab = tab;
      this.render();
    }
  }

  /* -------------------------------------------- */

  /**
   * Set a combatant as captain.
   * @this {ConflictPanel}
   */
  static async #onSetCaptain(event, target) {
    const combatantId = target.dataset.combatantId;
    const groupId = target.closest("[data-group-id]")?.dataset.groupId;
    const combat = this.#getCombat();
    if ( combat && combatantId && groupId ) {
      await combat.setCaptain(groupId, combatantId);
    }
  }

  /* -------------------------------------------- */

  /**
   * Choose a disposition skill for a group.
   * @this {ConflictPanel}
   */
  static async #onChooseSkill(event, target) {
    const groupId = target.closest("[data-group-id]")?.dataset.groupId;
    const skillKey = target.dataset.skill;
    const combat = this.#getCombat();
    if ( !combat || !groupId || !skillKey ) return;

    const gd = foundry.utils.deepClone(combat.system.groupDispositions || {});
    if ( !gd[groupId] ) gd[groupId] = {};
    gd[groupId].chosenSkill = skillKey;
    await combat.update({ "system.groupDispositions": gd });
  }

  /* -------------------------------------------- */

  /**
   * Transition to disposition phase.
   * @this {ConflictPanel}
   */
  static async #onBeginDisposition() {
    const combat = this.#getCombat();
    if ( !combat ) return;
    this.#activeTab = "disposition";
    await combat.beginDisposition();

    // Post declaration chat card.
    const groups = Array.from(combat.groups);
    const gd = combat.system.groupDispositions || {};
    const conflictCfg = combat.getEffectiveConflictConfig();
    const teams = groups.map(g => {
      const members = combat.combatants.filter(c => c._source.group === g.id);
      return {
        name: g.name,
        members: members.map(c => ({
          name: c.name,
          isCaptain: gd[g.id]?.captainId === c.id
        }))
      };
    });
    const cardHtml = await foundry.applications.handlebars.renderTemplate(
      "systems/tb2e/templates/chat/conflict-declaration.hbs", {
        conflictTypeLabel: game.i18n.localize(conflictCfg?.label ?? "TB2E.Conflict.Title"),
        conflictName: combat.system.conflictName || "",
        teams
      }
    );
    await ChatMessage.create({
      content: cardHtml,
      type: CONST.CHAT_MESSAGE_STYLES.OTHER
    });
  }

  /* -------------------------------------------- */

  /**
   * Roll disposition for a group captain.
   * @this {ConflictPanel}
   */
  static async #onRollDisposition(event, target) {
    const groupId = target.closest("[data-group-id]")?.dataset.groupId;
    const combat = this.#getCombat();
    if ( !combat || !groupId ) return;

    const gd = combat.system.groupDispositions || {};
    const groupData = gd[groupId] || {};
    const captain = groupData.captainId ? combat.combatants.get(groupData.captainId) : null;
    if ( !captain ) return;

    const actor = game.actors.get(captain.actorId);
    if ( !actor ) return;

    const conflictCfg = combat.getEffectiveConflictConfig();
    const skillKey = groupData.chosenSkill || conflictCfg?.dispositionSkills?.[0];
    if ( !skillKey ) return;

    const group = combat.groups.get(groupId);
    const members = combat.combatants.filter(c => c._source.group === groupId);
    const memberActors = members
      .filter(c => c.id !== groupData.captainId)
      .map(c => game.actors.get(c.actorId))
      .filter(Boolean);

    await rollTest({
      actor,
      type: "skill",
      key: skillKey,
      testContext: {
        isDisposition: true,
        isConflict: true,
        dispositionAbility: conflictCfg.dispositionAbility,
        conflictGroupId: groupId,
        combatId: combat.id,
        conflictTypeLabel: game.i18n.localize(conflictCfg?.label ?? "TB2E.Conflict.Title"),
        groupName: group?.name ?? "",
        candidates: memberActors
      }
    });
  }

  /* -------------------------------------------- */

  /**
   * Distribute disposition points for a group.
   * @this {ConflictPanel}
   */
  static async #onDistribute(event, target) {
    const groupId = target.closest("[data-group-id]")?.dataset.groupId;
    const combat = this.#getCombat();
    if ( !combat || !groupId ) return;

    const gd = combat.system.groupDispositions || {};
    const total = gd[groupId]?.rolled;
    if ( total == null ) return;

    const section = target.closest(".distribution-section");
    const distribution = {};
    for ( const input of section.querySelectorAll(".dist-value") ) {
      distribution[input.name.replace("disp-", "")] = parseInt(input.value) || 0;
    }

    const sum = Object.values(distribution).reduce((a, b) => a + b, 0);
    if ( sum !== total ) {
      ui.notifications.warn(game.i18n.format("TB2E.Conflict.DistributionMismatch", { total, sum }));
      return;
    }

    await combat.distributeDisposition(groupId, distribution);
  }

  /* -------------------------------------------- */

  /**
   * Transition from disposition to weapons phase.
   * @this {ConflictPanel}
   */
  static async #onBeginWeapons() {
    const combat = this.#getCombat();
    if ( combat ) {
      await combat.beginWeapons();
      this.#activeTab = "weapons";
    }
  }

  /* -------------------------------------------- */

  /**
   * Set weapon for a combatant (handled via change listener in _onRender).
   * This action handler is a fallback for explicit button clicks.
   * @this {ConflictPanel}
   */
  static async #onSetWeapon(event, target) {
    const combatantId = target.dataset.combatantId;
    const combat = this.#getCombat();
    if ( !combat || !combatantId ) return;
    const input = target.closest(".weapon-row")?.querySelector(".weapon-input");
    if ( input ) await combat.setWeapon(combatantId, input.value.trim());
  }

  /* -------------------------------------------- */

  /**
   * Transition to scripting phase.
   * @this {ConflictPanel}
   */
  static async #onBeginScripting() {
    const combat = this.#getCombat();
    if ( combat ) {
      await combat.beginScripting();
      this.#activeTab = "script";
    }
  }

  /* -------------------------------------------- */

  /**
   * Lock a team's scripted actions.
   * Reads current form state and sets actions before locking.
   * @this {ConflictPanel}
   */
  static async #onLockActions(event, target) {
    const groupId = target.closest("[data-group-id]")?.dataset.groupId;
    const combat = this.#getCombat();
    if ( !combat || !groupId ) return;

    const roundNum = combat.system.currentRound || 0;
    const members = combat.combatants.filter(c => c._source.group === groupId && !c.system.knockedOut);
    const teamSize = members.length;

    // Read the 3 action slots from the form.
    const section = target.closest(".script-group");
    const actions = [];
    for ( let i = 0; i < 3; i++ ) {
      const row = section.querySelector(`[data-slot-index="${i}"]`);
      if ( !row ) { actions.push(null); continue; }
      const actionSelect = row.querySelector(".action-select");
      const combatantSelect = row.querySelector(".combatant-select");
      const combatantId = teamSize === 1 ? members[0].id : (combatantSelect?.value || null);
      actions.push({
        action: actionSelect?.value || null,
        combatantId
      });
    }

    // --- Validation (Part 2B) ---

    // All slots must have an action (and combatant, if team > 1).
    const incomplete = actions.some(a => !a?.action || !a?.combatantId);
    if ( incomplete ) {
      ui.notifications.warn(game.i18n.localize("TB2E.Conflict.SelectAction"));
      return;
    }

    // Must-act-first: combatants who didn't act last round must appear.
    if ( roundNum > 1 ) {
      for ( const c of members ) {
        const acted = c.system.actedLastRound || [];
        if ( acted.length === 0 ) {
          const appears = actions.some(a => a?.combatantId === c.id);
          if ( !appears ) {
            ui.notifications.warn(game.i18n.format("TB2E.Conflict.MustActFirst", { name: c.name }));
            return;
          }
        }
      }

      // No-consecutive: combatant in slot 2 last round cannot be in slot 0 this round.
      if ( teamSize > 1 ) {
        const slot0Id = actions[0]?.combatantId;
        if ( slot0Id ) {
          const slot0Combatant = combat.combatants.get(slot0Id);
          const acted = slot0Combatant?.system.actedLastRound || [];
          if ( acted.includes(2) ) {
            ui.notifications.warn(game.i18n.format("TB2E.Conflict.NoConsecutive", { name: slot0Combatant.name }));
            return;
          }
        }
      }
    }

    // Team size rules.
    const assignedIds = actions.map(a => a?.combatantId).filter(Boolean);
    const uniqueIds = new Set(assignedIds);

    if ( teamSize === 1 ) {
      if ( uniqueIds.size !== 1 || assignedIds.length !== 3 ) {
        ui.notifications.warn(game.i18n.localize("TB2E.Conflict.SoloAllSlots"));
        return;
      }
    } else if ( teamSize === 2 ) {
      const memberIds = new Set(members.map(c => c.id));
      if ( uniqueIds.size !== 2 || assignedIds.length !== 3 || ![...uniqueIds].every(id => memberIds.has(id)) ) {
        ui.notifications.warn(game.i18n.localize("TB2E.Conflict.TwoMemberSplit"));
        return;
      }
    } else if ( teamSize === 3 ) {
      if ( uniqueIds.size !== 3 || assignedIds.length !== 3 ) {
        ui.notifications.warn(game.i18n.localize("TB2E.Conflict.ThreeMemberEach"));
        return;
      }
    } else if ( teamSize >= 4 ) {
      if ( uniqueIds.size !== 3 || assignedIds.length !== 3 ) {
        ui.notifications.warn(game.i18n.localize("TB2E.Conflict.FourPlusMember"));
        return;
      }
    }

    await combat.setActions(groupId, actions);
    // Small delay to let the update propagate before locking.
    await new Promise(r => setTimeout(r, 100));
    await combat.lockActions(groupId);
    this.#pendingSelections.delete(groupId);
  }

  /* -------------------------------------------- */

  /**
   * Transition to resolve phase.
   * @this {ConflictPanel}
   */
  static async #onBeginResolve() {
    const combat = this.#getCombat();
    if ( combat ) {
      await combat.beginResolve();
      this.#activeTab = "resolve";
    }
  }

  /* -------------------------------------------- */

  /**
   * Reveal the current action.
   * @this {ConflictPanel}
   */
  static async #onRevealAction(event, target) {
    const combat = this.#getCombat();
    if ( !combat ) return;
    const actionIndex = combat.system.currentAction || 0;
    await combat.revealVolley(actionIndex);

    // Post action reveal chat card.
    const roundNum = combat.system.currentRound || 0;
    const round = combat.system.rounds?.[roundNum];
    if ( !round ) return;
    const groups = Array.from(combat.groups);
    const sides = [];
    for ( const group of groups ) {
      const entry = round.actions[group.id]?.[actionIndex];
      if ( !entry ) continue;
      const combatant = combat.combatants.get(entry.combatantId);
      sides.push({
        groupId: group.id,
        combatantName: combatant?.name || "???",
        action: entry.action,
        actionLabel: game.i18n.localize(CONFIG.TB2E.conflictActions[entry.action]?.label || entry.action)
      });
    }
    let interaction = null;
    let interactionLabel = "";
    if ( sides.length >= 2 ) {
      interaction = getInteraction(sides[0].action, sides[1].action);
      interactionLabel = game.i18n.localize(`TB2E.Conflict.Interaction.${interaction}`);
    }
    const cardHtml = await foundry.applications.handlebars.renderTemplate(
      "systems/tb2e/templates/chat/conflict-action-reveal.hbs", {
        round: roundNum,
        actionNum: actionIndex + 1,
        sides,
        interaction,
        interactionLabel
      }
    );
    await ChatMessage.create({
      content: cardHtml,
      type: CONST.CHAT_MESSAGE_STYLES.OTHER
    });
  }

  /* -------------------------------------------- */

  /**
   * Roll for an action in the resolve phase.
   * Opens the standard roll dialog for the acting combatant.
   * @this {ConflictPanel}
   */
  static async #onRollAction(event, target) {
    const combat = this.#getCombat();
    if ( !combat ) return;

    const actorId = target.dataset.actorId;
    const actor = game.actors.get(actorId);
    if ( !actor ) return;

    const actionKey = target.dataset.conflictAction;
    const groupId = target.dataset.groupId;
    const conflictCfg = combat.getEffectiveConflictConfig();
    const actionCfg = conflictCfg?.actions?.[actionKey];
    if ( !actionCfg ) return;

    // Determine the test key.
    const testKey = actionCfg.keys[0];

    // Build conflict modifiers from maneuver effects.
    const roundNum = combat.system.currentRound || 0;
    const round = combat.system.rounds?.[roundNum];
    const modifiers = [];
    if ( round?.effects ) {
      // Impede: opponent imposed a penalty on this side.
      const impedeValue = round.effects.impede?.[groupId] || 0;
      if ( impedeValue > 0 ) {
        modifiers.push({
          label: game.i18n.localize("TB2E.Conflict.Maneuver.Impede"),
          type: "dice",
          value: -impedeValue,
          source: "conflict"
        });
      }
      // Position: this side gained bonus dice.
      const positionValue = round.effects.position?.[groupId] || 0;
      if ( positionValue > 0 ) {
        modifiers.push({
          label: game.i18n.localize("TB2E.Conflict.Maneuver.Position"),
          type: "dice",
          value: positionValue,
          source: "conflict"
        });
      }
    }

    // Determine per-side interaction (respects overrides).
    const groups = Array.from(combat.groups);
    const actionIndex = combat.system.currentAction || 0;
    const volley = round?.volleys?.[actionIndex] || {};
    let obstacle;
    let isVersus = false;
    if ( groups.length >= 2 ) {
      const opponentGroupId = groups.find(g => g.id !== groupId)?.id;
      const opponentAction = round?.actions[opponentGroupId]?.[actionIndex]?.action;
      if ( opponentAction ) {
        let sideInteraction = getInteraction(actionKey, opponentAction);
        // Check for per-side override.
        if ( volley.interactionOverrides?.[groupId] ) {
          sideInteraction = volley.interactionOverrides[groupId];
        }
        if ( sideInteraction === "independent" ) {
          obstacle = CONFIG.TB2E.conflictObstacles[actionKey] || 0;
        } else if ( sideInteraction === "versus" ) {
          isVersus = true;
        }
      }
    }

    await rollTest({
      actor,
      type: actionCfg.type,
      key: testKey,
      testContext: {
        isConflict: true,
        modifiers,
        ...(obstacle != null ? { obstacle } : {}),
        ...(isVersus ? { isVersus: true } : {})
      }
    });
  }

  /* -------------------------------------------- */

  /**
   * Mark the current action as resolved.
   * @this {ConflictPanel}
   */
  static async #onResolveAction(event, target) {
    const combat = this.#getCombat();
    if ( !combat ) return;
    const actionIndex = parseInt(target.dataset.actionIndex);
    if ( isNaN(actionIndex) ) return;

    // Build richer result with sides and interaction info.
    const roundNum = combat.system.currentRound || 0;
    const round = combat.system.rounds?.[roundNum];
    const groups = Array.from(combat.groups);
    const resultSides = [];
    for ( const group of groups ) {
      const entry = round?.actions[group.id]?.[actionIndex];
      if ( !entry ) continue;
      const combatant = combat.combatants.get(entry.combatantId);
      resultSides.push({
        action: entry.action,
        actionLabel: game.i18n.localize(CONFIG.TB2E.conflictActions[entry.action]?.label || entry.action),
        combatantName: combatant?.name || "???",
        groupId: group.id
      });
    }
    let interaction = null;
    let interactionLabel = "";
    if ( resultSides.length >= 2 ) {
      interaction = getInteraction(resultSides[0].action, resultSides[1].action);
      interactionLabel = game.i18n.localize(`TB2E.Conflict.Interaction.${interaction}`);
    }

    await combat.resolveVolley(actionIndex, {
      resolved: true,
      sides: resultSides,
      interaction,
      interactionLabel,
      timestamp: Date.now()
    });

    // Post round summary card after the third action is resolved.
    if ( actionIndex === 2 ) {
      const actions = [];
      for ( let i = 0; i < 3; i++ ) {
        const volley = round?.volleys?.[i] || {};
        const volleyResult = i === 2 ? { sides: resultSides } : (volley.result || {});
        const volleySides = volleyResult.sides || [];
        // Fallback: build sides from round.actions if result didn't store them.
        const cardSides = volleySides.length ? volleySides : groups.map(g => {
          const e = round?.actions[g.id]?.[i];
          if ( !e ) return null;
          const c = combat.combatants.get(e.combatantId);
          return {
            action: e.action,
            actionLabel: game.i18n.localize(CONFIG.TB2E.conflictActions[e.action]?.label || e.action),
            combatantName: c?.name || "???"
          };
        }).filter(Boolean);
        actions.push({ actionNum: i + 1, sides: cardSides });
      }

      // Disposition changes.
      const dispositionChanges = groups.map(g => {
        const members = combat.combatants.filter(c => c._source.group === g.id);
        let current = 0, max = 0;
        for ( const c of members ) {
          const actor = game.actors.get(c.actorId);
          const hp = actor?.system.conflict?.hp || { value: 0, max: 0 };
          current += hp.value;
          max += hp.max;
        }
        return { groupName: g.name, current, max };
      });

      const summaryHtml = await foundry.applications.handlebars.renderTemplate(
        "systems/tb2e/templates/chat/conflict-round-summary.hbs", {
          round: roundNum,
          actions,
          dispositionChanges
        }
      );
      await ChatMessage.create({
        content: summaryHtml,
        type: CONST.CHAT_MESSAGE_STYLES.OTHER
      });
    }
  }

  /* -------------------------------------------- */

  /**
   * Advance to the next action.
   * @this {ConflictPanel}
   */
  static async #onNextAction() {
    const combat = this.#getCombat();
    if ( combat ) await combat.nextAction();
  }

  /* -------------------------------------------- */

  /**
   * Remove a combatant from the conflict.
   * @this {ConflictPanel}
   */
  static async #onRemoveCombatant(event, target) {
    const combatantId = target.closest("[data-combatant-id]")?.dataset.combatantId;
    const combat = this.#getCombat();
    const combatant = combat?.combatants.get(combatantId);
    if ( combatant ) await combatant.delete();
  }

  /* -------------------------------------------- */

  /**
   * Handle adding a combatant via the setup tab select dropdown.
   */
  async #onAddCombatant(event) {
    const select = event.target;
    const actorId = select.value;
    const groupId = select.dataset.groupId;
    if ( !actorId || !groupId ) return;

    const combat = this.#getCombat();
    if ( !combat ) return;

    const actor = game.actors.get(actorId);
    if ( !actor ) return;

    if ( combat.combatants.find(c => c.actorId === actor.id) ) {
      ui.notifications.warn(game.i18n.localize("TB2E.Conflict.AlreadyInConflict"));
      select.value = "";
      return;
    }

    const targetGroup = this.#resolveGroupForActor(combat, actor) ?? groupId;
    const token = canvas.scene?.tokens.find(t => t.actorId === actor.id);

    await combat.createEmbeddedDocuments("Combatant", [{
      actorId: actor.id,
      name: actor.name,
      img: actor.img,
      group: targetGroup,
      type: "conflict",
      tokenId: token?.id ?? null,
      sceneId: token?.parent?.id ?? null
    }]);
    select.value = "";
  }

  /* -------------------------------------------- */

  /**
   * Handle dropping an actor onto a setup group.
   */
  async #onDropActor(event) {
    const groupEl = event.target.closest("[data-group-id]");
    if ( !groupEl ) return;
    const groupId = groupEl.dataset.groupId;

    let data;
    try { data = JSON.parse(event.dataTransfer.getData("text/plain")); }
    catch { return; }
    if ( data.type !== "Actor" ) return;

    const actor = await fromUuid(data.uuid);
    if ( !actor ) return;

    const combat = this.#getCombat();
    if ( !combat ) return;

    if ( combat.combatants.find(c => c.actorId === actor.id) ) {
      ui.notifications.warn(game.i18n.localize("TB2E.Conflict.AlreadyInConflict"));
      return;
    }

    const targetGroup = this.#resolveGroupForActor(combat, actor) ?? groupId;
    const token = canvas.scene?.tokens.find(t => t.actorId === actor.id);

    await combat.createEmbeddedDocuments("Combatant", [{
      actorId: actor.id,
      name: actor.name,
      img: actor.img,
      group: targetGroup,
      type: "conflict",
      tokenId: token?.id ?? null,
      sceneId: token?.parent?.id ?? null
    }]);
  }

  /* -------------------------------------------- */

  /**
   * Resolve the target group for an actor based on their stored team preference.
   */
  #resolveGroupForActor(combat, actor) {
    const team = actor.system?.conflict?.team;
    if ( !team ) return null;
    const groups = Array.from(combat.groups);
    if ( groups.length < 2 ) return null;
    return team === "party" ? groups[0].id : groups[1].id;
  }

  /* -------------------------------------------- */

  /**
   * Handle manual action config changes (type or key dropdown).
   */
  async #onManualActionChange(event) {
    const combat = this.#getCombat();
    if ( !combat ) return;

    const manualActions = foundry.utils.deepClone(combat.system.manualActions || {});
    // Read all action rows from the DOM.
    for ( const row of this.element.querySelectorAll(".manual-action-row") ) {
      const actionKey = row.dataset.actionKey;
      const type = row.querySelector(".manual-action-type")?.value || "ability";
      const key = row.querySelector(".manual-action-key")?.value || "";
      manualActions[actionKey] = { type, keys: key ? [key] : [] };
    }
    await combat.update({ "system.manualActions": manualActions });
  }

  /* -------------------------------------------- */

  /**
   * Start a new round.
   * @this {ConflictPanel}
   */
  static async #onNextRound() {
    const combat = this.#getCombat();
    if ( combat ) {
      this.#pendingSelections.clear();
      this.#collapsedGroups.clear();
      this.#collapseInitRound = 0;
      await combat.advanceRound();
      this.#activeTab = "weapons";
    }
  }

  /* -------------------------------------------- */

  /**
   * End the conflict.
   * @this {ConflictPanel}
   */
  static async #onEndConflict() {
    const combat = this.#getCombat();
    if ( !combat ) return;

    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("TB2E.Conflict.EndConflict") },
      content: `<p>${game.i18n.localize("TB2E.Conflict.EndConflictConfirm")}</p>`,
      yes: { default: true }
    });
    if ( !confirmed ) return;

    // Post compromise chat card before deleting.
    const groups = Array.from(combat.groups);
    const endState = combat.checkConflictEnd();
    let winnerName = "";
    let compromise = null;
    if ( endState.tie ) {
      winnerName = game.i18n.localize("TB2E.Roll.Tied");
    } else if ( endState.winnerGroupId ) {
      const winnerGroup = combat.groups.get(endState.winnerGroupId);
      winnerName = winnerGroup?.name || "???";
      const comp = combat.calculateCompromise(endState.winnerGroupId);
      const levelKey = comp.level.charAt(0).toUpperCase() + comp.level.slice(1);
      compromise = {
        level: comp.level,
        label: game.i18n.localize(`TB2E.Conflict.Compromise.${levelKey}`)
      };
    } else {
      // No side at 0 — GM is ending early.
      winnerName = game.i18n.localize("TB2E.Conflict.EndConflict");
    }

    const teams = groups.map(g => {
      const members = combat.combatants.filter(c => c._source.group === g.id);
      let remaining = 0, starting = 0;
      for ( const c of members ) {
        const actor = game.actors.get(c.actorId);
        remaining += actor?.system.conflict?.hp?.value || 0;
        starting += actor?.system.conflict?.hp?.max || 0;
      }
      return { name: g.name, remaining, starting };
    });

    const cardHtml = await foundry.applications.handlebars.renderTemplate(
      "systems/tb2e/templates/chat/conflict-compromise.hbs", {
        winnerName,
        compromise,
        teams
      }
    );
    await ChatMessage.create({
      content: cardHtml,
      type: CONST.CHAT_MESSAGE_STYLES.OTHER
    });

    this.close();
    await combat.endConflict();
  }
}
