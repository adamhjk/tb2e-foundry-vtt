import { _logAdvancement, _logBLLearning, _buildSynergyHelpers, evaluateRoll } from "./tb2e-roll.mjs";
import { abilities, skills } from "../config.mjs";

/* ============================================ */
/*  Post-Roll Chat Card Interactions            */
/* ============================================ */

/**
 * Register click handlers on chat cards for post-roll actions.
 * Called from the renderChatMessage hook.
 * @param {ChatMessage} message
 * @param {HTMLElement} html
 */
export function activatePostRollListeners(message, html) {
  const flags = message.getFlag("tb2e", "roll");
  if ( !flags ) return;

  const resolved = message.getFlag("tb2e", "resolved");

  const actionBtns = html.querySelectorAll(".card-btn[data-action]");
  for ( const btn of actionBtns ) {
    btn.addEventListener("click", async (event) => {
      event.preventDefault();
      const action = btn.dataset.action;
      switch ( action ) {
        // Synergy buttons work even after the roll is finalized
        case "synergy": return _handleSynergy(message, btn.dataset.helperId);
        default: break;
      }
      // All other post-roll actions require the roll to be unresolved
      if ( resolved ) return;
      switch ( action ) {
        case "fate-luck": return _handleFateLuck(message);
        case "deeper-understanding": return _handleDeeperUnderstanding(message);
        case "of-course": return _handleOfCourse(message);
        case "nature-yes": return _handleNatureTax(message, true);
        case "nature-no": return _handleNatureTax(message, false);
        case "finalize": return _handleFinalize(message);
      }
    });
  }
}

/* -------------------------------------------- */
/*  Fate: Luck — Exploding 6s                   */
/* -------------------------------------------- */

/**
 * Spend 1 Fate to reroll all 6s (suns), chaining if new 6s appear.
 */
async function _handleFateLuck(message) {
  const tbFlags = message.flags.tb2e;
  const rollData = tbFlags.roll;
  const actor = game.actors.get(tbFlags.actorId);
  if ( !actor ) return;

  // Check fate availability
  if ( actor.system.fate.current < 1 ) {
    ui.notifications.warn(game.i18n.localize("TB2E.PostRoll.NoFate"));
    return;
  }

  // Check if luck already used
  if ( tbFlags.luckUsed ) {
    ui.notifications.warn(game.i18n.localize("TB2E.PostRoll.LuckAlreadyUsed"));
    return;
  }

  // Count suns in the original roll
  let sunsToExplode = rollData.diceResults.filter(d => d.isSun).length;
  if ( sunsToExplode === 0 ) return;

  // Roll exploding dice — chain until no more suns
  const luckDice = [];
  let totalNewSuccesses = 0;
  while ( sunsToExplode > 0 ) {
    const { diceResults, successes } = await evaluateRoll(sunsToExplode);
    luckDice.push(...diceResults);
    totalNewSuccesses += successes;
    sunsToExplode = diceResults.filter(d => d.isSun).length;
  }

  // Spend fate
  await actor.update({
    "system.fate.current": actor.system.fate.current - 1,
    "system.fate.spent": actor.system.fate.spent + 1
  });

  // Update message flags
  const newDiceResults = [...rollData.diceResults, ...luckDice.map(d => ({ ...d, isLuck: true }))];
  const newSuccesses = rollData.successes + totalNewSuccesses;

  const updateData = {
    "flags.tb2e.roll.diceResults": newDiceResults,
    "flags.tb2e.roll.successes": newSuccesses,
    "flags.tb2e.luckUsed": true
  };

  if ( tbFlags.versus ) {
    // Versus mode: no obstacle-based pass/fail, just update successes
    const postMods = tbFlags.postSuccessMods || [];
    const successBonus = postMods.reduce((s, m) => s + m.value, 0);
    updateData["flags.tb2e.roll.finalSuccesses"] = Math.max(newSuccesses + successBonus, 0);
  } else {
    // Independent mode: recalculate pass/fail with post-success modifiers
    const obstacle = rollData.obstacle;
    const postMods = tbFlags.postSuccessMods || [];
    const autoBonus = postMods.filter(m => m.value < 0).reduce((s, m) => s + m.value, 0);
    const conditionalBonus = postMods.filter(m => m.value > 0).reduce((s, m) => s + m.value, 0);
    const adjusted = newSuccesses + autoBonus;
    const isPass = adjusted >= obstacle;
    const finalSuccesses = isPass ? adjusted + conditionalBonus : adjusted;
    const pass = finalSuccesses >= obstacle;
    updateData["flags.tb2e.roll.finalSuccesses"] = finalSuccesses;
    updateData["flags.tb2e.roll.pass"] = pass;
  }

  await message.update(updateData);

  // Re-render the chat card
  await _reRenderChatCard(message);
}

