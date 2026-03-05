import { _logAdvancement } from "./tb2e-roll.mjs";
import { _checkWiseAdvancement } from "./post-roll.mjs";
import { abilities, skills } from "../config.mjs";

/**
 * In-memory registry of unresolved versus challenges.
 * Stores a flat set of initiator message IDs.
 */
export const PendingVersusRegistry = {
  /** @type {Set<string>} messageId */
  _pending: new Set(),

  /**
   * Register a new pending challenge.
   * @param {string} messageId - The initiator's ChatMessage ID.
   */
  register(messageId) {
    this._pending.add(messageId);
  },

  /**
   * Remove a resolved challenge.
   * @param {string} messageId - The initiator message ID to remove.
   */
  remove(messageId) {
    this._pending.delete(messageId);
  },

  /**
   * Get all open (unresolved) challenges, excluding those initiated by a given actor.
   * @param {string} excludeActorId - Actor ID to exclude (can't answer your own challenge).
   * @returns {{ messageId: string, actorName: string, label: string }[]}
   */
  getOpenChallenges(excludeActorId) {
    const results = [];
    for ( const messageId of this._pending ) {
      const message = game.messages.get(messageId);
      if ( !message ) continue;
      const vs = message.getFlag("tb2e", "versus");
      if ( !vs || vs.type !== "initiator" || vs.resolved ) continue;
      if ( vs.initiatorActorId === excludeActorId ) continue;
      const actor = game.actors.get(vs.initiatorActorId);
      results.push({
        messageId,
        actorName: actor?.name ?? "Unknown",
        label: vs.label
      });
    }
    return results;
  },

  /**
   * Rebuild the registry from existing ChatMessages (e.g. after page refresh).
   */
  rebuild() {
    this._pending.clear();
    for ( const message of game.messages ) {
      const vs = message.getFlag("tb2e", "versus");
      if ( !vs ) continue;
      if ( vs.type === "initiator" && !vs.resolved ) {
        this.register(message.id);
      }
    }
  }
};

/**
 * Link initiator and opponent messages when the opponent's roll arrives.
 * If both are already finalized (edge case), resolve immediately.
 * Called from the `createChatMessage` hook (GM-only).
 * @param {ChatMessage} opponentMessage - The newly created message.
 */
export async function resolveVersus(opponentMessage) {
  const vs = opponentMessage.getFlag("tb2e", "versus");
  if ( !vs || vs.type !== "opponent" ) return;

  // Load the initiator's message
  const initiatorMessage = game.messages.get(vs.initiatorMessageId);
  if ( !initiatorMessage ) return;
  const initiatorVs = initiatorMessage.getFlag("tb2e", "versus");
  if ( !initiatorVs || initiatorVs.resolved ) return;

  // Link: store opponent message ID on initiator so we can find it later
  await initiatorMessage.setFlag("tb2e", "versus.opponentMessageId", opponentMessage.id);

  // Check if both are already finalized (unlikely but possible)
  const bothFinalized = initiatorMessage.getFlag("tb2e", "resolved")
    && opponentMessage.getFlag("tb2e", "resolved");
  if ( bothFinalized ) {
    await _executeVersusResolution(initiatorMessage, opponentMessage);
  }
}

/**
 * GM-side processor for the pendingVersusFinalize mailbox.
 * Called from the updateActor hook when a player finalizes a versus roll.
 * @param {Actor} actor - The actor whose flag was set.
 * @param {object} pending - The mailbox payload.
 * @param {string} pending.messageId - The finalized chat message ID.
 */
export async function processVersusFinalize(actor, pending) {
  const message = game.messages.get(pending.messageId);

  // Clear the mailbox first
  await actor.unsetFlag("tb2e", "pendingVersusFinalize");

  if ( !message ) return;
  const vs = message.getFlag("tb2e", "versus");
  if ( !vs ) return;

  // Find the partner message
  let initiatorMsg, opponentMsg;
  if ( vs.type === "initiator" ) {
    initiatorMsg = message;
    if ( !vs.opponentMessageId ) return; // opponent hasn't rolled yet
    opponentMsg = game.messages.get(vs.opponentMessageId);
  } else if ( vs.type === "opponent" ) {
    opponentMsg = message;
    initiatorMsg = game.messages.get(vs.initiatorMessageId);
  }
  if ( !initiatorMsg || !opponentMsg ) return;

  // Both must be finalized
  if ( !initiatorMsg.getFlag("tb2e", "resolved") ) return;
  if ( !opponentMsg.getFlag("tb2e", "resolved") ) return;

  await _executeVersusResolution(initiatorMsg, opponentMsg);
}

