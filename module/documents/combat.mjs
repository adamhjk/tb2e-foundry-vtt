import { isBlockedFromHelping } from "../dice/help.mjs";

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

    // Reset all helpers in this group when skill changes.
    const members = this.combatants.filter(c => c._source.group === groupId);
    const resets = members
      .filter(c => c.id !== captainId && c.system.isHelping)
      .map(c => ({ _id: c.id, "system.isHelping": false }));

    const updates = [{ _id: captainId, "system.chosenSkill": skillKey }, ...resets];
    return this.updateEmbeddedDocuments("Combatant", updates);
  }

  /**
   * Toggle a combatant's helper status for the disposition roll.
   * Validates the combatant is eligible before toggling.
   * @param {string} groupId       The CombatantGroup ID.
   * @param {string} combatantId   The Combatant ID to toggle.
   * @returns {Promise<Combatant>}
   */
  async toggleHelper(groupId, combatantId) {
    const gd = this.system.groupDispositions || {};
    const groupData = gd[groupId];
    if ( groupData?.rolled != null ) return;

    // Must not be the captain.
    if ( groupData?.captainId === combatantId ) return;

    // Must be in the group.
    const combatant = this.combatants.get(combatantId);
    if ( !combatant || combatant._source.group !== groupId ) return;

    // Captain must have chosen a skill.
    const captain = groupData?.captainId ? this.combatants.get(groupData.captainId) : null;
    const chosenSkill = captain?.system.chosenSkill;
    if ( !chosenSkill ) return;

    // Must not be blocked by conditions (dead, afraid).
    const actor = game.actors.get(combatant.actorId);
    if ( !actor ) return;
    const { blocked } = isBlockedFromHelping(actor);
    if ( blocked ) return;

    // Must have the chosen skill at rating > 0.
    if ( (actor.system.skills[chosenSkill]?.rating || 0) <= 0 ) return;

    return combatant.update({ "system.isHelping": !combatant.system.isHelping });
  }

  /**
   * Request storing a disposition roll result. If the current user is GM, stores directly.
   * Otherwise, relays the request to the GM via socket.
   * @param {string} groupId    The CombatantGroup ID.
   * @param {object} result     The roll result data.
   * @returns {Promise<TB2ECombat|void>}
   */
  async requestStoreDispositionRoll(groupId, result) {
    if ( game.user.isGM ) return this.storeDispositionRoll(groupId, result);
    game.socket.emit("system.tb2e", {
      action: "storeDispositionRoll",
      combatId: this.id,
      groupId,
      result
    });
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
   * @param {string} groupId                       The CombatantGroup ID.
   * @param {Object<string, number>} distribution  Map of combatant ID to disposition value.
   * @returns {Promise<TB2ECombat>}
   */
  async distributeDisposition(groupId, distribution) {
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
    if ( allDistributed ) updateData["system.phase"] = "active";

    return this.update(updateData);
  }

  /* -------------------------------------------- */
  /*  Round Management                             */
  /* -------------------------------------------- */

  /**
   * Start a new conflict round.
   * Increments currentRound and initializes round data with default team orders.
   * @returns {Promise<TB2ECombat>}
   */
  async startConflictRound() {
    const nextRound = (this.system.currentRound || 0) + 1;
    const rounds = foundry.utils.deepClone(this.system.rounds || {});

    const orders = {};
    const actions = {};
    const locked = {};
    for ( const group of this.groups ) {
      const members = this.combatants.filter(c => c._source.group === group.id);
      orders[group.id] = members.map(c => c.id);
      actions[group.id] = [null, null, null];
      locked[group.id] = false;
    }

    rounds[nextRound] = {
      orders,
      actions,
      locked,
      revealed: [false, false, false],
      results: [null, null, null]
    };

    return this.update({
      "system.currentRound": nextRound,
      "system.rounds": rounds
    });
  }

  /**
   * Set the execution order for a team in the current round.
   * @param {string} groupId                The CombatantGroup ID.
   * @param {string[]} orderedCombatantIds  Ordered array of combatant IDs.
   * @returns {Promise<TB2ECombat>}
   */
  async setTeamOrder(groupId, orderedCombatantIds) {
    const roundNum = this.system.currentRound;
    if ( !roundNum ) return;
    const rounds = foundry.utils.deepClone(this.system.rounds || {});
    const round = rounds[roundNum];
    if ( !round || round.locked[groupId] ) return;

    round.orders[groupId] = orderedCombatantIds;
    return this.update({ "system.rounds": rounds });
  }

  /**
   * Set the action for a specific volley slot.
   * @param {string} groupId      The CombatantGroup ID.
   * @param {number} volleyIndex  The volley index (0-2).
   * @param {string} actionKey    One of attack/defend/feint/maneuver.
   * @returns {Promise<TB2ECombat>}
   */
  async setAction(groupId, volleyIndex, actionKey) {
    const roundNum = this.system.currentRound;
    if ( !roundNum ) return;
    const rounds = foundry.utils.deepClone(this.system.rounds || {});
    const round = rounds[roundNum];
    if ( !round || round.locked[groupId] ) return;

    // Validate action key.
    if ( !CONFIG.TB2E.conflictActions[actionKey] ) return;
    if ( volleyIndex < 0 || volleyIndex > 2 ) return;

    round.actions[groupId][volleyIndex] = actionKey;
    return this.update({ "system.rounds": rounds });
  }

  /**
   * Lock a team's actions for the current round.
   * All 3 action slots must be filled.
   * @param {string} groupId  The CombatantGroup ID.
   * @returns {Promise<TB2ECombat>}
   */
  async lockActions(groupId) {
    const roundNum = this.system.currentRound;
    if ( !roundNum ) return;
    const rounds = foundry.utils.deepClone(this.system.rounds || {});
    const round = rounds[roundNum];
    if ( !round ) return;

    // Validate all 3 slots are filled.
    const teamActions = round.actions[groupId];
    if ( !teamActions || teamActions.some(a => !a) ) {
      ui.notifications.warn(game.i18n.localize("TB2E.Conflict.SelectAction"));
      return;
    }

    round.locked[groupId] = true;
    return this.update({ "system.rounds": rounds });
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
    round.revealed[volleyIndex] = true;
    return this.update({ "system.rounds": rounds });
  }

  /**
   * Store roll result for a volley after rolling.
   * @param {number} volleyIndex  The volley index (0-2).
   * @param {object} result       The roll result data.
   * @returns {Promise<TB2ECombat>}
   */
  async storeVolleyResult(volleyIndex, result) {
    const roundNum = this.system.currentRound;
    if ( !roundNum ) return;
    const rounds = foundry.utils.deepClone(this.system.rounds || {});
    const round = rounds[roundNum];
    if ( !round ) return;

    if ( volleyIndex < 0 || volleyIndex > 2 ) return;
    round.results[volleyIndex] = result;
    return this.update({ "system.rounds": rounds });
  }

  /**
   * Calculate which combatant acts for a given team, round, and volley.
   * Cycles through the ordered list across rounds.
   * @param {string} groupId      The CombatantGroup ID.
   * @param {number} roundNum     The round number (1-based).
   * @param {number} volleyIndex  The volley index (0-2).
   * @returns {string|null}       The acting combatant ID, or null.
   */
  getActingCombatant(groupId, roundNum, volleyIndex) {
    const rounds = this.system.rounds || {};
    const round = rounds[roundNum];
    if ( !round ) return null;
    const order = round.orders[groupId];
    if ( !order?.length ) return null;
    const globalIndex = ((roundNum - 1) * 3) + volleyIndex;
    return order[globalIndex % order.length];
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
        "system.conflict.hp.max": 0
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