/* -------------------------------------------- */
/*  Fate: Deeper Understanding — Reroll 1 Wyrm  */
/* -------------------------------------------- */

async function _handleDeeperUnderstanding(message) {
  const tbFlags = message.flags.tb2e;
  const rollData = tbFlags.roll;
  const actor = game.actors.get(tbFlags.actorId);
  if ( !actor ) return;

  if ( actor.system.fate.current < 1 ) {
    ui.notifications.warn(game.i18n.localize("TB2E.PostRoll.NoFate"));
    return;
  }
  if ( tbFlags.deeperUsed ) {
    ui.notifications.warn(game.i18n.localize("TB2E.PostRoll.DeeperAlreadyUsed"));
    return;
  }
  if ( tbFlags.luckUsed ) {
    ui.notifications.warn(game.i18n.localize("TB2E.PostRoll.MustUseBeforeLuck"));
    return;
  }

  // Find first wyrm (failed die)
  const diceResults = [...rollData.diceResults];
  const wyrmIdx = diceResults.findIndex(d => !d.success && !d.isLuck);
  if ( wyrmIdx < 0 ) return;

  // Reroll that die
  const { diceResults: rerolled } = await evaluateRoll(1);
  const newDie = { ...rerolled[0], isRerolled: true };
  diceResults[wyrmIdx] = newDie;

  // Recalculate successes
  const newSuccesses = diceResults.filter(d => d.success).length;

  // Spend fate
  await actor.update({
    "system.fate.current": actor.system.fate.current - 1,
    "system.fate.spent": actor.system.fate.spent + 1
  });

  // Track for wise advancement
  const wiseInfo = tbFlags.wise;
  if ( wiseInfo ) {
    const wises = foundry.utils.deepClone(actor.system.wises);
    if ( wises[wiseInfo.index] ) {
      wises[wiseInfo.index].fate = true;
      await actor.update({ "system.wises": wises });
      _checkWiseAdvancement(actor, wiseInfo.index);
    }
  }

  // Update flags
  const duUpdateData = {
    "flags.tb2e.roll.diceResults": diceResults,
    "flags.tb2e.roll.successes": newSuccesses,
    "flags.tb2e.deeperUsed": true
  };

  if ( tbFlags.versus ) {
    const postMods = tbFlags.postSuccessMods || [];
    const successBonus = postMods.reduce((s, m) => s + m.value, 0);
    duUpdateData["flags.tb2e.roll.finalSuccesses"] = Math.max(newSuccesses + successBonus, 0);
  } else {
    const obstacle = rollData.obstacle;
    const postMods = tbFlags.postSuccessMods || [];
    const autoBonus = postMods.filter(m => m.value < 0).reduce((s, m) => s + m.value, 0);
    const conditionalBonus = postMods.filter(m => m.value > 0).reduce((s, m) => s + m.value, 0);
    const adjusted = newSuccesses + autoBonus;
    const isPass = adjusted >= obstacle;
    const finalSuccesses = isPass ? adjusted + conditionalBonus : adjusted;
    const pass = finalSuccesses >= obstacle;
    duUpdateData["flags.tb2e.roll.finalSuccesses"] = finalSuccesses;
    duUpdateData["flags.tb2e.roll.pass"] = pass;
  }

  await message.update(duUpdateData);

  await _reRenderChatCard(message);
}

/* -------------------------------------------- */
/*  Persona: Of Course! — Roll Dice Equal to    */
/*  Wyrms and Add Them                          */
/* -------------------------------------------- */