/**
 * Execute the actual versus resolution — compare final successes, post result card,
 * log advancement, process wise aiders.
 * @param {ChatMessage} initiatorMessage
 * @param {ChatMessage} opponentMessage
 */
async function _executeVersusResolution(initiatorMessage, opponentMessage) {
  const initiatorVs = initiatorMessage.getFlag("tb2e", "versus");
  const opponentVs = opponentMessage.getFlag("tb2e", "versus");
  if ( !initiatorVs || !opponentVs ) return;
  if ( initiatorVs.resolved ) return; // Already resolved

  // Read final successes from roll flags (post-roll actions may have modified them)
  const iRoll = initiatorMessage.flags.tb2e.roll;
  const oRoll = opponentMessage.flags.tb2e.roll;
  const iSuccesses = iRoll.finalSuccesses ?? iRoll.successes;
  const oSuccesses = oRoll.finalSuccesses ?? oRoll.successes;

  const isTied = iSuccesses === oSuccesses;
  const initiatorWins = iSuccesses > oSuccesses;

  // If tied, create a tied card instead of resolving
  if ( isTied ) {
    await _handleVersusTied(initiatorMessage, opponentMessage,
      { ...initiatorVs, successes: iSuccesses },
      { ...opponentVs, successes: oSuccesses });
    return;
  }

  const winnerId = initiatorWins ? initiatorVs.initiatorActorId : opponentVs.opponentActorId;
  const initiatorActor = game.actors.get(initiatorVs.initiatorActorId);
  const opponentActor = game.actors.get(opponentVs.opponentActorId);

  // Render resolution card
  const chatContent = await foundry.applications.handlebars.renderTemplate("systems/tb2e/templates/chat/versus-resolution.hbs", {
    initiatorName: initiatorActor?.name ?? "Unknown",
    initiatorImg: initiatorActor?.img ?? "icons/svg/mystery-man.svg",
    initiatorSuccesses: iSuccesses,
    initiatorLabel: initiatorVs.label,
    opponentName: opponentActor?.name ?? "Unknown",
    opponentImg: opponentActor?.img ?? "icons/svg/mystery-man.svg",
    opponentSuccesses: oSuccesses,
    opponentLabel: opponentVs.label,
    winnerId,
    initiatorWins,
    versusTestLabel: game.i18n.localize("TB2E.Roll.VersusTest"),
    winsLabel: game.i18n.localize("TB2E.Roll.Wins"),
    successesLabel: game.i18n.localize("TB2E.Roll.Successes")
  });

  // Create resolution message
  await ChatMessage.create({
    content: chatContent,
    type: CONST.CHAT_MESSAGE_STYLES.OTHER,
    flags: {
      tb2e: {
        versus: {
          type: "resolution",
          initiatorMessageId: initiatorMessage.id,
          opponentMessageId: opponentMessage.id,
          initiatorActorId: initiatorVs.initiatorActorId,
          opponentActorId: opponentVs.opponentActorId,
          winnerId
        }
      }
    }
  });

  // Mark both versus flags as resolved
  await initiatorMessage.setFlag("tb2e", "versus.resolved", true);
  await opponentMessage.setFlag("tb2e", "versus.resolved", true);

  // Remove from registry
  PendingVersusRegistry.remove(initiatorMessage.id);

  // Log advancement for both sides
  // Initiator's obstacle = opponent's successes; pass = initiator won
  if ( initiatorVs.logAdvancement && oSuccesses > 0 ) {
    await _logAdvancement({
      actor: initiatorActor,
      type: initiatorVs.rollType,
      key: initiatorVs.rollKey,
      baseDice: initiatorVs.baseDice,
      pass: initiatorWins
    });
  }

  // Opponent's obstacle = initiator's successes; pass = opponent won
  if ( opponentVs.logAdvancement && iSuccesses > 0 ) {
    await _logAdvancement({
      actor: opponentActor,
      type: opponentVs.rollType,
      key: opponentVs.rollKey,
      baseDice: opponentVs.baseDice,
      pass: !initiatorWins
    });
  }

  // Process wise aiders for both sides
  const passField = (actorWins) => actorWins ? "pass" : "fail";
  await _processVersusWiseAiders(initiatorMessage.flags.tb2e, initiatorWins);
  await _processVersusWiseAiders(opponentMessage.flags.tb2e, !initiatorWins);
}

