import { abilities, skills } from "../config.mjs";

/* ============================================ */
/*  Shared Roll Utility Functions               */
/* ============================================ */

/**
 * Recalculate final successes and pass/fail after a post-roll dice change.
 * Handles both versus mode (no obstacle) and independent mode (with conditional bonuses).
 * @param {object} options
 * @param {number} options.successes - Raw success count after dice modification.
 * @param {number|null} options.obstacle - Obstacle number (null for versus).
 * @param {object[]} options.postSuccessMods - Array of post-success modifiers with `.value`.
 * @param {boolean} options.isVersus - Whether this is a versus roll.
 * @returns {{ finalSuccesses: number, pass: boolean|null }}
 */
export function recalculateSuccesses({ successes, obstacle, postSuccessMods = [], isVersus }) {
  if ( isVersus || obstacle == null ) {
    const successBonus = postSuccessMods.reduce((s, m) => s + m.value, 0);
    return { finalSuccesses: Math.max(successes + successBonus, 0), pass: null };
  }
  const autoBonus = postSuccessMods.filter(m => m.value < 0).reduce((s, m) => s + m.value, 0);
  const conditionalBonus = postSuccessMods.filter(m => m.value > 0).reduce((s, m) => s + m.value, 0);
  const adjusted = successes + autoBonus;
  const isPass = adjusted >= obstacle;
  const finalSuccesses = isPass ? adjusted + conditionalBonus : adjusted;
  const pass = finalSuccesses >= obstacle;
  return { finalSuccesses, pass };
}

/**
 * Process wise aiders after a roll is resolved — mark pass/fail on their wise.
 * Handles owned actors (direct update) and non-owned (mailbox pattern).
 * @param {object} options
 * @param {object[]} options.wiseAiders - Array of { id, wiseIndex } objects.
 * @param {boolean} options.pass - Whether the roll passed.
 * @param {Function} options.checkWiseAdvancement - Callback: (actor, wiseIndex) => void.
 */
export async function processWiseAiders({ wiseAiders, pass, checkWiseAdvancement }) {
  const field = pass ? "pass" : "fail";
  for ( const aider of wiseAiders ) {
    const aiderActor = game.actors.get(aider.id);
    if ( !aiderActor ) continue;
    if ( aiderActor.isOwner ) {
      const wises = foundry.utils.deepClone(aiderActor.system.wises);
      if ( wises[aider.wiseIndex] ) {
        wises[aider.wiseIndex][field] = true;
        await aiderActor.update({ "system.wises": wises });
        checkWiseAdvancement(aiderActor, aider.wiseIndex);
      }
    } else {
      await aiderActor.setFlag("tb2e", "pendingWiseAdvancement", {
        wiseIndex: aider.wiseIndex,
        field
      });
    }
  }
}

/**
 * Calculate nature tax amount for a failed or out-of-descriptor roll.
 * @param {object} options
 * @param {boolean} options.pass - Whether the roll passed.
 * @param {number} options.obstacle - The obstacle number.
 * @param {number} options.finalSuccesses - Final success count.
 * @returns {number} Tax amount (1 on pass, margin-of-failure on fail, min 1).
 */
export function calculateNatureTax({ pass, obstacle, finalSuccesses }) {
  if ( pass ) return 1;
  return Math.max(obstacle - finalSuccesses, 1);
}

/**
 * Build the template data object for rendering `roll-result.hbs`.
 * Callers spread mode-specific overrides on top.
 * @param {object} options
 * @param {Actor} options.actor
 * @param {object} options.rollData - The roll data from flags.
 * @param {object} options.tbFlags - The full tb2e flags object.
 * @param {boolean} options.isVersus
 * @param {object[]} options.synergyHelpers - Pre-built synergy helpers array.
 * @returns {object} Template data for roll-result.hbs.
 */