async function _handleOfCourse(message) {
  const tbFlags = message.flags.tb2e;
  const rollData = tbFlags.roll;
  const actor = game.actors.get(tbFlags.actorId);
  if ( !actor ) return;

  if ( actor.system.persona.current < 1 ) {
    ui.notifications.warn(game.i18n.localize("TB2E.PostRoll.NoPersona"));
    return;
  }
  if ( tbFlags.ofCourseUsed ) {
    ui.notifications.warn(game.i18n.localize("TB2E.PostRoll.OfCourseAlreadyUsed"));
    return;
  }
  if ( tbFlags.luckUsed ) {
    ui.notifications.warn(game.i18n.localize("TB2E.PostRoll.MustUseBeforeLuck"));
    return;
  }

  // Count wyrms (failed dice, excluding luck dice)
  const wyrmCount = rollData.diceResults.filter(d => !d.success && !d.isLuck && !d.isOfCourse).length;
  if ( wyrmCount === 0 ) return;

  // Roll new dice equal to wyrm count and append (like Luck)
  const { diceResults: newDice } = await evaluateRoll(wyrmCount);
  const diceResults = [...rollData.diceResults, ...newDice.map(d => ({ ...d, isOfCourse: true }))];

  // Recalculate successes from entire pool
  const newSuccesses = diceResults.filter(d => d.success).length;

  // Spend persona
  await actor.update({
    "system.persona.current": actor.system.persona.current - 1,
    "system.persona.spent": actor.system.persona.spent + 1
  });

  // Track for wise advancement
  const wiseInfo = tbFlags.wise;
  if ( wiseInfo ) {
    const wises = foundry.utils.deepClone(actor.system.wises);
    if ( wises[wiseInfo.index] ) {
      wises[wiseInfo.index].persona = true;
      await actor.update({ "system.wises": wises });
      _checkWiseAdvancement(actor, wiseInfo.index);
    }
  }

  // Update flags
  const ocUpdateData = {
    "flags.tb2e.roll.diceResults": diceResults,
    "flags.tb2e.roll.successes": newSuccesses,
    "flags.tb2e.ofCourseUsed": true
  };

  if ( tbFlags.versus ) {
    const postMods = tbFlags.postSuccessMods || [];
    const successBonus = postMods.reduce((s, m) => s + m.value, 0);
    ocUpdateData["flags.tb2e.roll.finalSuccesses"] = Math.max(newSuccesses + successBonus, 0);
  } else {
    const obstacle = rollData.obstacle;
    const postMods = tbFlags.postSuccessMods || [];
    const autoBonus = postMods.filter(m => m.value < 0).reduce((s, m) => s + m.value, 0);
    const conditionalBonus = postMods.filter(m => m.value > 0).reduce((s, m) => s + m.value, 0);
    const adjusted = newSuccesses + autoBonus;
    const isPass = adjusted >= obstacle;
    const finalSuccesses = isPass ? adjusted + conditionalBonus : adjusted;
    const pass = finalSuccesses >= obstacle;
    ocUpdateData["flags.tb2e.roll.finalSuccesses"] = finalSuccesses;
    ocUpdateData["flags.tb2e.roll.pass"] = pass;
  }

  await message.update(ocUpdateData);

  await _reRenderChatCard(message);
}

/* -------------------------------------------- */
/*  Nature Tax                                  */
/* -------------------------------------------- */

async function _handleNatureTax(message, withinDescriptors) {
  const tbFlags = message.flags.tb2e;
  const rollData = tbFlags.roll;
  const actor = game.actors.get(tbFlags.actorId);
  if ( !actor ) return;

  let taxAmount = 0;
  if ( !withinDescriptors ) {
    if ( rollData.pass ) {
      // Pass outside descriptors: tax 1
      taxAmount = 1;
    } else {
      // Fail outside descriptors: tax by margin of failure
      const obstacle = rollData.obstacle ?? 0;
      const successes = rollData.finalSuccesses ?? rollData.successes ?? 0;
      taxAmount = Math.max(obstacle - successes, 1);
    }
  }

  if ( taxAmount > 0 ) {
    const currentNature = actor.system.abilities.nature.rating;
    const newNature = Math.max(0, currentNature - taxAmount);
    const natureMax = actor.system.abilities.nature.max;
    await actor.update({ "system.abilities.nature.rating": newNature });
    ui.notifications.info(
      game.i18n.format("TB2E.PostRoll.NatureTaxed", { amount: taxAmount, rating: newNature, max: natureMax })
    );

    // Check for tax-to-0
    if ( newNature === 0 ) {
      await _postNatureCrisis(actor);
    }
  }

  // Hide the nature tax prompt
  await message.update({
    "flags.tb2e.natureTaxResolved": true,
    "flags.tb2e.natureTaxAmount": taxAmount
  });

  await _reRenderChatCard(message);
}

/* -------------------------------------------- */
/*  Synergy — Helper Fate Spend for Advancement */
/* -------------------------------------------- */

