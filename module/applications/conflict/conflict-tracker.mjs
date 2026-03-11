import ConflictPanel from "./conflict-panel.mjs";

const CombatTracker = foundry.applications.sidebar.tabs.CombatTracker;

/**
 * Slim read-only scoreboard sidebar for Torchbearer 2E conflicts.
 * Shows team disposition bars and combatant HP at a glance.
 * All interactive conflict management (disposition, scripting, etc.) lives in the ConflictPanel.
 */
export default class ConflictTracker extends CombatTracker {

  #actorUpdateHookId = null;
  #combatantUpdateHookId = null;

  /** @override */
  static DEFAULT_OPTIONS = {
    actions: {
      createConflict: ConflictTracker.#onCreateConflict,
      endConflict: ConflictTracker.#onEndConflict,
      openPanel: ConflictTracker.#onOpenPanel,
      setCaptain: ConflictTracker.#onSetCaptain,
      removeCombatant: ConflictTracker.#onRemoveCombatant
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
    this.#combatantUpdateHookId = Hooks.on("updateCombatant", (combatant) => {
      const combat = this.viewed;
      if ( !combat?.isConflict ) return;
      if ( combatant.combat?.id === combat.id ) this.render({ parts: ["tracker"] });
    });
  }

  /* -------------------------------------------- */

  /** @override */
  async _onClose(options) {
    if ( this.#actorUpdateHookId != null ) {
      Hooks.off("updateActor", this.#actorUpdateHookId);
      this.#actorUpdateHookId = null;
    }
    if ( this.#combatantUpdateHookId != null ) {
      Hooks.off("updateCombatant", this.#combatantUpdateHookId);
      this.#combatantUpdateHookId = null;
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
      const conflictCfg = combat.getEffectiveConflictConfig();
      context.conflictTypeLabel = game.i18n.localize(conflictCfg?.label ?? "TB2E.Conflict.Title");
      context.phase = combat.system.phase;
      context.isSetup = combat.system.phase === "setup";
    } else {
      context.conflictTypeLabel = "";
      context.phase = null;
      context.isSetup = false;
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
   */
  async #prepareConflictTrackerContext(context, options) {
    const combat = this.viewed;
    if ( !combat?.isConflict ) return;

    const gd = combat.system.groupDispositions || {};

    context.groups = [];
    for ( const group of combat.groups ) {
      const groupData = gd[group.id] || {};
      const members = combat.combatants.filter(c => c._source.group === group.id);

      const combatants = [];
      let currentDisp = 0;
      let maxDisp = 0;
      let hasDisposition = false;

      for ( const c of members ) {
        const actor = game.actors.get(c.actorId);
        const disp = actor?.system.conflict?.hp || { value: 0, max: 0 };
        const isCaptain = groupData.captainId === c.id;

        if ( disp.max > 0 ) hasDisposition = true;
        currentDisp += disp.value;
        maxDisp += disp.max;

        combatants.push({
          id: c.id,
          actorId: c.actorId,
          name: c.name,
          img: await this._getCombatantThumbnail(c),
          isCaptain,
          weapon: c.system.weapon || actor?.system.conflict?.weapon || "",
          knockedOut: c.system.knockedOut,
          hasHP: disp.max > 0,
          hp: disp,
          hpPercent: disp.max > 0 ? Math.round((disp.value / disp.max) * 100) : 0
        });
      }

      context.groups.push({
        id: group.id,
        name: group.name,
        combatants,
        captainId: groupData.captainId || null,
        hasDisposition,
        currentDisposition: currentDisp,
        maxDisposition: maxDisp,
        dispPercent: maxDisp > 0 ? Math.round((currentDisp / maxDisp) * 100) : 0,
        canSetCaptain: context.isGM && context.isSetup
      });
    }

    // Available actors for adding to groups.
    const existingActorIds = new Set(combat.combatants.map(c => c.actorId));
    context.availableActors = game.actors
      .filter(a => (a.type === "character" || a.type === "npc") && !existingActorIds.has(a.id))
      .map(a => ({ id: a.id, name: a.name }));
  }

  /* -------------------------------------------- */

  /**
   * Prepare footer context with phase-appropriate controls.
   */
  #prepareFooterContext(context) {
    // No additional context needed — conflict type is set in the playbook.
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
  _getEntryContextOptions() {
    const getCombatant = li => this.viewed?.combatants.get(li.dataset.combatantId);

    return [
      {
        name: "COMBAT.CombatantRemove",
        icon: '<i class="fa-solid fa-trash"></i>',
        condition: () => game.user.isGM,
        callback: li => getCombatant(li)?.delete()
      },
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
      {
        name: "COMBAT.Delete",
        icon: '<i class="fa-solid fa-trash"></i>',
        condition: () => game.user.isGM && !!this.viewed && this.viewed.isConflict,
        callback: () => this.viewed.endCombat()
      },
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
    await Combat.implementation.createConflict();
  }

  /* -------------------------------------------- */

  /**
   * Set a combatant as captain of their group.
   * @this {ConflictTracker}
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
   */
  static async #onRemoveCombatant(event, target) {
    const combatantId = target.closest("[data-combatant-id]")?.dataset.combatantId;
    const combatant = this.viewed?.combatants.get(combatantId);
    if ( combatant ) await combatant.delete();
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
   * Open the Conflict Panel (playbook).
   * @this {ConflictTracker}
   */
  static async #onOpenPanel() {
    ConflictPanel.getInstance().render({ force: true });
  }

  /* -------------------------------------------- */

  /**
   * Resolve the group for an actor based on their stored team preference.
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

    // Prevent duplicates (matches the check in #onDropActor).
    if ( combat.combatants.find(c => c.actorId === actor.id) ) {
      ui.notifications.warn(game.i18n.localize("TB2E.Conflict.AlreadyInConflict"));
      select.value = "";
      return;
    }

    const targetGroup = this.#resolveGroupForActor(combat, actor) ?? groupId;

    // Link the token so Foundry's token HUD toggle stays in sync.
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
   * Handle dropping an actor onto a group.
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

    if ( combat.combatants.find(c => c.actorId === actor.id) ) {
      ui.notifications.warn(game.i18n.localize("TB2E.Conflict.AlreadyInConflict"));
      return;
    }

    const targetGroup = this.#resolveGroupForActor(combat, actor) ?? groupId;

    // Link the token so Foundry's token HUD toggle stays in sync.
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
}
