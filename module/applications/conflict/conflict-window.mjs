import { getInteraction } from "../../dice/conflict-roll.mjs";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

/**
 * Singleton conflict resolution window for round-by-round action scripting.
 * Handles the scripting → resolution cycle each round.
 */
export default class ConflictWindow extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @type {ConflictWindow|null} */
  static #instance = null;

  /** @type {number|null} */
  #updateCombatHookId = null;

  /** @type {number|null} */
  #updateActorHookId = null;

  /** @type {number|null} */
  #updateCombatantHookId = null;

  /** @type {Set<string>} Group IDs the GM is currently peeking at */
  #peekingTeams = new Set();

  /* -------------------------------------------- */

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "tb2e-conflict-window",
    classes: ["tb2e", "conflict-window"],
    window: {
      frame: true,
      positioned: true,
      title: "TB2E.Conflict.Title",
      icon: "fa-solid fa-shield-halved",
      resizable: true,
      minimizable: true
    },
    position: { width: 780, height: 560 },
    actions: {
      setVolleyAction: ConflictWindow.#onSetVolleyAction,
      setVolleyCombatant: ConflictWindow.#onSetVolleyCombatant,
      lockActions: ConflictWindow.#onLockActions,
      revealVolley: ConflictWindow.#onRevealVolley,
      rollVolley: ConflictWindow.#onRollVolley,
      applyDamage: ConflictWindow.#onApplyDamage,
      newRound: ConflictWindow.#onNewRound,
      endConflict: ConflictWindow.#onEndConflict,
      togglePeek: ConflictWindow.#onTogglePeek
    }
  };

  /** @override */
  static PARTS = {
    content: {
      template: "systems/tb2e/templates/conflict/conflict-window.hbs",
      scrollable: [""]
    }
  };

  /* -------------------------------------------- */
  /*  Singleton Access                             */
  /* -------------------------------------------- */

  /**
   * Open the conflict window (or focus if already open).
   * Auto-starts round 1 if entering scripting with no round active.
   * @returns {Promise<ConflictWindow>}
   */
  static async open() {
    const combat = game.combat;
    if ( !combat?.isConflict ) {
      ui.notifications.warn(game.i18n.localize("TB2E.Conflict.NoConflict"));
      return null;
    }

    const validPhases = ["scripting", "active"];
    if ( !validPhases.includes(combat.system.phase) ) {
      ui.notifications.warn(game.i18n.localize("TB2E.Conflict.NoConflict"));
      return null;
    }

    // Auto-start round 1 if needed.
    if ( game.user.isGM && (combat.system.currentRound || 0) === 0 ) {
      await combat.startConflictRound();
    }

    if ( ConflictWindow.#instance ) {
      ConflictWindow.#instance.bringToFront();
      return ConflictWindow.#instance;
    }

    const win = new ConflictWindow();
    ConflictWindow.#instance = win;
    await win.render(true);
    return win;
  }

  /**
   * Return the current instance, if any.
   * @returns {ConflictWindow|null}
   */
  static getInstance() {
    return ConflictWindow.#instance;
  }

  /* -------------------------------------------- */
  /*  Lifecycle                                    */
  /* -------------------------------------------- */

  /** @override */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this.#updateCombatHookId = Hooks.on("updateCombat", () => this.render());
    this.#updateActorHookId = Hooks.on("updateActor", (actor) => {
      const combat = game.combat;
      if ( !combat?.isConflict ) return;
      if ( combat.combatants.some(c => c.actorId === actor.id) ) this.render();
    });
    this.#updateCombatantHookId = Hooks.on("updateCombatant", () => this.render());
  }

  /** @override */
  async _onClose(options) {
    if ( this.#updateCombatHookId != null ) {
      Hooks.off("updateCombat", this.#updateCombatHookId);
      this.#updateCombatHookId = null;
    }
    if ( this.#updateActorHookId != null ) {
      Hooks.off("updateActor", this.#updateActorHookId);
      this.#updateActorHookId = null;
    }
    if ( this.#updateCombatantHookId != null ) {
      Hooks.off("updateCombatant", this.#updateCombatantHookId);
      this.#updateCombatantHookId = null;
    }
    ConflictWindow.#instance = null;
    await super._onClose(options);
  }

  /* -------------------------------------------- */
  /*  Context Preparation                          */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const combat = game.combat;
    if ( !combat?.isConflict ) return { hasConflict: false };

    const roundNum = combat.system.currentRound || 0;
    const rounds = combat.system.rounds || {};
    const round = rounds[roundNum];
    const gd = combat.system.groupDispositions || {};
    const conflictCfg = CONFIG.TB2E.conflictTypes[combat.system.conflictType];

    const groups = Array.from(combat.groups);
    const teams = [];

    for ( const group of groups ) {
      const groupData = gd[group.id] || {};
      const members = combat.combatants.filter(c => c._source.group === group.id);

      // Current disposition totals.
      let currentDisp = 0, maxDisp = 0;
      for ( const c of members ) {
        const actor = game.actors.get(c.actorId);
        const hp = actor?.system.conflict?.hp || { value: 0, max: 0 };
        currentDisp += hp.value;
        maxDisp += hp.max;
      }

      // Build member list for combatant dropdowns.
      const memberOptions = members
        .filter(c => !c.system.knockedOut)
        .map(c => ({
          id: c.id,
          name: c.name,
          img: game.actors.get(c.actorId)?.img || c.img
        }));

      // Build volley data.
      const volleys = [];
      for ( let v = 0; v < 3; v++ ) {
        const actionEntry = round?.actions[group.id]?.[v];
        const selectedAction = actionEntry?.action || null;
        const selectedCombatantId = actionEntry?.combatantId || null;
        const selectedCombatant = selectedCombatantId ? combat.combatants.get(selectedCombatantId) : null;
        const selectedActor = selectedCombatant ? game.actors.get(selectedCombatant.actorId) : null;
        const isRevealed = round?.volleys?.[v]?.revealed || false;
        const isLocked = round?.locked?.[group.id] || false;
        const result = round?.volleys?.[v]?.result || null;

        // Build action buttons.
        const actionButtons = Object.entries(CONFIG.TB2E.conflictActions).map(([key, cfg]) => ({
          key,
          label: game.i18n.localize(cfg.label),
          icon: cfg.icon,
          pip: cfg.pip,
          selected: selectedAction === key
        }));

        // Build per-volley member options with selected flag.
        const volleyMemberOptions = memberOptions.map(m => ({
          ...m,
          selected: m.id === selectedCombatantId
        }));

        volleys.push({
          index: v,
          volleyNum: v + 1,
          selectedAction,
          selectedActionLabel: selectedAction ? game.i18n.localize(CONFIG.TB2E.conflictActions[selectedAction]?.label) : null,
          selectedActionIcon: selectedAction ? CONFIG.TB2E.conflictActions[selectedAction]?.icon : null,
          selectedActionPip: selectedAction ? CONFIG.TB2E.conflictActions[selectedAction]?.pip : null,
          selectedCombatantId,
          selectedCombatantName: selectedCombatant?.name || null,
          selectedCombatantImg: selectedActor?.img || selectedCombatant?.img || null,
          isRevealed,
          isLocked,
          hasResult: result !== null,
          result,
          actionButtons,
          memberOptions: volleyMemberOptions
        });
      }

      // Permission: captain or GM can interact.
      const captainActorId = (() => {
        if ( !groupData.captainId ) return null;
        const captain = combat.combatants.get(groupData.captainId);
        return captain?.actorId ?? null;
      })();
      const canInteract = game.user.isGM || game.user.character?.id === captainActorId;
      const isLocked = round?.locked?.[group.id] || false;

      // Determine if this is a player-controlled team (has a non-GM captain).
      const isPlayerTeam = game.user.isGM && captainActorId &&
        game.users.some(u => !u.isGM && u.character?.id === captainActorId);
      const gmPeeking = isPlayerTeam && this.#peekingTeams.has(group.id);
      const showActions = canInteract && (!isPlayerTeam || gmPeeking);

      // Can lock: all 3 volleys must have action + combatant.
      const allSet = round?.actions[group.id]?.every(a => a?.action && a?.combatantId) || false;

      teams.push({
        id: group.id,
        name: group.name,
        currentDisp,
        maxDisp,
        volleys,
        canInteract,
        isPlayerTeam,
        gmPeeking,
        showActions,
        isLocked,
        canLock: showActions && !isLocked && allSet
      });
    }

    // Determine if all teams are locked.
    const allLocked = round ? Object.values(round.locked).every(v => v) : false;

    // Build interaction data for revealed volleys.
    const revealedVolleys = [];
    if ( allLocked && round && groups.length >= 2 ) {
      for ( let v = 0; v < 3; v++ ) {
        const volley = round.volleys?.[v];
        if ( !volley?.revealed ) continue;

        const action0 = round.actions[groups[0].id]?.[v];
        const action1 = round.actions[groups[1].id]?.[v];
        if ( !action0?.action || !action1?.action ) continue;

        const interaction0 = getInteraction(action0.action, action1.action);
        const interaction1 = getInteraction(action1.action, action0.action);

        revealedVolleys.push({
          index: v,
          volleyNum: v + 1,
          sides: [
            {
              groupId: groups[0].id,
              action: action0.action,
              actionLabel: game.i18n.localize(CONFIG.TB2E.conflictActions[action0.action]?.label),
              combatantName: combat.combatants.get(action0.combatantId)?.name || "???",
              interaction: interaction0,
              interactionLabel: game.i18n.localize(`TB2E.Conflict.Interaction.${interaction0}`)
            },
            {
              groupId: groups[1].id,
              action: action1.action,
              actionLabel: game.i18n.localize(CONFIG.TB2E.conflictActions[action1.action]?.label),
              combatantName: combat.combatants.get(action1.combatantId)?.name || "???",
              interaction: interaction1,
              interactionLabel: game.i18n.localize(`TB2E.Conflict.Interaction.${interaction1}`)
            }
          ],
          hasResult: volley.result !== null,
          result: volley.result
        });
      }
    }

    // All volleys revealed?
    const allRevealed = round?.volleys?.every(v => v.revealed) || false;
    const allResolved = round?.volleys?.every(v => v.result !== null) || false;

    return {
      hasConflict: true,
      roundNum,
      conflictTypeLabel: game.i18n.localize(conflictCfg?.label ?? "TB2E.Conflict.Title"),
      teams,
      allLocked,
      allRevealed,
      allResolved,
      revealedVolleys,
      isGM: game.user.isGM,
      phase: combat.system.phase,
      isScripting: combat.system.phase === "scripting",
      isActive: combat.system.phase === "active"
    };
  }

  /* -------------------------------------------- */
  /*  Action Handlers                              */
  /* -------------------------------------------- */

  /**
   * Select an action for a volley.
   * @this {ConflictWindow}
   */
  static async #onSetVolleyAction(event, target) {
    const combat = game.combat;
    if ( !combat?.isConflict ) return;
    const groupId = target.closest("[data-group-id]")?.dataset.groupId;
    const volleyIndex = Number(target.closest("[data-volley]")?.dataset.volley);
    const actionKey = target.dataset.actionKey;
    if ( !groupId || !actionKey || isNaN(volleyIndex) ) return;

    const roundNum = combat.system.currentRound;
    const round = combat.system.rounds?.[roundNum];
    if ( !round || round.locked?.[groupId] ) return;

    // Deep clone current actions and update this volley.
    const actions = foundry.utils.deepClone(round.actions[groupId] || [null, null, null]);
    if ( !actions[volleyIndex] ) actions[volleyIndex] = {};
    actions[volleyIndex].action = actionKey;
    await combat.setActions(groupId, actions);
  }

  /**
   * Set the acting combatant for a volley via dropdown.
   * @this {ConflictWindow}
   */
  static async #onSetVolleyCombatant(event, target) {
    const combat = game.combat;
    if ( !combat?.isConflict ) return;
    const groupId = target.closest("[data-group-id]")?.dataset.groupId;
    const volleyIndex = Number(target.closest("[data-volley]")?.dataset.volley);
    const combatantId = target.value;
    if ( !groupId || isNaN(volleyIndex) ) return;

    const roundNum = combat.system.currentRound;
    const round = combat.system.rounds?.[roundNum];
    if ( !round || round.locked?.[groupId] ) return;

    const actions = foundry.utils.deepClone(round.actions[groupId] || [null, null, null]);
    if ( !actions[volleyIndex] ) actions[volleyIndex] = {};
    actions[volleyIndex].combatantId = combatantId;
    await combat.setActions(groupId, actions);
  }

  /**
   * Lock a team's actions.
   * @this {ConflictWindow}
   */
  static async #onLockActions(event, target) {
    const combat = game.combat;
    if ( !combat?.isConflict ) return;
    const groupId = target.closest("[data-group-id]")?.dataset.groupId;
    if ( groupId ) await combat.lockActions(groupId);
  }

  /**
   * Reveal a volley (GM only).
   * @this {ConflictWindow}
   */
  static async #onRevealVolley(event, target) {
    const combat = game.combat;
    if ( !combat?.isConflict ) return;
    const volleyIndex = Number(target.dataset.volley);
    if ( !isNaN(volleyIndex) ) await combat.revealVolley(volleyIndex);
  }

  /**
   * Roll for a volley (placeholder — stores a simple result).
   * @this {ConflictWindow}
   */
  static async #onRollVolley(event, target) {
    const combat = game.combat;
    if ( !combat?.isConflict ) return;
    const volleyIndex = Number(target.closest("[data-volley]")?.dataset.volley ?? target.dataset.volley);
    if ( isNaN(volleyIndex) ) return;

    // Store a placeholder result for now.
    await combat.resolveVolley(volleyIndex, { rolled: true, timestamp: Date.now() });
    ui.notifications.info(`Volley ${volleyIndex + 1} resolved.`);
  }

  /**
   * Apply damage from a volley result (placeholder).
   * @this {ConflictWindow}
   */
  static async #onApplyDamage(event, target) {
    ui.notifications.info("Damage applied.");
  }

  /**
   * Start a new round (return to weapons phase).
   * @this {ConflictWindow}
   */
  static async #onNewRound(event, target) {
    const combat = game.combat;
    if ( !combat?.isConflict ) return;
    if ( game.user.isGM ) {
      await combat.advanceRound();
      // Close this window — tracker will show weapons phase.
      await this.close();
    }
  }

  /**
   * Toggle GM peek on a player team's actions.
   * @this {ConflictWindow}
   */
  static #onTogglePeek(event, target) {
    const groupId = target.closest("[data-group-id]")?.dataset.groupId;
    if ( !groupId ) return;
    if ( this.#peekingTeams.has(groupId) ) this.#peekingTeams.delete(groupId);
    else this.#peekingTeams.add(groupId);
    this.render();
  }

  /**
   * End the conflict from within the window.
   * @this {ConflictWindow}
   */
  static async #onEndConflict(event, target) {
    const combat = game.combat;
    if ( !combat?.isConflict || !game.user.isGM ) return;

    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("TB2E.Conflict.EndConflict") },
      content: `<p>${game.i18n.localize("TB2E.Conflict.EndConflictConfirm")}</p>`,
      yes: { default: true }
    });

    if ( confirmed ) {
      await this.close();
      await combat.endConflict();
    }
  }

  /* -------------------------------------------- */

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);

    // Attach change event listeners for combatant dropdowns.
    this.element.querySelectorAll(".cw-combatant-select").forEach(select => {
      select.addEventListener("change", (event) => {
        ConflictWindow.#onSetVolleyCombatant.call(this, event, select);
      });
    });
  }
}