/**
 * Player-side entry point for synergy. If the current user is the GM, process
 * directly. Otherwise, write to the helper actor's pendingSynergy flag so the
 * GM can pick it up via the updateActor hook (mailbox pattern).
 */
async function _handleSynergy(message, helperId) {
  const actor = game.actors.get(helperId);
  if ( !actor ) return;

  // Only the helper's owner can initiate synergy
  if ( !actor.isOwner ) {
    ui.notifications.warn(game.i18n.format("TB2E.PostRoll.NotYourHelper", { name: actor.name }));
    return;
  }

  // Early validation on the player side
  if ( actor.system.fate.current < 1 ) {
    ui.notifications.warn(game.i18n.format("TB2E.PostRoll.NoFateHelper", { name: actor.name }));
    return;
  }

  // Already processed?
  const helperSynergy = message.flags.tb2e?.helperSynergy || {};
  if ( helperSynergy[helperId] ) return;

  // GM can process directly; players write to the mailbox
  if ( game.user.isGM ) {
    await _processSynergy(actor, message);
  } else {
    await actor.setFlag("tb2e", "pendingSynergy", { messageId: message.id });
  }
}

/**
 * GM-side synergy processing. Validates, deducts fate, logs advancement,
 * and updates the chat message.
 * @param {Actor} actor     The helper actor
 * @param {ChatMessage} message  The roll chat message
 */
async function _processSynergy(actor, message) {
  const tbFlags = message.flags.tb2e;
  const rollData = tbFlags.roll;

  // Re-validate fate (may have changed since the player clicked)
  if ( actor.system.fate.current < 1 ) {
    ui.notifications.warn(game.i18n.format("TB2E.PostRoll.NoFateHelper", { name: actor.name }));
    return;
  }

  // Already processed?
  const helperSynergy = tbFlags.helperSynergy || {};
  if ( helperSynergy[actor.id] ) return;

  // Find helper entry in flags
  const helper = (tbFlags.helpers || []).find(h => h.id === actor.id);
  if ( !helper ) return;

  // Deduct fate
  await actor.update({
    "system.fate.current": actor.system.fate.current - 1,
    "system.fate.spent": actor.system.fate.spent + 1
  });

  // Log advancement for the helper
  await _logAdvancement({
    actor,
    type: helper.helpViaType,
    key: helper.helpVia,
    baseDice: rollData.baseDice,
    pass: rollData.pass
  });

  // Mark synergy as processed on the chat message
  await message.update({
    [`flags.tb2e.helperSynergy.${actor.id}`]: true
  });

  // Notify
  const cfg = helper.helpViaType === "skill" ? skills[helper.helpVia] : abilities[helper.helpVia];
  const skillLabel = cfg ? game.i18n.localize(cfg.label) : helper.helpVia;
  const result = rollData.pass ? "Pass" : "Fail";
  ui.notifications.info(
    game.i18n.format("TB2E.PostRoll.SynergyLogged", { result, name: actor.name, skill: skillLabel })
  );

  await _reRenderChatCard(message);
}

/**
 * Process a pending synergy mailbox entry. Called from the updateActor hook
 * when the GM detects a pendingSynergy flag on a helper actor.
 * @param {Actor} actor                   The helper actor
 * @param {object} pendingSynergy         The mailbox payload
 * @param {string} pendingSynergy.messageId  The chat message ID
 */
export async function processSynergyMailbox(actor, pendingSynergy) {
  const message = game.messages.get(pendingSynergy.messageId);
  if ( !message ) return;
  await _processSynergy(actor, message);
  await actor.unsetFlag("tb2e", "pendingSynergy");
}

/* -------------------------------------------- */
/*  Finalize                                    */
/* -------------------------------------------- */