export function buildChatTemplateData({ actor, rollData, tbFlags, isVersus, synergyHelpers }) {
  const diceResults = rollData.diceResults || [];
  const finalSuccesses = rollData.finalSuccesses ?? rollData.successes;
  const obstacle = rollData.obstacle;
  const pass = rollData.pass;

  const abilityLabel = rollData.blAbilityKey
    ? game.i18n.localize(abilities[rollData.blAbilityKey]?.label)
    : null;

  const actorSubtitle = actor.type === "npc"
    ? (() => { const parts = [actor.system.stock, actor.system.class].filter(Boolean); return parts.length ? `NPC \u2014 ${parts.join(" ")}` : "NPC"; })()
    : "";

  const margin = isVersus ? null : (pass ? (finalSuccesses - obstacle) : (obstacle - finalSuccesses));

  // Maneuver MoS spend button — only on independent maneuver wins (versus
  // maneuvers surface the button on the versus resolution card instead).
  const tc = tbFlags.testContext || {};
  const showManeuverSpend = !isVersus
    && tc.isConflict
    && tc.conflictAction === "maneuver"
    && pass
    && margin > 0
    && !tbFlags.maneuverSpent;

  return {
    actorName: actor.name,
    actorImg: actor.img,
    actorSubtitle,
    label: rollData.label,
    baseDice: rollData.baseDice,
    poolSize: rollData.poolSize,
    obstacle: isVersus ? null : obstacle,
    successes: finalSuccesses,
    pass: isVersus ? null : pass,
    modifiers: (rollData.modifiers || []).filter(m => m.timing === "pre"),
    diceResults,
    postSuccessMods: (tbFlags.postSuccessMods || []).length ? tbFlags.postSuccessMods : null,
    isBL: !!rollData.isBL,
    blAbilityLabel: abilityLabel,
    hasPostActions: !tbFlags.resolved,
    hasSuns: diceResults.some(d => d.isSun),
    hasWyrms: diceResults.some(d => !d.success),
    sunCount: diceResults.filter(d => d.isSun).length,
    wyrmCount: diceResults.filter(d => !d.success).length,
    wiseSelected: !!tbFlags.wise,
    hasFate: actor.type === "character" && actor.system.fate.current > 0,
    hasPersona: actor.type === "character" && actor.system.persona.current > 0,
    synergyHelpers,
    isVersus,
    margin,
    showManeuverSpend,
    maneuverSpendLabel: showManeuverSpend
      ? game.i18n.format("TB2E.Conflict.Maneuver.SpendButton", { mos: margin })
      : null,
    maneuverSpent: !!tbFlags.maneuverSpent,
    passLabel: game.i18n.localize("TB2E.Roll.Pass"),
    failLabel: game.i18n.localize("TB2E.Roll.Fail"),
    successesLabel: game.i18n.localize("TB2E.Roll.Successes"),
    obstacleLabel: game.i18n.localize("TB2E.Roll.ObstacleLabel"),
    testLabel: game.i18n.localize("TB2E.Roll.Test"),
    testTypeLabel: tbFlags.testContext?.isDisposition
      ? game.i18n.localize("TB2E.Conflict.Disposition")
      : isVersus
        ? game.i18n.localize("TB2E.Roll.Versus")
        : (rollData.isBL
          ? game.i18n.format("TB2E.Roll.BLTest", { ability: abilityLabel })
          : game.i18n.localize("TB2E.Roll.Independent")),
    pendingLabel: game.i18n.localize("TB2E.Roll.Pending"),
    spellName: tbFlags.testContext?.spellName ?? null,
    invocationName: tbFlags.testContext?.invocationName ?? null
  };
}

/**
 * Map helper objects to the minimal shape stored in ChatMessage flags.
 * @param {object[]} helpers
 * @returns {object[]}
 */
export function mapHelpersForFlags(helpers) {
  return (helpers || []).map(h => ({
    id: h.id, name: h.name, helpVia: h.helpVia, helpViaType: h.helpViaType, synergy: !!h.synergy
  }));
}

/**
 * Map wise aider objects to the minimal shape stored in ChatMessage flags.
 * @param {object[]} wiseAiders
 * @returns {object[]}
 */
export function mapWiseAidersForFlags(wiseAiders) {
  return (wiseAiders || []).map(wa => ({
    id: wa.id, name: wa.name, wiseIndex: wa.wiseIndex, wiseName: wa.wiseName
  }));
}

/**
 * Log advancement for one side of a roll, handling the BL vs normal distinction.
 * Accepts callbacks to avoid circular imports.
 * @param {object} options
 * @param {Actor} options.actor
 * @param {string} options.type - "ability" or "skill".
 * @param {string} options.key - Ability/skill key.
 * @param {number} options.baseDice
 * @param {boolean} options.pass
 * @param {boolean} options.isBL - Whether this is a Beginner's Luck test.
 * @param {Function} options.logAdvancement - Callback: ({ actor, type, key, baseDice, pass }) => Promise.
 * @param {Function} options.logBLLearning - Callback: ({ actor, key }) => Promise.
 */
export async function logAdvancementForSide({ actor, type, key, baseDice, pass, isBL, logAdvancement, logBLLearning }) {
  if ( isBL ) {
    await logBLLearning({ actor, key });
  } else {
    await logAdvancement({ actor, type, key, baseDice, pass });
  }
}