/**
 * Process wise aiders for a versus roll message after resolution.
 * @param {object} tbFlags - The tb2e flags from the roll message.
 * @param {boolean} pass - Whether this side won.
 */
async function _processVersusWiseAiders(tbFlags, pass) {
  const wiseAiders = tbFlags.wiseAiders || [];
  const field = pass ? "pass" : "fail";
  for ( const aider of wiseAiders ) {
    const aiderActor = game.actors.get(aider.id);
    if ( !aiderActor ) continue;
    if ( aiderActor.isOwner ) {
      const wises = foundry.utils.deepClone(aiderActor.system.wises);
      if ( wises[aider.wiseIndex] ) {
        wises[aider.wiseIndex][field] = true;
        await aiderActor.update({ "system.wises": wises });
        _checkWiseAdvancement(aiderActor, aider.wiseIndex);
      }
    } else {
      await aiderActor.setFlag("tb2e", "pendingWiseAdvancement", {
        wiseIndex: aider.wiseIndex,
        field
      });
    }
  }
}

/* -------------------------------------------- */
/*  Versus Tied                                  */
/* -------------------------------------------- */

/**
 * Get eligible traits for tie-breaking (not already used against this session).
 * @param {Actor} actor
 * @returns {{ id: string, name: string, level: number }[]}
 */
function _getEligibleTieBreakTraits(actor) {
  return (actor?.itemTypes.trait || [])
    .filter(t => t.name && !t.system.usedAgainst)
    .map(t => ({ id: t.id, name: t.name, level: t.system.level }));
}

/**
 * Get Level 3 traits eligible for beneficial tie-breaking (win the tie).
 * L3 beneficial uses are unlimited per session — no usedAgainst check needed.
 * @param {Actor} actor
 * @returns {{ id: string, name: string, level: number }[]}
 */
function _getEligibleLevel3Traits(actor) {
  return (actor?.itemTypes.trait || [])
    .filter(t => t.name && t.system.level === 3)
    .map(t => ({ id: t.id, name: t.name, level: t.system.level }));
}

/**
 * Check whether a trait was already used on the original roll (once-per-test rule).
 * @param {ChatMessage} rollMessage - The original roll message.
 * @returns {boolean}
 */
function _wasTraitUsedOnRoll(rollMessage) {
  const traitFlag = rollMessage?.getFlag("tb2e", "trait");
  return !!(traitFlag && traitFlag.itemId);
}

/**
 * Handle a tied versus test by creating a tied card with tie-breaking actions.
 */