async function _handleFinalize(message) {
  const tbFlags = message.flags.tb2e;
  const rollData = tbFlags.roll;
  const actor = game.actors.get(tbFlags.actorId);

  // Versus mode: finalize without advancement (resolution handles it)
  if ( tbFlags.versus ) {
    await message.update({ "flags.tb2e.resolved": true });
    await _reRenderChatCard(message);

    // Mailbox: signal the GM to check if both sides are finalized
    if ( actor ) {
      if ( game.user.isGM ) {
        // GM can process directly — import inline to avoid circular dependency
        const { processVersusFinalize } = await import("./versus.mjs");
        await processVersusFinalize(actor, { messageId: message.id });
      } else {
        await actor.setFlag("tb2e", "pendingVersusFinalize", { messageId: message.id });
      }
    }
    return;
  }

  // Warn if nature tax hasn't been resolved
  if ( tbFlags.channelNature && !tbFlags.natureTaxResolved ) {
    ui.notifications.warn(game.i18n.localize("TB2E.PostRoll.ResolveNatureTax"));
    return;
  }

  // Apply direct nature test tax (outside descriptors, failure only)
  if ( actor && tbFlags.directNatureTest && !tbFlags.withinNature && !tbFlags.directNatureTaxApplied ) {
    if ( !rollData.pass ) {
      const obstacle = rollData.obstacle ?? 0;
      const successes = rollData.finalSuccesses ?? rollData.successes ?? 0;
      const taxAmount = Math.max(obstacle - successes, 1);
      const currentNature = actor.system.abilities.nature.rating;
      const newNature = Math.max(0, currentNature - taxAmount);
      const natureMax = actor.system.abilities.nature.max;
      await actor.update({ "system.abilities.nature.rating": newNature });
      ui.notifications.info(
        game.i18n.format("TB2E.PostRoll.NatureTaxDirect", { amount: taxAmount, rating: newNature, max: natureMax })
      );
      await message.update({ "flags.tb2e.directNatureTaxApplied": true, "flags.tb2e.directNatureTaxAmount": taxAmount });

      // Check for tax-to-0
      if ( newNature === 0 ) {
        await _postNatureCrisis(actor);
      }
    } else {
      await message.update({ "flags.tb2e.directNatureTaxApplied": true, "flags.tb2e.directNatureTaxAmount": 0 });
    }
  }

  // Mark resolved
  await message.update({ "flags.tb2e.resolved": true });

  // Log advancement
  if ( actor && rollData.obstacle > 0 ) {
    if ( rollData.isBL ) {
      await _logBLLearning({ actor, key: rollData.key });
    } else {
      await _logAdvancement({
        actor,
        type: rollData.type,
        key: rollData.key,
        baseDice: rollData.baseDice,
        pass: rollData.pass
      });
    }
  }

  // Mark wise advancement for "I Am Wise" aiders
  const wiseAiders = tbFlags.wiseAiders || [];
  for ( const aider of wiseAiders ) {
    const aiderActor = game.actors.get(aider.id);
    if ( !aiderActor ) continue;
    const field = rollData.pass ? "pass" : "fail";
    if ( aiderActor.isOwner ) {
      // Direct update
      const wises = foundry.utils.deepClone(aiderActor.system.wises);
      if ( wises[aider.wiseIndex] ) {
        wises[aider.wiseIndex][field] = true;
        await aiderActor.update({ "system.wises": wises });
        _checkWiseAdvancement(aiderActor, aider.wiseIndex);
      }
    } else {
      // Mailbox pattern for non-owned actors
      await aiderActor.setFlag("tb2e", "pendingWiseAdvancement", {
        wiseIndex: aider.wiseIndex,
        field
      });
    }
  }

  // Re-render to remove action buttons
  await _reRenderChatCard(message);
}

/* -------------------------------------------- */
/*  Nature Crisis — Tax to 0                    */
/* -------------------------------------------- */

/**
 * Post a nature crisis chat card when Nature is taxed to 0.
 * The card lets the player choose a non-class trait to replace.
 * @param {Actor} actor
 */
async function _postNatureCrisis(actor) {
  const traits = actor.itemTypes.trait || [];

  // Build list of non-class traits for the picker
  const eligibleTraits = traits.map(item => ({
    itemId: item.id,
    name: item.name,
    level: item.system.level,
    isClass: item.system.isClass
  })).filter(t => t.name && !t.isClass);

  const cardContent = await foundry.applications.handlebars.renderTemplate(
    "systems/tb2e/templates/chat/nature-crisis.hbs", {
      actorName: actor.name,
      actorImg: actor.img,
      actorId: actor.id,
      crisisTitle: game.i18n.format("TB2E.Nature.Crisis", { name: actor.name }),
      crisisText: game.i18n.localize("TB2E.Nature.CrisisText"),
      eligibleTraits,
      hasTraits: eligibleTraits.length > 0,
      selectTraitLabel: game.i18n.localize("TB2E.Nature.SelectTrait"),
      newTraitLabel: game.i18n.localize("TB2E.Nature.NewTraitName"),
      confirmLabel: game.i18n.localize("TB2E.Nature.ConfirmCrisis")
    }
  );

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: cardContent,
    type: CONST.CHAT_MESSAGE_STYLES.OTHER,
    flags: { tb2e: { natureCrisis: true, actorId: actor.id } }
  });
}

