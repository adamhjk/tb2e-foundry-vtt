export default class TB2ECombat extends Combat {

  /**
   * Is this Combat a Torchbearer conflict?
   * @type {boolean}
   */
  get isConflict() {
    return this.type === "conflict";
  }

  /* -------------------------------------------- */
  /*  Factory Methods                             */
  /* -------------------------------------------- */

  /**
   * Override create to ensure all Combat creation paths produce a properly initialized conflict.
   * This handles both our "Create Conflict" button and Foundry's token "Toggle Combat State".
   * @override
   */
  static async create(data = {}, operation = {}) {
    if ( Array.isArray(data) ) return super.create(data, operation);
    data.type ??= "conflict";
    if ( data.type === "conflict" ) {
      if ( !data.system ) data.system = {};
      data.system.conflictType ??= "manual";
      data.system.phase ??= "setup";
      if ( !data.groups?.length ) {
        data.groups = [
          { name: game.i18n.localize("TB2E.Conflict.PCTeam") },
          { name: game.i18n.localize("TB2E.Conflict.NPCTeam") }
        ];
      }
    }
    return super.create(data, operation);
  }

  /**
   * Create a new conflict with two default groups.
   * @param {string} [type="manual"]  The conflict type key.
   * @returns {Promise<TB2ECombat>}
   */
  static async createConflict(type = "manual") {
    return this.create({
      type: "conflict",
      active: true,
      system: { conflictType: type, phase: "setup" }
    });
  }

  /**
   * Ensure combatants created inside a conflict always use the "conflict" type.
   * This avoids schema validation issues when changing type via updateSource after construction.
   * @override
   */
  async createEmbeddedDocuments(embeddedName, data = [], operation = {}) {
    if ( this.isConflict && embeddedName === "Combatant" ) {
      data = data.map(d => ({ type: "conflict", ...d }));
    }
    return super.createEmbeddedDocuments(embeddedName, data, operation);
  }

  /* -------------------------------------------- */
  /*  Conflict Configuration                       */
  /* -------------------------------------------- */

  /**
   * Get the effective conflict config, resolving manual overrides when applicable.
   * @returns {object} The conflict type configuration.
   */
  getEffectiveConflictConfig() {
    const baseCfg = CONFIG.TB2E.conflictTypes[this.system.conflictType];
    if ( !baseCfg || this.system.conflictType !== "manual" ) return baseCfg;

    const manual = this.system;
    const actions = {};
    for ( const key of Object.keys(baseCfg.actions) ) {
      actions[key] = manual.manualActions?.[key]?.type
        ? manual.manualActions[key]
        : baseCfg.actions[key];
    }
    return {
      ...baseCfg,
      dispositionSkills: manual.manualDispositionSkills?.length
        ? manual.manualDispositionSkills
        : baseCfg.dispositionSkills,
      dispositionAbility: manual.manualDispositionAbility || baseCfg.dispositionAbility,
      actions
    };
  }

  /* -------------------------------------------- */
  /*  Conflict Management                         */
  /* -------------------------------------------- */

  /**
   * Designate a combatant as captain of their group.
   * @param {string} groupId       The CombatantGroup ID.
   * @param {string} combatantId   The Combatant ID to designate as captain.
   * @returns {Promise<TB2ECombat>}
   */
  async setCaptain(groupId, combatantId) {
    const gd = foundry.utils.deepClone(this.system.groupDispositions || {});
    if ( !gd[groupId] ) gd[groupId] = {};
    gd[groupId].captainId = combatantId;
    return this.update({ "system.groupDispositions": gd });
  }

  /**
   * Transition from setup to disposition phase.
   * Validates that all groups have captains assigned.
   * @returns {Promise<TB2ECombat>}
   */
  async beginDisposition() {
    const gd = foundry.utils.deepClone(this.system.groupDispositions || {});
    const groups = Array.from(this.groups);

    // Validate all groups have captains.
    for ( const group of groups ) {
      if ( !gd[group.id]?.captainId ) {
        ui.notifications.warn(game.i18n.localize("TB2E.Conflict.NeedCaptains"));
        return;
      }
    }

    // If the conflict type has only one disposition skill, auto-set it.
    const conflictType = this.getEffectiveConflictConfig();
    if ( conflictType?.dispositionSkills.length === 1 ) {
      const skillKey = conflictType.dispositionSkills[0];
      const combatantUpdates = [];
      for ( const group of groups ) {
        const captainId = gd[group.id]?.captainId;
        if ( captainId ) {
          // Store chosen skill in group disposition data instead of combatant.
          gd[group.id].chosenSkill = skillKey;
        }
      }
    }

    return this.update({
      "system.phase": "disposition",
      "system.groupDispositions": gd
    });
  }

  /**
   * Request storing a disposition roll result. If the current user is GM, stores directly.
   * Otherwise, writes to captain's combatant mailbox for GM processing.
   * @param {string} groupId    The CombatantGroup ID.
   * @param {object} result     The roll result data.
   * @returns {Promise<TB2ECombat|void>}
   */
  async requestStoreDispositionRoll(groupId, result) {
    if ( game.user.isGM ) return this.storeDispositionRoll(groupId, result);
    // Mailbox: write to captain's combatant — GM processes via _onUpdateDescendantDocuments.
    const captainId = this.system.groupDispositions?.[groupId]?.captainId;
    const captain = captainId ? this.combatants.get(captainId) : null;
    if ( captain ) await captain.update({ "system.pendingDisposition": result });
  }

  /**
   * Store pre-computed disposition roll results for a group.
   * Auto-transitions to distribution sub-state when all groups have rolled.
   * @param {string} groupId                     The CombatantGroup ID.
   * @param {object} options
   * @param {number} options.rolled               Final disposition total (successes + ability).
   * @param {object[]} options.diceResults         Array of individual die results.
   * @param {string} options.cardHtml              Rendered roll card HTML.
   * @returns {Promise<TB2ECombat>}
   */
  async storeDispositionRoll(groupId, { rolled, diceResults, cardHtml }) {
    const gd = foundry.utils.deepClone(this.system.groupDispositions || {});
    const groupData = gd[groupId];
    groupData.rolled = rolled;
    groupData.diceResults = diceResults;
    groupData.cardHtml = cardHtml;

    const updateData = { "system.groupDispositions": gd };
    return this.update(updateData);
  }

  /**
   * Distribute disposition points to individual actors in a group.
   * Transitions to weapons phase when all groups are distributed.
   * @param {string} groupId                       The CombatantGroup ID.
   * @param {Object<string, number>} distribution  Map of combatant ID to disposition value.
   * @returns {Promise<TB2ECombat>}
   */
  async distributeDisposition(groupId, distribution) {
    if ( !game.user.isGM ) {
      const captainId = this.system.groupDispositions?.[groupId]?.captainId;
      const captain = captainId ? this.combatants.get(captainId) : null;
      if ( captain ) await captain.update({ "system.pendingDistribution": { groupId, distribution } });
      return;
    }
    const promises = [];
    for ( const [combatantId, value] of Object.entries(distribution) ) {
      const combatant = this.combatants.get(combatantId);
      const actor = combatant?.actor;
      if ( !actor ) continue;
      promises.push(actor.update({ "system.conflict.hp.value": value, "system.conflict.hp.max": value }));
    }
    await Promise.all(promises);

    // Mark this group as distributed.
    const gd = foundry.utils.deepClone(this.system.groupDispositions || {});
    if ( !gd[groupId] ) gd[groupId] = {};
    gd[groupId].distributed = true;

    const updateData = { "system.groupDispositions": gd };
    return this.update(updateData);
  }

  /**
   * Transition from disposition to weapons phase.
   * Requires all groups to have distributed their disposition.
   * @returns {Promise<TB2ECombat>}
   */
  async beginWeapons() {
    const gd = this.system.groupDispositions || {};
    const groups = Array.from(this.groups);
    const allDistributed = groups.every(g => gd[g.id]?.distributed);
    if ( !allDistributed ) return;
    return this.update({ "system.phase": "weapons" });
  }

  /* -------------------------------------------- */
  /*  Weapon Management                            */
  /* -------------------------------------------- */

  /**
   * Set the weapon for a combatant (persists to both combatant and actor).
   * @param {string} combatantId   The Combatant ID.
   * @param {string} weaponName    The weapon display name.
   * @param {string} [weaponId=""] The weapon item ID or sentinel ("__unarmed__", "__improvised__").
   * @returns {Promise<void>}
   */
  async setWeapon(combatantId, weaponName, weaponId = "") {
    const combatant = this.combatants.get(combatantId);
    if ( !combatant ) return;
    await combatant.update({ "system.weapon": weaponName, "system.weaponId": weaponId });
    const actor = combatant.actor;
    if ( actor ) await actor.update({ "system.conflict.weapon": weaponName, "system.conflict.weaponId": weaponId });
  }

  /**
   * Transition from weapons to scripting phase.
   * Initializes round 1 data structure on the first call; subsequent rounds
   * are already initialized by {@link advanceRound}.
   * @returns {Promise<TB2ECombat>}
   */
  async beginScripting() {
    const update = { "system.phase": "scripting" };

    // First round only: initialize round 1 data structure.
    // Subsequent rounds are initialized by advanceRound().
    if ( !this.system.currentRound ) {
      const rounds = foundry.utils.deepClone(this.system.rounds || {});
      const actions = {};
      const locked = {};
      for ( const group of this.groups ) {
        actions[group.id] = [null, null, null];
        locked[group.id] = false;
      }
      rounds[1] = {
        actions, locked,
        volleys: [
          { revealed: false, result: null },
          { revealed: false, result: null },
          { revealed: false, result: null }
        ],
        effects: { impede: {}, position: {} }
      };
      update["system.currentRound"] = 1;
      update["system.rounds"] = rounds;
    }

    return this.update(update);
  }

  /* -------------------------------------------- */
  /*  Round Management                             */
  /* -------------------------------------------- */

  /**
   * Set actions for all 3 volleys at once (captain assigns combatants + actions).
   * @param {string} groupId   The CombatantGroup ID.
   * @param {Array<{action: string, combatantId: string}>} actions  Array of 3 action assignments.
   * @returns {Promise<TB2ECombat>}
   */
  async setActions(groupId, actions) {
    if ( !game.user.isGM ) {
      // Mailbox: write to captain's combatant — GM processes via _onUpdateDescendantDocuments.
      const captainId = this.system.groupDispositions?.[groupId]?.captainId;
      const captain = captainId ? this.combatants.get(captainId) : null;
      if ( captain ) await captain.update({ "system.pendingActions": actions });
      return;
    }
    this.#applyActions(groupId, actions);
  }

  /**
   * Lock a team's actions for the current round.
   * All 3 action slots must be filled.
   * @param {string} groupId  The CombatantGroup ID.
   * @returns {Promise<TB2ECombat>}
   */
  async lockActions(groupId) {
    if ( !game.user.isGM ) {
      // Mailbox: write to captain's combatant — GM processes via _onUpdateDescendantDocuments.
      const captainId = this.system.groupDispositions?.[groupId]?.captainId;
      const captain = captainId ? this.combatants.get(captainId) : null;
      if ( captain ) await captain.update({ "system.pendingActionsLocked": true });
      return;
    }
    this.#applyLockActions(groupId);
  }

  /**
   * Transition from scripting to resolve phase.
   * Validates both teams are locked, sets currentAction to 0.
   * @returns {Promise<TB2ECombat>}
   */
  async beginResolve() {
    const roundNum = this.system.currentRound;
    if ( !roundNum ) return;
    const round = this.system.rounds?.[roundNum];
    if ( !round ) return;

    const allLocked = Object.values(round.locked).every(v => v);
    if ( !allLocked ) {
      ui.notifications.warn(game.i18n.localize("TB2E.Conflict.WaitingForLock"));
      return;
    }

    return this.update({
      "system.phase": "resolve",
      "system.currentAction": 0
    });
  }

  /**
   * Set a per-side interaction override for a volley.
   * @param {number} volleyIndex  The volley index (0-2).
   * @param {string} groupId      The CombatantGroup ID.
   * @param {string} interaction   The interaction type ("versus", "independent", "none"), or falsy to clear.
   * @returns {Promise<TB2ECombat>}
   */
  async setInteractionOverride(volleyIndex, groupId, interaction) {
    if ( !game.user.isGM ) return;
    const roundNum = this.system.currentRound;
    const rounds = foundry.utils.deepClone(this.system.rounds || {});
    const round = rounds[roundNum];
    if ( !round ) return;
    const volley = round.volleys[volleyIndex];
    if ( !volley ) return;
    if ( !volley.interactionOverrides ) volley.interactionOverrides = {};
    volley.interactionOverrides[groupId] = interaction || null;
    return this.update({ "system.rounds": rounds });
  }

  /**
   * Increment currentAction (0→1→2).
   * @returns {Promise<TB2ECombat>}
   */
  async nextAction() {
    const next = (this.system.currentAction || 0) + 1;
    if ( next > 2 ) return;
    return this.update({ "system.currentAction": next });
  }

  /* -------------------------------------------- */
  /*  Mailbox Processing (GM only)                */
  /* -------------------------------------------- */

  /** @override */
  _onUpdateDescendantDocuments(parent, collection, documents, changes, options, userId) {
    super._onUpdateDescendantDocuments(parent, collection, documents, changes, options, userId);
    if ( !game.user.isGM || collection !== "combatants" ) return;

    for ( const change of changes ) {
      const system = change.system;
      if ( !system ) continue;
      const combatant = this.combatants.get(change._id);
      if ( !combatant ) continue;
      const groupId = combatant._source.group;

      if ( "pendingDisposition" in system && system.pendingDisposition?.rolled != null ) {
        this.#processDispositionResult(groupId, system.pendingDisposition, change._id);
      }
      if ( "pendingDistribution" in system && system.pendingDistribution?.groupId ) {
        const { groupId: distGroupId, distribution } = system.pendingDistribution;
        this.#processDistribution(distGroupId, distribution, change._id);
      }
      if ( "pendingActions" in system && system.pendingActions?.length ) {
        this.#applyActions(groupId, system.pendingActions, change._id);
      }
      if ( "pendingActionsLocked" in system && system.pendingActionsLocked ) {
        this.#applyLockActions(groupId, change._id);
      }
    }

    // Re-render the panel when weapons change (GM sees updated "Begin Scripting" button state).
    // No auto-transition — the GM manually clicks "Begin Scripting" when ready.
  }

  /**
   * GM processes a pending disposition roll from a captain's combatant.
   * Clears the mailbox field after processing.
   * @param {string} groupId       The CombatantGroup ID.
   * @param {object} result        The disposition roll result.
   * @param {string} combatantId   The combatant that wrote the mailbox.
   */
  async #processDispositionResult(groupId, result, combatantId) {
    await this.storeDispositionRoll(groupId, result);
    // Clear the mailbox.
    const combatant = this.combatants.get(combatantId);
    if ( combatant ) await combatant.update({ "system.pendingDisposition": {} });
  }

  /**
   * GM processes a pending disposition distribution from a captain's combatant.
   * Clears the mailbox field after processing.
   * @param {string} groupId                       The CombatantGroup ID.
   * @param {Object<string, number>} distribution  Map of combatant ID to disposition value.
   * @param {string} combatantId                   The combatant that wrote the mailbox.
   */
  async #processDistribution(groupId, distribution, combatantId) {
    await this.distributeDisposition(groupId, distribution);
    // Clear the mailbox.
    const combatant = this.combatants.get(combatantId);
    if ( combatant ) await combatant.update({ "system.pendingDistribution": {} });
  }

  /**
   * Apply scripted actions to Combat.system.rounds (GM-side logic).
   * @param {string} groupId        The CombatantGroup ID.
   * @param {Array<{action: string, combatantId: string}>} actions
   * @param {string} [mailboxId]    Combatant ID to clear mailbox on after processing.
   */
  async #applyActions(groupId, actions, mailboxId) {
    const roundNum = this.system.currentRound;
    if ( !roundNum ) return;
    const rounds = foundry.utils.deepClone(this.system.rounds || {});
    const round = rounds[roundNum];
    if ( !round || round.locked?.[groupId] ) return;

    // Validate non-null entries.
    for ( const entry of actions ) {
      if ( entry && entry.action && !CONFIG.TB2E.conflictActions[entry.action] ) return;
    }

    round.actions[groupId] = actions;
    await this.update({ "system.rounds": rounds });

    // Clear the mailbox.
    if ( mailboxId ) {
      const combatant = this.combatants.get(mailboxId);
      if ( combatant ) await combatant.update({ "system.pendingActions": [] });
    }
  }

  /**
   * Lock a team's scripted actions for the current round (GM-side logic).
   * @param {string} groupId     The CombatantGroup ID.
   * @param {string} [mailboxId] Combatant ID to clear mailbox on after processing.
   */
  async #applyLockActions(groupId, mailboxId) {
    const roundNum = this.system.currentRound;
    if ( !roundNum ) return;
    const rounds = foundry.utils.deepClone(this.system.rounds || {});
    const round = rounds[roundNum];
    if ( !round ) return;

    // Validate all 3 slots are filled.
    const teamActions = round.actions[groupId];
    if ( !teamActions || teamActions.length < 3 || teamActions.some(a => !a?.action || !a?.combatantId) ) {
      return;
    }

    round.locked[groupId] = true;
    await this.update({ "system.rounds": rounds });

    // Clear the mailbox.
    if ( mailboxId ) {
      const combatant = this.combatants.get(mailboxId);
      if ( combatant ) await combatant.update({ "system.pendingActionsLocked": false });
    }
  }

  /**
   * Reveal a volley (GM only). Both teams must be locked first.
   * @param {number} volleyIndex  The volley index (0-2).
   * @returns {Promise<TB2ECombat>}
   */
  async revealVolley(volleyIndex) {
    if ( !game.user.isGM ) return;
    const roundNum = this.system.currentRound;
    if ( !roundNum ) return;
    const rounds = foundry.utils.deepClone(this.system.rounds || {});
    const round = rounds[roundNum];
    if ( !round ) return;

    // Both teams must be locked.
    const allLocked = Object.values(round.locked).every(v => v);
    if ( !allLocked ) {
      ui.notifications.warn(game.i18n.localize("TB2E.Conflict.WaitingForLock"));
      return;
    }

    if ( volleyIndex < 0 || volleyIndex > 2 ) return;
    round.volleys[volleyIndex].revealed = true;

    return this.update({ "system.rounds": rounds });
  }

  /**
   * Store roll result for a volley after resolution.
   * @param {number} volleyIndex  The volley index (0-2).
   * @param {object} result       The roll result data.
   * @returns {Promise<TB2ECombat>}
   */
  async resolveVolley(volleyIndex, result) {
    const roundNum = this.system.currentRound;
    if ( !roundNum ) return;
    const rounds = foundry.utils.deepClone(this.system.rounds || {});
    const round = rounds[roundNum];
    if ( !round ) return;

    if ( volleyIndex < 0 || volleyIndex > 2 ) return;
    round.volleys[volleyIndex].result = result;
    return this.update({ "system.rounds": rounds });
  }

  /**
   * Get the interaction type for a volley based on both teams' actions.
   * @param {number} volleyIndex  The volley index (0-2).
   * @returns {string|null}       "independent", "versus", or "none", or null if not available.
   */
  getVolleyInteraction(volleyIndex) {
    const roundNum = this.system.currentRound;
    if ( !roundNum ) return null;
    const round = this.system.rounds?.[roundNum];
    if ( !round ) return null;

    const groups = Array.from(this.groups);
    if ( groups.length < 2 ) return null;

    const action0 = round.actions[groups[0].id]?.[volleyIndex]?.action;
    const action1 = round.actions[groups[1].id]?.[volleyIndex]?.action;
    if ( !action0 || !action1 ) return null;

    return CONFIG.TB2E.conflictInteractions[`${action0}:${action1}`] ?? null;
  }

  /**
   * Advance to the next round after all 3 volleys are resolved.
   * Records actedLastRound on each combatant before resetting.
   * @returns {Promise<TB2ECombat>}
   */
  async advanceRound() {
    // Record which action slots each combatant acted in this round.
    const roundNum = this.system.currentRound;
    const round = this.system.rounds?.[roundNum];
    if ( round ) {
      const combatantSlots = {};
      for ( const [groupId, groupActions] of Object.entries(round.actions) ) {
        for ( let i = 0; i < (groupActions?.length || 0); i++ ) {
          const entry = groupActions[i];
          if ( entry?.combatantId ) {
            if ( !combatantSlots[entry.combatantId] ) combatantSlots[entry.combatantId] = [];
            combatantSlots[entry.combatantId].push(i);
          }
        }
      }
      const combatantUpdates = [];
      for ( const c of this.combatants ) {
        combatantUpdates.push({ _id: c.id, "system.actedLastRound": combatantSlots[c.id] || [] });
      }
      if ( combatantUpdates.length ) {
        await this.updateEmbeddedDocuments("Combatant", combatantUpdates);
      }
    }

    const nextRound = (this.system.currentRound || 0) + 1;
    const rounds = foundry.utils.deepClone(this.system.rounds || {});

    const actions = {};
    const locked = {};
    for ( const group of this.groups ) {
      actions[group.id] = [null, null, null];
      locked[group.id] = false;
    }

    rounds[nextRound] = {
      actions,
      locked,
      volleys: [
        { revealed: false, result: null },
        { revealed: false, result: null },
        { revealed: false, result: null }
      ],
      effects: {
        impede: {},
        position: {}
      }
    };

    // Carry over maneuver effects from the previous round's last volley results.
    const prevRound = this.system.rounds?.[this.system.currentRound];
    if ( prevRound ) {
      for ( const group of this.groups ) {
        // Accumulate impede/position effects that carry into the next round.
        rounds[nextRound].effects.impede[group.id] = prevRound.effects?.impede?.[group.id] || 0;
        rounds[nextRound].effects.position[group.id] = prevRound.effects?.position?.[group.id] || 0;
      }
    }

    return this.update({
      "system.currentRound": nextRound,
      "system.rounds": rounds,
      "system.phase": "weapons"
    });
  }

  /**
   * Calculate the compromise level for the winner.
   * @param {string} winnerGroupId  The winning CombatantGroup ID.
   * @returns {{ level: string, remaining: number, starting: number, percent: number }}
   */
  calculateCompromise(winnerGroupId) {
    const members = this.combatants.filter(c => c._source.group === winnerGroupId);
    let remaining = 0;
    let starting = 0;
    for ( const c of members ) {
      const actor = c.actor;
      if ( !actor ) continue;
      remaining += actor.system.conflict.hp.value;
      starting += actor.system.conflict.hp.max;
    }
    if ( starting === 0 ) return { level: "major", remaining: 0, starting: 0, percent: 0 };

    const percent = remaining / starting;
    let level;
    if ( percent > 0.5 ) level = "minor";
    else if ( percent > 0.25 ) level = "half";
    else level = "major";

    return { level, remaining, starting, percent };
  }

  /**
   * Check if the conflict should end (one side at 0 disposition).
   * @returns {{ ended: boolean, winnerGroupId: string|null, loserGroupId: string|null, tie: boolean }}
   */
  checkConflictEnd() {
    const groups = Array.from(this.groups);
    const groupDisps = groups.map(g => {
      const members = this.combatants.filter(c => c._source.group === g.id);
      let total = 0;
      for ( const c of members ) {
        const actor = c.actor;
        total += actor?.system.conflict?.hp?.value || 0;
      }
      return { groupId: g.id, total };
    });

    const atZero = groupDisps.filter(g => g.total <= 0);
    if ( atZero.length === 0 ) return { ended: false, winnerGroupId: null, loserGroupId: null, tie: false };
    if ( atZero.length >= 2 ) return { ended: true, winnerGroupId: null, loserGroupId: null, tie: true };

    const loser = atZero[0];
    const winner = groupDisps.find(g => g.groupId !== loser.groupId);
    return { ended: true, winnerGroupId: winner?.groupId || null, loserGroupId: loser.groupId, tie: false };
  }

  /**
   * Transition to the resolution phase.
   * @returns {Promise<TB2ECombat>}
   */
  async beginResolution() {
    if ( !game.user.isGM ) return;
    return this.update({ "system.phase": "resolution" });
  }

  /** @override */
  async _preDelete(options, user) {
    await super._preDelete(options, user);
    if ( !this.isConflict || !game.user.isGM ) return;

    // Reset conflict HP on all participating actors.
    const seen = new Set();
    for ( const combatant of this.combatants ) {
      const actor = combatant.actor;
      if ( !actor || seen.has(actor) ) continue;
      seen.add(actor);
      const resetData = {
        "system.conflict.hp.value": 0,
        "system.conflict.hp.max": 0
      };
      // Only reset weapon fields that exist in the actor's schema.
      const schema = actor.system.schema?.fields?.conflict?.fields;
      if ( schema?.weapon ) resetData["system.conflict.weapon"] = "";
      if ( schema?.weaponId ) resetData["system.conflict.weaponId"] = "";
      await actor.update(resetData);
    }
  }

  /**
   * End the conflict, deleting the combat. Actor cleanup is handled by _preDelete.
   * @returns {Promise<void>}
   */
  async endConflict() {
    return this.delete();
  }

  /** @override */
  async endCombat() {
    if ( this.isConflict ) return this.endConflict();
    return super.endCombat();
  }
}
