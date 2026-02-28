const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

/**
 * Singleton conflict resolution window for round-by-round action scripting.
 * Opens from the "Run Conflict" button in the active phase.
 */
export default class ConflictWindow extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @type {ConflictWindow|null} */
  static #instance = null;

  /** @type {number|null} */
  #updateCombatHookId = null;

  /** @type {number|null} */
  #updateActorHookId = null;

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
    position: { width: 720, height: 500 },
    actions: {
      setAction: ConflictWindow.#onSetAction,
      lockActions: ConflictWindow.#onLockActions,
      revealVolley: ConflictWindow.#onRevealVolley,
      rollVolley: ConflictWindow.#onRollVolley,
      newRound: ConflictWindow.#onNewRound,
      moveUp: ConflictWindow.#onMoveUp,
      moveDown: ConflictWindow.#onMoveDown
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
   * Auto-starts round 1 if no round is active.
   * @returns {Promise<ConflictWindow>}
   */
  static async open() {
    const combat = game.combat;
    if ( !combat?.isConflict || combat.system.phase !== "active" ) {
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

    // Build team data.
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

      // Build ordered combatant list from round data.
      const order = round?.orders[group.id] || members.map(c => c.id);
      const orderedCombatants = order.map((cId, idx) => {
        const c = combat.combatants.get(cId);
        if ( !c ) return null;
        const actor = game.actors.get(c.actorId);
        return {
          id: c.id,
          name: c.name,
          img: actor?.img || c.img,
          index: idx,
          canMoveUp: idx > 0,
          canMoveDown: idx < order.length - 1
        };
      }).filter(Boolean);

      // Build volley data.
      const volleys = [];
      for ( let v = 0; v < 3; v++ ) {
        const actingId = combat.getActingCombatant(group.id, roundNum, v);
        const actingCombatant = actingId ? combat.combatants.get(actingId) : null;
        const actingActor = actingCombatant ? game.actors.get(actingCombatant.actorId) : null;
        const selectedAction = round?.actions[group.id]?.[v] || null;
        const isRevealed = round?.revealed[v] || false;
        const isLocked = round?.locked[group.id] || false;
        const result = round?.results[v] || null;

        // Build action buttons.
        const actionButtons = Object.entries(CONFIG.TB2E.conflictActions).map(([key, cfg]) => ({
          key,
          label: game.i18n.localize(cfg.label),
          icon: cfg.icon,
          pip: cfg.pip,
          selected: selectedAction === key
        }));

        volleys.push({
          index: v,
          volleyNum: v + 1,
          actingName: actingCombatant?.name || "???",
          actingImg: actingActor?.img || actingCombatant?.img || null,
          selectedAction,
          selectedActionLabel: selectedAction ? game.i18n.localize(CONFIG.TB2E.conflictActions[selectedAction]?.label) : null,
          selectedActionIcon: selectedAction ? CONFIG.TB2E.conflictActions[selectedAction]?.icon : null,
          selectedActionPip: selectedAction ? CONFIG.TB2E.conflictActions[selectedAction]?.pip : null,
          isRevealed,
          isLocked,
          hasResult: result !== null,
          result,
          actionButtons
        });
      }

      // Can this user interact with this team?
      const captainActorId = (() => {
        if ( !groupData.captainId ) return null;
        const captain = combat.combatants.get(groupData.captainId);
        return captain?.actorId ?? null;
      })();
      const canInteract = game.user.isGM || game.user.character?.id === captainActorId;
      const isLocked = round?.locked[group.id] || false;

      teams.push({
        id: group.id,
        name: group.name,
        currentDisp,
        maxDisp,
        orderedCombatants,
        volleys,
        canInteract,
        isLocked,
        canLock: canInteract && !isLocked && round?.actions[group.id]?.every(a => a)
      });
    }

    // Determine if all teams are locked (for reveal buttons).
    const allLocked = round ? Object.values(round.locked).every(v => v) : false;

    // All volleys revealed and have results? → can start new round.
    const allRevealed = round?.revealed.every(v => v) || false;

    return {
      hasConflict: true,
      roundNum,
      conflictTypeLabel: game.i18n.localize(conflictCfg?.label ?? "TB2E.Conflict.Title"),
      teams,
      allLocked,
      allRevealed,
      isGM: game.user.isGM,
      volleyLabels: [1, 2, 3].map(n => `${game.i18n.localize("TB2E.Conflict.Volley")} ${n}`)
    };
  }

  /* -------------------------------------------- */
  /*  Action Handlers                              */
  /* -------------------------------------------- */

  /**
   * Select an action for a volley.
   * @this {ConflictWindow}
   */
  static async #onSetAction(event, target) {
    const combat = game.combat;
    if ( !combat?.isConflict ) return;
    const groupId = target.closest("[data-group-id]")?.dataset.groupId;
    const volleyIndex = Number(target.closest("[data-volley]")?.dataset.volley);
    const actionKey = target.dataset.actionKey;
    if ( groupId && actionKey && !isNaN(volleyIndex) ) {
      await combat.setAction(groupId, volleyIndex, actionKey);
    }
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
   * Roll for a volley (placeholder — opens notification for now).
   * @this {ConflictWindow}
   */
  static async #onRollVolley(event, target) {
    const combat = game.combat;
    if ( !combat?.isConflict ) return;
    const volleyIndex = Number(target.closest("[data-volley]")?.dataset.volley);
    if ( isNaN(volleyIndex) ) return;

    // Store a simple placeholder result.
    await combat.storeVolleyResult(volleyIndex, { rolled: true });
    ui.notifications.info(`Volley ${volleyIndex + 1} rolled.`);
  }

  /**
   * Start a new round.
   * @this {ConflictWindow}
   */
  static async #onNewRound(event, target) {
    const combat = game.combat;
    if ( !combat?.isConflict ) return;
    if ( game.user.isGM ) await combat.startConflictRound();
  }

  /**
   * Move a combatant up in the team order.
   * @this {ConflictWindow}
   */
  static async #onMoveUp(event, target) {
    const combat = game.combat;
    if ( !combat?.isConflict ) return;
    const groupId = target.closest("[data-group-id]")?.dataset.groupId;
    const combatantId = target.closest("[data-combatant-id]")?.dataset.combatantId;
    if ( !groupId || !combatantId ) return;

    const roundNum = combat.system.currentRound;
    const round = combat.system.rounds?.[roundNum];
    if ( !round || round.locked[groupId] ) return;

    const order = [...round.orders[groupId]];
    const idx = order.indexOf(combatantId);
    if ( idx <= 0 ) return;
    [order[idx - 1], order[idx]] = [order[idx], order[idx - 1]];
    await combat.setTeamOrder(groupId, order);
  }

  /**
   * Move a combatant down in the team order.
   * @this {ConflictWindow}
   */
  static async #onMoveDown(event, target) {
    const combat = game.combat;
    if ( !combat?.isConflict ) return;
    const groupId = target.closest("[data-group-id]")?.dataset.groupId;
    const combatantId = target.closest("[data-combatant-id]")?.dataset.combatantId;
    if ( !groupId || !combatantId ) return;

    const roundNum = combat.system.currentRound;
    const round = combat.system.rounds?.[roundNum];
    if ( !round || round.locked[groupId] ) return;

    const order = [...round.orders[groupId]];
    const idx = order.indexOf(combatantId);
    if ( idx < 0 || idx >= order.length - 1 ) return;
    [order[idx], order[idx + 1]] = [order[idx + 1], order[idx]];
    await combat.setTeamOrder(groupId, order);
  }
}
