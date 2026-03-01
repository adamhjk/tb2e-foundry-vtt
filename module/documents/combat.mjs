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
   * Create a new conflict with two default groups.
   * @param {string} [type="capture"]  The conflict type key.
   * @returns {Promise<TB2ECombat>}
   */
  static async createConflict(type = "capture") {
    const combat = await this.create({
      type: "conflict",
      system: { conflictType: type, phase: "setup" }
    });

    // Create PC and NPC team groups.
    await combat.createEmbeddedDocuments("CombatantGroup", [
      { name: game.i18n.localize("TB2E.Conflict.PCTeam") },
      { name: game.i18n.localize("TB2E.Conflict.NPCTeam") }
    ]);

    return combat;
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
   * Transition from setup to rolling phase.
   * Validates that all groups have captains assigned.
   * If a conflict type has only one disposition skill, auto-sets chosenSkill on each captain's combatant.
   * @returns {Promise<TB2ECombat>}
   */
  async beginRolling() {
    const gd = foundry.utils.deepClone(this.system.groupDispositions || {});
    const groups = Array.from(this.groups);

    // Validate all groups have captains.
    for ( const group of groups ) {
      if ( !gd[group.id]?.captainId ) {
        ui.notifications.warn(game.i18n.localize("TB2E.Conflict.NeedCaptains"));
        return;
      }
    }

    // If the conflict type has only one disposition skill, auto-set it on each captain's combatant.
    const conflictType = CONFIG.TB2E.conflictTypes[this.system.conflictType];
    if ( conflictType?.dispositionSkills.length === 1 ) {
      const skillKey = conflictType.dispositionSkills[0];
      const combatantUpdates = [];
      for ( const group of groups ) {
        const captainId = gd[group.id]?.captainId;
        if ( captainId ) {
          combatantUpdates.push({ _id: captainId, "system.chosenSkill": skillKey });
        }
      }
      if ( combatantUpdates.length ) {
        await this.updateEmbeddedDocuments("Combatant", combatantUpdates);
      }
    }

    return this.update({ "system.phase": "rolling" });
  }

  /**
   * Set the chosen disposition skill on the captain's combatant.
   * @param {string} groupId    The CombatantGroup ID.
   * @param {string} skillKey   The skill key chosen by the captain.
   * @returns {Promise<Combatant>}
   */
  async chooseSkill(groupId, skillKey) {
    const gd = this.system.groupDispositions || {};
    const captainId = gd[groupId]?.captainId;
    if ( !captainId ) return;
    const captain = this.combatants.get(captainId);
    if ( !captain ) return;
    return captain.update({ "system.chosenSkill": skillKey });
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
   * Auto-transitions to distribution phase when all groups have rolled.
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

    const groups = Array.from(this.groups);
    const allRolled = groups.every(g => gd[g.id]?.rolled != null);
    const updateData = { "system.groupDispositions": gd };
    if ( allRolled ) updateData["system.phase"] = "distribution";
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
    const updates = [];
    for ( const [combatantId, value] of Object.entries(distribution) ) {
      const combatant = this.combatants.get(combatantId);
      if ( !combatant?.actorId ) continue;
      updates.push({
        _id: combatant.actorId,
        "system.conflict.hp.value": value,
        "system.conflict.hp.max": value
      });
    }
    if ( updates.length ) await Actor.updateDocuments(updates);

    // Mark this group as distributed.
    const gd = foundry.utils.deepClone(this.system.groupDispositions || {});
    if ( !gd[groupId] ) gd[groupId] = {};
    gd[groupId].distributed = true;

    // Check if all groups have been distributed.
    const groups = Array.from(this.groups);
    const allDistributed = groups.every(g => gd[g.id]?.distributed);

    const updateData = { "system.groupDispositions": gd };
    if ( allDistributed ) updateData["system.phase"] = "weapons";

    return this.update(updateData);
  }

  /* -------------------------------------------- */
  /*  Weapon Management                            */
  /* -------------------------------------------- */

  /**
   * Set the weapon for a combatant (persists to both combatant and actor).
   * @param {string} combatantId   The Combatant ID.
   * @param {string} weaponName    The weapon name (free text).
   * @returns {Promise<void>}
   */
  async setWeapon(combatantId, weaponName) {
    const combatant = this.combatants.get(combatantId);
    if ( !combatant ) return;
    await combatant.update({ "system.weapon": weaponName });
    if ( combatant.actorId ) {
      const actor = game.actors.get(combatant.actorId);
      if ( actor ) await actor.update({ "system.conflict.weapon": weaponName });
    }
  }

  /**
   * Transition from weapons to scripting phase.
   * Validates all non-knocked-out combatants have weapons set.
   * @returns {Promise<TB2ECombat>}
   */
  async beginScripting() {
    return this.update({ "system.phase": "scripting" });
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

    // Auto-transition: weapons → scripting when all combatants have declared weapons.
    if ( this.system.phase === "weapons" && changes.some(c => "weapon" in (c.system ?? {})) ) {
      const allArmed = this.combatants.every(c => c.system.knockedOut || c.system.weapon);
      if ( allArmed ) this.startConflictRound();
    }
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
   * Returns to the weapons phase for a new round.
   * @returns {Promise<TB2ECombat>}
   */
  async advanceRound() {
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
   * Start the first conflict round (called when entering scripting for the first time).
   * @returns {Promise<TB2ECombat>}
   */
  async startConflictRound() {
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

    return this.update({
      "system.currentRound": nextRound,
      "system.rounds": rounds,
      "system.phase": "scripting"
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
      const actor = game.actors.get(c.actorId);
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
        const actor = game.actors.get(c.actorId);
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
   * End the conflict, resetting all actor dispositions and deleting the combat.
   * @returns {Promise<void>}
   */
  async endConflict() {
    const updates = [];
    for ( const combatant of this.combatants ) {
      if ( !combatant.actorId ) continue;
      updates.push({
        _id: combatant.actorId,
        "system.conflict.hp.value": 0,
        "system.conflict.hp.max": 0,
        "system.conflict.weapon": ""
      });
    }
    if ( updates.length ) await Actor.updateDocuments(updates);
    return this.delete();
  }

  /** @override */
  async endCombat() {
    if ( this.isConflict ) return this.endConflict();
    return super.endCombat();
  }
}