async function _handleVersusTied(initiatorMessage, opponentMessage, initiatorVs, vs) {
  const initiatorActor = game.actors.get(initiatorVs.initiatorActorId);
  const opponentActor = game.actors.get(vs.opponentActorId);

  // Check if traits were already used on the original rolls (once-per-test rule)
  const initiatorTraitUsed = _wasTraitUsedOnRoll(initiatorMessage);
  const opponentTraitUsed = _wasTraitUsedOnRoll(opponentMessage);

  // Determine tiebreaker ability for each side
  const tiebreakerAbilityLabel = _getTiebreakerAbilityLabel(initiatorVs.rollType, initiatorVs.rollKey,
    vs.rollType, vs.rollKey);

  const chatContent = await foundry.applications.handlebars.renderTemplate(
    "systems/tb2e/templates/chat/versus-tied.hbs", {
      initiatorName: initiatorActor?.name ?? "Unknown",
      initiatorImg: initiatorActor?.img ?? "icons/svg/mystery-man.svg",
      initiatorSuccesses: initiatorVs.successes,
      initiatorLabel: initiatorVs.label,
      initiatorActorId: initiatorVs.initiatorActorId,
      initiatorTraits: _getEligibleTieBreakTraits(initiatorActor),
      initiatorLevel3Traits: _getEligibleLevel3Traits(initiatorActor),
      initiatorTraitUsed,
      opponentName: opponentActor?.name ?? "Unknown",
      opponentImg: opponentActor?.img ?? "icons/svg/mystery-man.svg",
      opponentSuccesses: vs.successes,
      opponentLabel: vs.label,
      opponentActorId: vs.opponentActorId,
      opponentTraits: _getEligibleTieBreakTraits(opponentActor),
      opponentLevel3Traits: _getEligibleLevel3Traits(opponentActor),
      opponentTraitUsed,
      versusTestLabel: game.i18n.localize("TB2E.Roll.VersusTest"),
      tiedLabel: game.i18n.localize("TB2E.Roll.Tied"),
      successesLabel: game.i18n.localize("TB2E.Roll.Successes"),
      noEligibleLabel: game.i18n.localize("TB2E.Trait.NoEligibleAgainst"),
      traitAgainstLabel: game.i18n.localize("TB2E.Trait.AgainstBreakTieSection"),
      level3BreakTieLabel: game.i18n.localize("TB2E.Trait.Level3BreakTieSection"),
      noLevel3Label: game.i18n.localize("TB2E.Trait.NoLevel3"),
      traitAlreadyUsedLabel: game.i18n.localize("TB2E.Trait.AlreadyUsedOnRoll"),
      tiebreakerInstruction: game.i18n.format("TB2E.Roll.TiebreakerInstruction", { ability: tiebreakerAbilityLabel })
    }
  );

  const tiedMessage = await ChatMessage.create({
    content: chatContent,
    type: CONST.CHAT_MESSAGE_STYLES.OTHER,
    flags: {
      tb2e: {
        versus: {
          type: "tied",
          initiatorMessageId: initiatorMessage.id,
          opponentMessageId: opponentMessage.id,
          initiatorActorId: initiatorVs.initiatorActorId,
          opponentActorId: vs.opponentActorId,
          initiatorSuccesses: initiatorVs.successes,
          opponentSuccesses: vs.successes,
          initiatorRollType: initiatorVs.rollType,
          initiatorRollKey: initiatorVs.rollKey,
          opponentRollType: vs.rollType,
          opponentRollKey: vs.rollKey,
          initiatorBaseDice: initiatorVs.baseDice,
          opponentBaseDice: vs.baseDice,
          initiatorLogAdvancement: initiatorVs.logAdvancement,
          opponentLogAdvancement: vs.logAdvancement
        },
        tiedResolved: false
      }
    }
  });

  // Update both roll messages with tied banners
  const bannerPattern = /<div class="card-banner banner-(?:pending|resolved)">[\s\S]*?<\/div>/;

  const tiedBannerHtml = `<div class="card-banner banner-amber"><i class="fa-solid fa-equals"></i> ${game.i18n.localize("TB2E.Roll.Tied")}</div>`;
  const initiatorContent = initiatorMessage.content.replace(bannerPattern, tiedBannerHtml);
  await initiatorMessage.update({ content: initiatorContent });

  const opponentContent = opponentMessage.content.replace(bannerPattern, tiedBannerHtml);
  await opponentMessage.update({ content: opponentContent });

  // Mark original messages resolved and remove from registry so they don't appear in the dropdown
  await initiatorMessage.setFlag("tb2e", "versus.resolved", true);
  await opponentMessage.setFlag("tb2e", "versus.resolved", true);
  PendingVersusRegistry.remove(initiatorMessage.id);
}

/**
 * Determine the tiebreaker ability label based on the original roll types.
 * Skill → look up BL field (W→Will, H→Health); Nature → Will; Will/Health → Nature.
 * @param {string} initiatorType
 * @param {string} initiatorKey
 * @param {string} opponentType
 * @param {string} opponentKey
 * @returns {string} Localized ability label
 */
