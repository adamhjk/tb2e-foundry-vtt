import { rollDisposition, evaluateRoll, gatherHelpModifiers } from "../../dice/tb2e-roll.mjs";
import { getEligibleHelpers } from "../../dice/help.mjs";
import ConflictWindow from "./conflict-window.mjs";

const CombatTracker = foundry.applications.sidebar.tabs.CombatTracker;

/**
 * Custom sidebar tracker for Torchbearer 2E conflicts.
 * Replaces the standard CombatTracker with conflict-specific UI.
 */
export default class ConflictTracker extends CombatTracker {

  #actorUpdateHookId = null;

  /** @override */
  static DEFAULT_OPTIONS = {
    actions: {
      createConflict: ConflictTracker.#onCreateConflict,
      beginRolling: ConflictTracker.#onBeginRolling,
      chooseSkill: ConflictTracker.#onChooseSkill,
      rollGroupDisposition: ConflictTracker.#onRollGroupDisposition,
      distributeDisposition: ConflictTracker.#onDistributeDisposition,
      endConflict: ConflictTracker.#onEndConflict,
      setCaptain: ConflictTracker.#onSetCaptain,
      removeCombatant: ConflictTracker.#onRemoveCombatant,
      toggleHelper: ConflictTracker.#onToggleHelper,
      runConflict: ConflictTracker.#onRunConflict
    }
  };