/**
 * Register click handlers on nature crisis chat cards.
 * @param {ChatMessage} message
 * @param {HTMLElement} html
 */
export function activateNatureCrisisListeners(message, html) {
  const flags = message.getFlag("tb2e", "natureCrisis");
  if ( !flags ) return;
  if ( message.getFlag("tb2e", "crisisResolved") ) return;

  const confirmBtn = html.querySelector(".nature-crisis-confirm");
  if ( !confirmBtn ) return;

  confirmBtn.addEventListener("click", async (event) => {
    event.preventDefault();
    const actorId = message.getFlag("tb2e", "actorId");
    const actor = game.actors.get(actorId);
    if ( !actor || !actor.isOwner ) return;

    const card = confirmBtn.closest("[data-actor-id]");
    const traitSelect = card.querySelector(".crisis-trait-select");
    const newNameInput = card.querySelector(".crisis-new-name");

    const traitItemId = traitSelect ? traitSelect.value : "";
    const newName = newNameInput?.value?.trim() || "";

    if ( !traitItemId || !newName ) {
      ui.notifications.warn(game.i18n.localize("TB2E.Nature.SelectTrait"));
      return;
    }

    // Apply crisis: replace trait name, reduce max, restore current, clear advancement
    const traitItem = actor.items.get(traitItemId);
    if ( traitItem ) {
      await traitItem.update({ name: newName });
    }

    const newMax = Math.max(0, actor.system.abilities.nature.max - 1);
    await actor.update({
      "system.abilities.nature.max": newMax,
      "system.abilities.nature.rating": newMax,
      "system.abilities.nature.pass": 0,
      "system.abilities.nature.fail": 0
    });

    // Mark crisis as resolved
    await message.update({ "flags.tb2e.crisisResolved": true });

    // Check for max 0 retirement
    if ( newMax === 0 ) {
      ui.notifications.error(game.i18n.format("TB2E.Nature.MaxZero", { name: actor.name }));
    } else {
      ui.notifications.info(
        game.i18n.format("TB2E.PostRoll.NatureTaxed", { amount: 0, rating: newMax, max: newMax })
      );
    }

    // Re-render to show resolved state
    const resolvedContent = await foundry.applications.handlebars.renderTemplate(
      "systems/tb2e/templates/chat/nature-crisis.hbs", {
        actorName: actor.name,
        actorImg: actor.img,
        actorId: actor.id,
        crisisTitle: game.i18n.format("TB2E.Nature.Crisis", { name: actor.name }),
        crisisText: game.i18n.localize("TB2E.Nature.CrisisText"),
        resolved: true,
        replacedTrait: newName,
        newMax,
        isRetired: newMax === 0,
        retirementText: newMax === 0 ? game.i18n.format("TB2E.Nature.Retirement", { name: actor.name }) : ""
      }
    );
    await message.update({ content: resolvedContent });
  });
}

/* -------------------------------------------- */
/*  Wise Advancement — All 4 Boxes Checked      */
/* -------------------------------------------- */

/**
 * Check if all 4 wise advancement boxes are checked, and if so post a perk card.
 * @param {Actor} actor
 * @param {number} wiseIndex
 */
export function _checkWiseAdvancement(actor, wiseIndex) {
  const wise = actor.system.wises[wiseIndex];
  if ( wise && wise.pass && wise.fail && wise.fate && wise.persona ) {
    _postWiseAdvancementCard(actor, wiseIndex, wise.name);
  }
}

/**
 * Post a wise advancement chat card with perk choices.
 * @param {Actor} actor
 * @param {number} wiseIndex
 * @param {string} wiseName
 */
async function _postWiseAdvancementCard(actor, wiseIndex, wiseName) {
  const cardContent = await foundry.applications.handlebars.renderTemplate(
    "systems/tb2e/templates/chat/wise-advancement.hbs", {
      actorName: actor.name,
      actorImg: actor.img,
      actorId: actor.id,
      wiseIndex,
      wiseName,
      advancementTitle: game.i18n.localize("TB2E.Wise.AdvancementTitle"),
      advancementText: game.i18n.localize("TB2E.Wise.AdvancementText"),
      perkChange: game.i18n.localize("TB2E.Wise.PerkChange"),
      perkBL: game.i18n.localize("TB2E.Wise.PerkBL"),
      perkSkillTest: game.i18n.localize("TB2E.Wise.PerkSkillTest")
    }
  );

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: cardContent,
    type: CONST.CHAT_MESSAGE_STYLES.OTHER,
    flags: { tb2e: { wiseAdvancement: true, actorId: actor.id, wiseIndex, wiseName } }
  });
}