function _getTiebreakerAbilityLabel(initiatorType, initiatorKey, opponentType, opponentKey) {
  const resolve = (type, key) => {
    if ( type === "skill" ) {
      const bl = skills[key]?.bl;
      return bl === "H" ? "health" : "will";
    }
    if ( key === "nature" ) return "will";
    if ( key === "will" || key === "health" ) return "nature";
    return "will"; // fallback
  };

  const initiatorAbility = resolve(initiatorType, initiatorKey);
  const opponentAbility = resolve(opponentType, opponentKey);

  // If both resolve to the same ability, show one label; otherwise show both
  if ( initiatorAbility === opponentAbility ) {
    return game.i18n.localize(abilities[initiatorAbility]?.label ?? "TB2E.Ability.Will");
  }
  const iLabel = game.i18n.localize(abilities[initiatorAbility]?.label ?? "TB2E.Ability.Will");
  const oLabel = game.i18n.localize(abilities[opponentAbility]?.label ?? "TB2E.Ability.Will");
  return `${iLabel}/${oLabel}`;
}

/**
 * Handle the "Break Tie with Trait" action on a tied versus card.
 * The actor voluntarily loses, earning 2 checks.
 * @param {ChatMessage} message - The tied card message.
 * @param {string} actorId - The actor choosing to break the tie.
 * @param {string} traitId - The trait item ID to use.
 */
export async function handleTraitBreakTie(message, actorId, traitId) {
  const vs = message.getFlag("tb2e", "versus");
  if ( !vs || vs.type !== "tied" ) return;
  if ( message.getFlag("tb2e", "tiedResolved") ) return;

  const actor = game.actors.get(actorId);
  if ( !actor ) return;

  const traitItem = actor.items.get(traitId);
  if ( !traitItem || traitItem.system.usedAgainst ) {
    ui.notifications.warn(game.i18n.localize("TB2E.Trait.NoEligibleAgainst"));
    return;
  }

  // Enforce once-per-test: check the original roll message for trait usage
  const isInit = actorId === vs.initiatorActorId;
  const rollMsgId = isInit ? vs.initiatorMessageId : vs.opponentMessageId;
  const rollMsg = game.messages.get(rollMsgId);
  if ( _wasTraitUsedOnRoll(rollMsg) ) {
    ui.notifications.warn(game.i18n.localize("TB2E.Trait.AlreadyUsedOnRoll"));
    return;
  }

  // Earn 2 checks, mark trait as used against
  await traitItem.update({
    "system.checks": traitItem.system.checks + 2,
    "system.usedAgainst": true
  });
  if ( actor.type === "character" ) {
    await actor.update({
      "system.checks": actor.system.checks + 2
    });
  }

  // Determine winner: the OTHER actor wins
  const isInitiator = actorId === vs.initiatorActorId;
  const winnerId = isInitiator ? vs.opponentActorId : vs.initiatorActorId;
  const loserId = actorId;

  // Resolve the versus test
  await _resolveFromTied(message, vs, winnerId, loserId, traitItem.name);
}

/**
 * Handle the "Break Tie with Level 3 Trait" action on a tied versus card.
 * The actor WINS the tie (beneficial use — no checks earned).
 * @param {ChatMessage} message - The tied card message.
 * @param {string} actorId - The actor choosing to break the tie.
 * @param {string} traitId - The trait item ID to use.
 */