  /** @override */
  static PARTS = {
    header: {
      template: "systems/tb2e/templates/conflict/tracker-header.hbs"
    },
    tracker: {
      template: "systems/tb2e/templates/conflict/tracker-body.hbs",
      scrollable: [""]
    },
    footer: {
      template: "systems/tb2e/templates/conflict/tracker-footer.hbs"
    }
  };

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  /** @override */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this.#actorUpdateHookId = Hooks.on("updateActor", (actor) => {
      const combat = this.viewed;
      if ( !combat?.isConflict ) return;
      const isCombatant = combat.combatants.some(c => c.actorId === actor.id);
      if ( isCombatant ) this.render({ parts: ["tracker"] });
    });
  }

  /* -------------------------------------------- */

  /** @override */
  async _onClose(options) {
    if ( this.#actorUpdateHookId != null ) {
      Hooks.off("updateActor", this.#actorUpdateHookId);
      this.#actorUpdateHookId = null;
    }
    await super._onClose(options);
  }

  /* -------------------------------------------- */
  /*  Context Preparation                         */
  /* -------------------------------------------- */

  /** @override */
  async _preparePartContext(partId, context, options) {
    context = { ...context };
    const combat = this.viewed;
    const isConflict = combat?.isConflict;
    context.isGM = game.user.isGM;
    context.hasCombat = combat !== null;

    if ( isConflict ) {
      const conflictCfg = CONFIG.TB2E.conflictTypes[combat.system.conflictType];
      context.conflictTypeLabel = game.i18n.localize(conflictCfg?.label ?? "TB2E.Conflict.Title");
      context.phase = combat.system.phase;
      context.isSetup = combat.system.phase === "setup";
      context.isRolling = combat.system.phase === "rolling";
      context.isDistribution = combat.system.phase === "distribution";
      context.isActive = combat.system.phase === "active";
    } else {
      context.conflictTypeLabel = "";
      context.phase = null;
      context.isSetup = false;
      context.isRolling = false;
      context.isDistribution = false;
      context.isActive = false;
    }

    switch ( partId ) {
      case "header":
        await this._prepareCombatContext(context, options);
        break;
      case "tracker":
        await this.#prepareConflictTrackerContext(context, options);
        break;
      case "footer":
        this.#prepareFooterContext(context);
        break;
    }
    return context;
  }

  /* -------------------------------------------- */

  /**
   * Prepare the main conflict tracker context with group and combatant data.
   * @param {object} context
   * @param {object} options
   */
  async #prepareConflictTrackerContext(context, options) {
    const combat = this.viewed;
    if ( !combat?.isConflict ) return;

    const gd = combat.system.groupDispositions || {};
    const conflictCfg = CONFIG.TB2E.conflictTypes[combat.system.conflictType];

    // Build group data.
    context.groups = [];
    for ( const group of combat.groups ) {
      const groupData = gd[group.id] || {};
      const members = combat.combatants.filter(c => c._source.group === group.id);

      // Derive chosenSkill from the captain's combatant data.
      const captain = groupData.captainId ? combat.combatants.get(groupData.captainId) : null;
      const chosenSkill = captain?.system.chosenSkill || null;

      const combatants = [];
      let currentDisp = 0;
      let maxDisp = 0;
      let hasDisposition = false;

      // Determine if this user can interact with this group's controls (captain/GM).
      const captainActorId = captain?.actorId ?? null;
      const canInteract = game.user.isGM || game.user.character?.id === captainActorId;

      for ( const c of members ) {
        const actor = game.actors.get(c.actorId);
        const disp = actor?.system.conflict?.hp || { value: 0, max: 0 };
        const isCaptain = groupData.captainId === c.id;

        if ( disp.max > 0 ) hasDisposition = true;
        currentDisp += disp.value;
        maxDisp += disp.max;

        // Rolling-phase help data (read from combatant.system)
        const skillRating = (chosenSkill && actor) ? (actor.system.skills[chosenSkill]?.rating || 0) : 0;
        const canHelp = !isCaptain && !!chosenSkill && skillRating > 0 && groupData.rolled == null;
        const isHelping = c.system.isHelping;

        // Per-combatant toggle permission: captain/GM can toggle anyone, players can toggle their own.
        const isOwnedByUser = game.user.character?.id === c.actorId;
        const canToggle = canInteract || isOwnedByUser;

        combatants.push({
          id: c.id,
          actorId: c.actorId,
          name: c.name,
          img: await this._getCombatantThumbnail(c),
          isCaptain,
          canHelp,
          isHelping,
          canToggle,
          hasHP: disp.max > 0,
          hp: disp,
          hpPercent: disp.max > 0 ? Math.round((disp.value / disp.max) * 100) : 0
        });
      }

      // Derive helpers and roll pool from combatant data.
      const helpers = members.filter(c => c.system.isHelping && c.id !== groupData.captainId);
      const captainActor = captain ? game.actors.get(captain.actorId) : null;
      const rollPool = chosenSkill && captainActor
        ? (captainActor.system.skills[chosenSkill]?.rating || 0) + helpers.length
        : null;

      // Build skill options for the rolling phase.
      let skillOptions = [];
      if ( context.isRolling && conflictCfg && !chosenSkill ) {
        const actor = captain ? game.actors.get(captain.actorId) : null;
        skillOptions = (conflictCfg.dispositionSkills || []).map(k => ({
          key: k,
          label: game.i18n.localize(CONFIG.TB2E.skills[k]?.label || k),
          rating: actor?.system.skills[k]?.rating || 0
        }));
      }

      // Build distribution rows for the distribution phase.
      let distributionRows = [];
      if ( context.isDistribution && groupData.rolled != null && !groupData.distributed ) {
        const total = groupData.rolled;
        const base = Math.floor(total / (members.length || 1));
        let remainder = total - (base * (members.length || 1));
        distributionRows = members.map(c => {
          const suggested = base + (remainder > 0 ? 1 : 0);
          if ( remainder > 0 ) remainder--;
          const isCaptain = groupData.captainId === c.id;
          return {
            id: c.id,
            name: c.name,
            isCaptain,
            suggested
          };
        });
      }

      context.groups.push({
        id: group.id,
        name: group.name,
        combatants,
        captainId: groupData.captainId || null,
        rolled: groupData.rolled ?? null,
        chosenSkill,
        rollPool,
        diceResults: groupData.diceResults || null,
        cardHtml: groupData.cardHtml || null,
        hasRolled: groupData.rolled != null,
        distributed: !!groupData.distributed,
        hasDisposition,
        currentDisposition: currentDisp,
        maxDisposition: maxDisp,
        canSetCaptain: context.isGM && context.isSetup,
        canInteract,
        skillOptions,
        distributionRows
      });
    }

    // Available actors for adding to groups (exclude those already in the conflict).
    const existingActorIds = new Set(combat.combatants.map(c => c.actorId));
    context.availableActors = game.actors
      .filter(a => a.type === "character" && !existingActorIds.has(a.id))
      .map(a => ({ id: a.id, name: a.name }));
  }

  /* -------------------------------------------- */

  /**
   * Prepare footer context with phase-appropriate controls.
   * @param {object} context
   */
  #prepareFooterContext(context) {
    // Build conflict type options for the create dropdown (shown when no combat exists).
    if ( !context.hasCombat ) {
      context.conflictTypes = Object.entries(CONFIG.TB2E.conflictTypes).map(([key, cfg]) => ({
        key,
        label: game.i18n.localize(cfg.label)
      }));
      return;
    }

    const combat = this.viewed;
    if ( !combat?.isConflict ) return;

    // Can begin rolling if: in setup phase and all groups have captains.
    const gd = combat.system.groupDispositions || {};
    const groups = Array.from(combat.groups);
    const allHaveCaptains = groups.every(g => gd[g.id]?.captainId);
    context.canBeginRolling = context.isSetup && allHaveCaptains;
  }

  /* -------------------------------------------- */
  /*  Event Listeners                             */
  /* -------------------------------------------- */

  /** @override */
  _attachFrameListeners() {
    super._attachFrameListeners();

    // Handle adding combatants via select dropdown.
    this.element.addEventListener("change", (event) => {
      if ( event.target.classList.contains("add-combatant-select") ) {
        this.#onAddCombatant(event);
      }
    });

    // Handle drag-and-drop of actors onto groups.
    this.element.addEventListener("dragover", (event) => {
      const groupEl = event.target.closest("[data-group-id]");
      if ( groupEl ) event.preventDefault();
    });
    this.element.addEventListener("drop", (event) => {
      this.#onDropActor(event);
    });
  }

  /* -------------------------------------------- */

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);

    // Attach live validation for distribution inputs.
    const distributionSections = this.element.querySelectorAll(".group-distribution");
    for ( const section of distributionSections ) {
      const inputs = section.querySelectorAll(".disposition-value");
      const remainingEl = section.querySelector(".remaining-value");
      const total = parseInt(section.dataset.total) || 0;

      function updateRemaining() {
        let sum = 0;
        for ( const input of inputs ) sum += parseInt(input.value) || 0;
        const remaining = total - sum;
        remainingEl.textContent = remaining;
        remainingEl.classList.toggle("invalid", remaining !== 0);
      }

      for ( const input of inputs ) {
        input.addEventListener("change", updateRemaining);
        input.addEventListener("input", updateRemaining);
      }
    }
  }

  /* -------------------------------------------- */

  /** @override */
  _getEntryContextOptions() {
    const getCombatant = li => this.viewed?.combatants.get(li.dataset.combatantId);

    return [
      // --- Conflict-only entries ---
      {
        name: "COMBAT.CombatantRemove",
        icon: '<i class="fa-solid fa-trash"></i>',
        condition: () => game.user.isGM,
        callback: li => getCombatant(li)?.delete()
      },
      // --- Non-conflict fallbacks (hidden during conflicts) ---
      ...super._getEntryContextOptions().map(entry => {
        const orig = entry.condition;
        return { ...entry, condition: (...args) =>
          !this.viewed?.isConflict && (orig ? orig(...args) : true)
        };
      })
    ];
  }

  /* -------------------------------------------- */

  /** @override */
  _getCombatContextOptions() {
    return [
      // --- Conflict-only entries ---
      {
        name: "COMBAT.Delete",
        icon: '<i class="fa-solid fa-trash"></i>',
        condition: () => game.user.isGM && !!this.viewed && this.viewed.isConflict,
        callback: () => this.viewed.endCombat()
      },
      // --- Non-conflict fallbacks (hidden during conflicts) ---
      ...super._getCombatContextOptions().map(entry => {
        const orig = entry.condition;
        return { ...entry, condition: (...args) =>
          !this.viewed?.isConflict && (orig ? orig(...args) : true)
        };
      })
    ];
  }

  /* -------------------------------------------- */
  /*  Action Handlers                             */
  /* -------------------------------------------- */

  /**
   * Create a new conflict encounter.
   * @this {ConflictTracker}
   */
  static async #onCreateConflict(event, target) {
    const select = this.element.querySelector(".conflict-type-select");
    const conflictType = select?.value || "kill";
    const combat = await Combat.implementation.createConflict(conflictType);
    combat.activate({ render: false });
  }

  /* -------------------------------------------- */

  /**
   * Set a combatant as captain of their group.
   * @this {ConflictTracker}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onSetCaptain(event, target) {
    const combatantId = target.closest("[data-combatant-id]")?.dataset.combatantId;
    const groupId = target.closest("[data-group-id]")?.dataset.groupId;
    if ( combatantId && groupId ) {
      await this.viewed.setCaptain(groupId, combatantId);
    }
  }

  /* -------------------------------------------- */

  /**
   * Remove a combatant from the conflict.
   * @this {ConflictTracker}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onRemoveCombatant(event, target) {
    const combatantId = target.closest("[data-combatant-id]")?.dataset.combatantId;
    const combatant = this.viewed?.combatants.get(combatantId);
    if ( combatant ) await combatant.delete();
  }

  /* -------------------------------------------- */

  /**
   * Transition to the rolling phase.
   * @this {ConflictTracker}
   */
  static async #onBeginRolling() {
    const combat = this.viewed;
    if ( !combat?.isConflict ) return;
    await combat.beginRolling();
  }

  /* -------------------------------------------- */

  /**
   * Choose a disposition skill for a group.
   * @this {ConflictTracker}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onChooseSkill(event, target) {
    const combat = this.viewed;
    if ( !combat?.isConflict ) return;
    const groupId = target.closest("[data-group-id]")?.dataset.groupId;
    const skillKey = target.dataset.skill;
    if ( groupId && skillKey ) {
      await combat.chooseSkill(groupId, skillKey);
    }
  }

  /* -------------------------------------------- */

  /**
   * Roll disposition for a group via the standard roll dialog.
   * @this {ConflictTracker}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onRollGroupDisposition(event, target) {
    const combat = this.viewed;
    if ( !combat?.isConflict ) return;
    const groupId = target.closest("[data-group-id]")?.dataset.groupId;
    if ( !groupId ) return;

    const gd = combat.system.groupDispositions?.[groupId];
    if ( !gd?.captainId ) return;

    // Read chosenSkill from the captain's combatant data.
    const captain = combat.combatants.get(gd.captainId);
    const chosenSkill = captain?.system.chosenSkill;
    if ( !chosenSkill ) return;

    const conflictCfg = CONFIG.TB2E.conflictTypes[combat.system.conflictType];
    const actor = captain ? game.actors.get(captain.actorId) : null;
    if ( !actor ) return;

    // Build available helpers using centralized help logic
    const members = combat.combatants.filter(c => c._source.group === groupId);
    const memberActors = members
      .filter(c => c.id !== gd.captainId)
      .map(c => game.actors.get(c.actorId))
      .filter(Boolean);
    const eligible = getEligibleHelpers({
      actor,
      type: "skill",
      key: chosenSkill,
      testContext: { isConflict: true },
      candidates: memberActors
    });
    // Map back to combatant IDs and preserve preSelected state
    const availableHelpers = eligible.map(h => {
      const combatant = members.find(c => c.actorId === h.id);
      return {
        id: combatant?.id ?? h.id,
        name: h.name,
        helpVia: h.helpVia,
        helpViaLabel: h.helpViaLabel,
        warnings: h.warnings,
        preSelected: combatant?.system.isHelping ?? false
      };
    });

    const result = await rollDisposition({
      actor,
      skillKey: chosenSkill,
      abilityKey: conflictCfg.dispositionAbility,
      availableHelpers
    });
    if ( !result ) return;

    // Sync helper selections back to combatant data
    const selectedIds = (result.selectedHelpers || [])
      .map(h => availableHelpers.find(a => a.name === h.name)?.id)
      .filter(Boolean);
    const selectedSet = new Set(selectedIds);
    const helperUpdates = availableHelpers
      .filter(h => h.preSelected !== selectedSet.has(h.id))
      .map(h => ({ _id: h.id, "system.isHelping": selectedSet.has(h.id) }));
    if ( helperUpdates.length ) {
      await combat.updateEmbeddedDocuments("Combatant", helperUpdates);
    }

    // Roll the dice
    const { roll, successes, diceResults } = await evaluateRoll(result.poolSize);

    // Final disposition = successes + ability rating
    const disposition = successes + result.abilityRating;

    // Build modifiers for card display (conditions + selected helpers)
    const helpMods = gatherHelpModifiers(result.selectedHelpers || []);
    const allModifiers = [...result.modifiers, ...helpMods];

    // Render roll card
    const group = combat.groups.get(groupId);
    const cardHtml = await foundry.applications.handlebars.renderTemplate(
      "systems/tb2e/templates/chat/roll-result.hbs", {
        actorName: actor.name, actorImg: actor.img,
        label: result.label, baseDice: result.baseDice, poolSize: result.poolSize,
        successes, modifiers: allModifiers, diceResults,
        isDisposition: true, disposition,
        abilityLabel: result.abilityLabel, abilityRating: result.abilityRating,
        conflictTypeLabel: game.i18n.localize(conflictCfg.label),
        conflictTitle: game.i18n.localize("TB2E.Conflict.Title"),
        groupName: group?.name ?? "",
        successesLabel: game.i18n.localize("TB2E.Roll.Successes"),
        testLabel: game.i18n.localize("TB2E.Roll.Test"),
        testTypeLabel: game.i18n.localize("TB2E.Conflict.Disposition"),
        dispositionLabel: game.i18n.localize("TB2E.Conflict.Disposition")
      }
    );

    // Create ChatMessage
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: cardHtml, rolls: [roll],
      type: CONST.CHAT_MESSAGE_STYLES.OTHER
    });

    // Store in combat data via socket relay (disposition = successes + ability)
    await combat.requestStoreDispositionRoll(groupId, { rolled: disposition, diceResults, cardHtml });
  }

  /* -------------------------------------------- */

  /**
   * Distribute disposition points for a group from inline inputs.
   * @this {ConflictTracker}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onDistributeDisposition(event, target) {
    const combat = this.viewed;
    if ( !combat?.isConflict ) return;
    const groupId = target.closest("[data-group-id]")?.dataset.groupId;
    if ( !groupId ) return;

    const gd = combat.system.groupDispositions?.[groupId];
    if ( !gd?.rolled ) return;
    const total = gd.rolled;

    // Read distribution values from inputs.
    const section = target.closest(".group-distribution");
    const distribution = {};
    const inputs = section.querySelectorAll(".disposition-value");
    for ( const input of inputs ) {
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
   * End the current conflict.
   * @this {ConflictTracker}
   */
  static async #onEndConflict() {
    const combat = this.viewed;
    if ( !combat?.isConflict ) return;

    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("TB2E.Conflict.EndConflict") },
      content: `<p>${game.i18n.localize("TB2E.Conflict.EndConflictConfirm")}</p>`,
      yes: { default: true }
    });

    if ( confirmed ) await combat.endConflict();
  }

  /* -------------------------------------------- */

  /**
   * Toggle a combatant's helper status for the disposition roll.
   * @this {ConflictTracker}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onToggleHelper(event, target) {
    const combat = this.viewed;
    if ( !combat?.isConflict ) return;
    const groupId = target.closest("[data-group-id]")?.dataset.groupId;
    const combatantId = target.closest("[data-combatant-id]")?.dataset.combatantId;
    if ( groupId && combatantId ) {
      await combat.toggleHelper(groupId, combatantId);
    }
  }

  /* -------------------------------------------- */

  /**
   * Open the conflict resolution window.
   * @this {ConflictTracker}
   */
  static async #onRunConflict() {
    await ConflictWindow.open();
  }

  /* -------------------------------------------- */

  /**
   * Resolve the group for an actor based on their stored team preference.
   * @param {Combat} combat
   * @param {Actor} actor
   * @returns {string|null}
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
   * Handle adding a combatant via the select dropdown.
   * @param {Event} event
   */
  async #onAddCombatant(event) {
    const select = event.target;
    const actorId = select.value;
    const groupId = select.dataset.groupId;
    if ( !actorId || !groupId ) return;

    const combat = this.viewed;
    if ( !combat ) return;

    const actor = game.actors.get(actorId);
    if ( !actor ) return;

    const targetGroup = this.#resolveGroupForActor(combat, actor) ?? groupId;

    await combat.createEmbeddedDocuments("Combatant", [{
      actorId: actor.id,
      name: actor.name,
      img: actor.img,
      group: targetGroup,
      type: "conflict"
    }]);

    // Reset the select.
    select.value = "";
  }

  /* -------------------------------------------- */

  /**
   * Handle dropping an actor onto a group.
   * @param {DragEvent} event
   */
  async #onDropActor(event) {
    const groupEl = event.target.closest("[data-group-id]");
    if ( !groupEl ) return;
    const groupId = groupEl.dataset.groupId;

    let data;
    try {
      data = JSON.parse(event.dataTransfer.getData("text/plain"));
    } catch { return; }

    if ( data.type !== "Actor" ) return;

    const actor = await fromUuid(data.uuid);
    if ( !actor ) return;

    const combat = this.viewed;
    if ( !combat ) return;

    // Don't add duplicate combatants.
    if ( combat.combatants.find(c => c.actorId === actor.id) ) {
      ui.notifications.warn(game.i18n.localize("TB2E.Conflict.AlreadyInConflict"));
      return;
    }

    const targetGroup = this.#resolveGroupForActor(combat, actor) ?? groupId;

    await combat.createEmbeddedDocuments("Combatant", [{
      actorId: actor.id,
      name: actor.name,
      img: actor.img,
      group: targetGroup,
      type: "conflict"
    }]);
  }
}