/**
 * Register click handlers on wise advancement chat cards.
 * @param {ChatMessage} message
 * @param {HTMLElement} html
 */
export function activateWiseAdvancementListeners(message, html) {
  const flags = message.getFlag("tb2e", "wiseAdvancement");
  if ( !flags ) return;
  if ( message.getFlag("tb2e", "wiseAdvResolved") ) return;

  for ( const btn of html.querySelectorAll(".wise-adv-btn[data-action]") ) {
    btn.addEventListener("click", async (event) => {
      event.preventDefault();
      const actorId = message.getFlag("tb2e", "actorId");
      const wiseIndex = message.getFlag("tb2e", "wiseIndex");
      const wiseName = message.getFlag("tb2e", "wiseName");
      const actor = game.actors.get(actorId);
      if ( !actor || !actor.isOwner ) return;

      const action = btn.dataset.action;

      // Reset all 4 marks
      const wises = foundry.utils.deepClone(actor.system.wises);
      if ( !wises[wiseIndex] ) return;

      let resolvedText;
      if ( action === "wise-change" ) {
        wises[wiseIndex].name = "";
        wises[wiseIndex].pass = false;
        wises[wiseIndex].fail = false;
        wises[wiseIndex].fate = false;
        wises[wiseIndex].persona = false;
        resolvedText = game.i18n.localize("TB2E.Wise.PerkChangeResolved");
      } else if ( action === "wise-bl" ) {
        wises[wiseIndex].pass = false;
        wises[wiseIndex].fail = false;
        wises[wiseIndex].fate = false;
        wises[wiseIndex].persona = false;
        resolvedText = game.i18n.localize("TB2E.Wise.PerkBLResolved");
      } else if ( action === "wise-skill-test" ) {
        wises[wiseIndex].pass = false;
        wises[wiseIndex].fail = false;
        wises[wiseIndex].fate = false;
        wises[wiseIndex].persona = false;
        resolvedText = game.i18n.localize("TB2E.Wise.PerkSkillTestResolved");
      } else {
        return;
      }

      await actor.update({ "system.wises": wises });

      // Re-render the card as resolved
      const resolvedContent = await foundry.applications.handlebars.renderTemplate(
        "systems/tb2e/templates/chat/wise-advancement.hbs", {
          actorName: actor.name,
          actorImg: actor.img,
          actorId: actor.id,
          wiseIndex,
          wiseName,
          advancementTitle: game.i18n.localize("TB2E.Wise.AdvancementTitle"),
          resolved: true,
          resolvedText
        }
      );

      await message.update({
        content: resolvedContent,
        "flags.tb2e.wiseAdvResolved": true
      });

      ui.notifications.info(game.i18n.localize("TB2E.Wise.PerkResolved"));
    });
  }
}

/**
 * Process a pending wise advancement mailbox entry. Called from the updateActor hook
 * when the GM detects a pendingWiseAdvancement flag on an actor.
 * @param {Actor} actor
 * @param {object} pending
 * @param {number} pending.wiseIndex
 * @param {string} pending.field - "pass" or "fail"
 */
export async function processWiseAdvancementMailbox(actor, pending) {
  const wises = foundry.utils.deepClone(actor.system.wises);
  if ( wises[pending.wiseIndex] ) {
    wises[pending.wiseIndex][pending.field] = true;
    await actor.update({ "system.wises": wises });
    _checkWiseAdvancement(actor, pending.wiseIndex);
  }
  await actor.unsetFlag("tb2e", "pendingWiseAdvancement");
}

/* -------------------------------------------- */
/*  Chat Card Re-Rendering                      */
/* -------------------------------------------- */

/**
 * Re-render a chat card after post-roll modifications.
 * Updates the message content HTML based on current flag state.
 */