export async function handleLevel3TraitBreakTie(message, actorId, traitId) {
  const vs = message.getFlag("tb2e", "versus");
  if ( !vs || vs.type !== "tied" ) return;
  if ( message.getFlag("tb2e", "tiedResolved") ) return;

  const actor = game.actors.get(actorId);
  if ( !actor ) return;

  const traitItem = actor.items.get(traitId);
  if ( !traitItem || traitItem.system.level !== 3 ) {
    ui.notifications.warn(game.i18n.localize("TB2E.Trait.NoLevel3"));
    return;
  }

  // Enforce once-per-test: check the original roll message for trait usage
  const isInitiator = actorId === vs.initiatorActorId;
  const rollMessageId = isInitiator ? vs.initiatorMessageId : vs.opponentMessageId;
  const rollMessage = game.messages.get(rollMessageId);
  if ( _wasTraitUsedOnRoll(rollMessage) ) {
    ui.notifications.warn(game.i18n.localize("TB2E.Trait.AlreadyUsedOnRoll"));
    return;
  }

  // The acting actor WINS (beneficial L3 use — no checks earned)
  const winnerId = actorId;
  const loserId = isInitiator ? vs.opponentActorId : vs.initiatorActorId;

  // Resolve with a custom tiebroken message
  const winnerActor = actor;
  await _resolveFromTied(message, vs, winnerId, loserId,
    null, // no "against" trait name
    game.i18n.format("TB2E.Trait.WonTie", { name: winnerActor.name, trait: traitItem.name })
  );
}

/**
 * Resolve a tied versus from a tie-break action.
 */
async function _resolveFromTied(tiedMessage, vs, winnerId, loserId, traitName, tiebrokenByOverride) {
  const initiatorActor = game.actors.get(vs.initiatorActorId);
  const opponentActor = game.actors.get(vs.opponentActorId);
  const winnerActor = game.actors.get(winnerId);
  const loserActor = game.actors.get(loserId);

  const initiatorWins = winnerId === vs.initiatorActorId;

  // Render resolution card
  const chatContent = await foundry.applications.handlebars.renderTemplate(
    "systems/tb2e/templates/chat/versus-resolution.hbs", {
      initiatorName: initiatorActor?.name ?? "Unknown",
      initiatorImg: initiatorActor?.img ?? "icons/svg/mystery-man.svg",
      initiatorSuccesses: vs.initiatorSuccesses,
      initiatorLabel: vs.initiatorRollKey,
      opponentName: opponentActor?.name ?? "Unknown",
      opponentImg: opponentActor?.img ?? "icons/svg/mystery-man.svg",
      opponentSuccesses: vs.opponentSuccesses,
      opponentLabel: vs.opponentRollKey,
      winnerId,
      initiatorWins,
      tiebrokenBy: tiebrokenByOverride ?? (traitName ? game.i18n.format("TB2E.Trait.BrokeTie", { name: loserActor?.name ?? "Unknown", trait: traitName }) : null),
      versusTestLabel: game.i18n.localize("TB2E.Roll.VersusTest"),
      winsLabel: game.i18n.localize("TB2E.Roll.Wins"),
      successesLabel: game.i18n.localize("TB2E.Roll.Successes")
    }
  );

  await ChatMessage.create({
    content: chatContent,
    type: CONST.CHAT_MESSAGE_STYLES.OTHER,
    flags: {
      tb2e: {
        versus: {
          type: "resolution",
          initiatorMessageId: vs.initiatorMessageId,
          opponentMessageId: vs.opponentMessageId,
          initiatorActorId: vs.initiatorActorId,
          opponentActorId: vs.opponentActorId,
          winnerId
        }
      }
    }
  });

  // Mark tied card as resolved
  await tiedMessage.update({ "flags.tb2e.tiedResolved": true });

  // Log advancement for both sides
  if ( vs.initiatorLogAdvancement && vs.opponentSuccesses > 0 ) {
    await _logAdvancement({
      actor: initiatorActor,
      type: vs.initiatorRollType,
      key: vs.initiatorRollKey,
      baseDice: vs.initiatorBaseDice,
      pass: initiatorWins
    });
  }
  if ( vs.opponentLogAdvancement && vs.initiatorSuccesses > 0 ) {
    await _logAdvancement({
      actor: opponentActor,
      type: vs.opponentRollType,
      key: vs.opponentRollKey,
      baseDice: vs.opponentBaseDice,
      pass: !initiatorWins
    });
  }

  // Process wise aiders for both sides
  const initiatorMsg = game.messages.get(vs.initiatorMessageId);
  const opponentMsg = game.messages.get(vs.opponentMessageId);
  if ( initiatorMsg ) await _processVersusWiseAiders(initiatorMsg.flags.tb2e, initiatorWins);
  if ( opponentMsg ) await _processVersusWiseAiders(opponentMsg.flags.tb2e, !initiatorWins);
}
