import { _logAdvancement } from "./tb2e-roll.mjs";

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
 * Attempt to resolve a versus test when a new ChatMessage is created.
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

  // Compare successes — ties go to defender (opponent)
  const initiatorWins = initiatorVs.successes > vs.successes;
  const winnerId = initiatorWins ? initiatorVs.initiatorActorId : vs.opponentActorId;

  const initiatorActor = game.actors.get(initiatorVs.initiatorActorId);
  const opponentActor = game.actors.get(vs.opponentActorId);

  // Render resolution card
  const chatContent = await foundry.applications.handlebars.renderTemplate("systems/tb2e/templates/chat/versus-resolution.hbs", {
    initiatorName: initiatorActor?.name ?? "Unknown",
    initiatorImg: initiatorActor?.img ?? "icons/svg/mystery-man.svg",
    initiatorSuccesses: initiatorVs.successes,
    initiatorLabel: initiatorVs.label,
    opponentName: opponentActor?.name ?? "Unknown",
    opponentImg: opponentActor?.img ?? "icons/svg/mystery-man.svg",
    opponentSuccesses: vs.successes,
    opponentLabel: vs.label,
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
          opponentActorId: vs.opponentActorId,
          winnerId
        }
      }
    }
  });

  // Mark both messages as resolved and update their banners
  await initiatorMessage.setFlag("tb2e", "versus.resolved", true);
  await opponentMessage.setFlag("tb2e", "versus.resolved", true);

  const bannerPattern = /<div class="roll-card-banner banner-pending">[\s\S]*?<\/div>/;

  const initiatorBanner = game.i18n.format("TB2E.Roll.ChallengeAccepted", {
    name: opponentActor?.name ?? "Unknown"
  });
  const initiatorContent = initiatorMessage.content.replace(bannerPattern,
    `<div class="roll-card-banner banner-resolved"><i class="fa-solid fa-check"></i> ${initiatorBanner}</div>`
  );
  await initiatorMessage.update({ content: initiatorContent });

  const opponentBanner = game.i18n.format("TB2E.Roll.Challenged", {
    name: initiatorActor?.name ?? "Unknown"
  });
  const opponentContent = opponentMessage.content.replace(bannerPattern,
    `<div class="roll-card-banner banner-resolved"><i class="fa-solid fa-check"></i> ${opponentBanner}</div>`
  );
  await opponentMessage.update({ content: opponentContent });

  // Remove from registry
  PendingVersusRegistry.remove(initiatorMessage.id);

  // Log advancement for both sides
  // Initiator's obstacle = opponent's successes; pass = initiator won
  if ( initiatorVs.logAdvancement && vs.successes > 0 ) {
    await _logAdvancement({
      actor: initiatorActor,
      type: initiatorVs.rollType,
      key: initiatorVs.rollKey,
      baseDice: initiatorVs.baseDice,
      pass: initiatorWins
    });
  }

  // Opponent's obstacle = initiator's successes; pass = opponent won
  if ( vs.logAdvancement && initiatorVs.successes > 0 ) {
    await _logAdvancement({
      actor: opponentActor,
      type: vs.rollType,
      key: vs.rollKey,
      baseDice: vs.baseDice,
      pass: !initiatorWins
    });
  }
}