async function _reRenderChatCard(message) {
  const tbFlags = message.flags.tb2e;
  const rollData = tbFlags.roll;
  const actor = game.actors.get(tbFlags.actorId);
  if ( !actor ) return;

  const resolved = tbFlags.resolved;
  const diceResults = rollData.diceResults || [];
  const finalSuccesses = rollData.finalSuccesses ?? rollData.successes;
  const obstacle = rollData.obstacle;
  const pass = rollData.pass;

  // Determine which post-roll buttons remain
  const hasSuns = diceResults.some(d => d.isSun);
  const hasWyrms = diceResults.some(d => !d.success);
  const hasFate = actor.system.fate.current > 0;
  const hasPersona = actor.system.persona.current > 0;
  const wiseSelected = !!tbFlags.wise;

  const hasPostActions = !resolved && (
    (hasFate && hasSuns && !tbFlags.luckUsed) ||
    (wiseSelected && hasFate && hasWyrms && !tbFlags.deeperUsed && !tbFlags.luckUsed) ||
    (wiseSelected && hasPersona && hasWyrms && !tbFlags.ofCourseUsed && !tbFlags.luckUsed) ||
    (tbFlags.channelNature && !tbFlags.natureTaxResolved) ||
    true // Finalize button always shown until resolved
  );

  const abilityLabel = rollData.blAbilityKey
    ? game.i18n.localize(`TB2E.Ability.${rollData.blAbilityKey.charAt(0).toUpperCase() + rollData.blAbilityKey.slice(1)}`)
    : null;

  const isVersus = !!tbFlags.versus;

  const chatContent = await foundry.applications.handlebars.renderTemplate(
    "systems/tb2e/templates/chat/roll-result.hbs", {
      actorName: actor.name,
      actorImg: actor.img,
      actorSubtitle: actor.type === "npc" ? `NPC \u2014 ${[actor.system.stock, actor.system.class].filter(Boolean).join(" ")}` : "",
      label: rollData.label,
      baseDice: rollData.baseDice,
      poolSize: rollData.poolSize,
      obstacle: isVersus ? null : obstacle,
      successes: finalSuccesses,
      pass: isVersus ? null : pass,
      modifiers: (rollData.modifiers || []).filter(m => m.timing === "pre"),
      diceResults,
      postSuccessMods: (tbFlags.postSuccessMods || []).length ? tbFlags.postSuccessMods : null,
      isBL: rollData.isBL,
      blAbilityLabel: abilityLabel,
      hasPostActions: !resolved,
      hasSuns,
      hasWyrms,
      sunCount: diceResults.filter(d => d.isSun).length,
      wyrmCount: diceResults.filter(d => !d.success).length,
      wiseSelected,
      hasFate,
      hasPersona,
      luckUsed: !!tbFlags.luckUsed,
      deeperUsed: !!tbFlags.deeperUsed,
      ofCourseUsed: !!tbFlags.ofCourseUsed,
      showNatureTax: !isVersus && tbFlags.channelNature && !tbFlags.natureTaxResolved,
      showDirectNatureTax: !isVersus && tbFlags.directNatureTest && !tbFlags.withinNature && !tbFlags.directNatureTaxApplied,
      directNatureWithin: !isVersus && tbFlags.directNatureTest && tbFlags.withinNature,
      synergyHelpers: _buildSynergyHelpers(tbFlags.helpers, tbFlags.helperSynergy || {}),
      margin: isVersus ? null : (pass ? (finalSuccesses - obstacle) : (obstacle - finalSuccesses)),
      // Versus-specific
      isVersus,
      versusFinalized: isVersus && resolved,
      versusResolvedLabel: isVersus && resolved
        ? game.i18n.format("TB2E.Roll.VersusFinalized", { successes: finalSuccesses })
        : null,
      passLabel: game.i18n.localize("TB2E.Roll.Pass"),
      failLabel: game.i18n.localize("TB2E.Roll.Fail"),
      successesLabel: game.i18n.localize("TB2E.Roll.Successes"),
      obstacleLabel: game.i18n.localize("TB2E.Roll.ObstacleLabel"),
      testLabel: game.i18n.localize("TB2E.Roll.Test"),
      testTypeLabel: isVersus
        ? game.i18n.localize("TB2E.Roll.Versus")
        : (rollData.isBL
          ? game.i18n.format("TB2E.Roll.BLTest", { ability: abilityLabel })
          : game.i18n.localize("TB2E.Roll.Independent")),
      pendingLabel: game.i18n.localize("TB2E.Roll.Pending")
    }
  );

  await message.update({ content: chatContent });
}
