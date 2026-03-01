import { abilities, skills } from "../config.mjs";

/**
 * @typedef {object} EligibleHelper
 * @property {string} id - Actor ID
 * @property {string} name - Actor name
 * @property {string} helpVia - Skill/ability key they help with
 * @property {string} helpViaType - "ability" or "skill"
 * @property {string} helpViaLabel - Localized label
 * @property {string} reason - Why they qualify (localization key)
 * @property {string[]} warnings - Optional warnings (spell time, etc.)
 * @property {boolean} isNPC - Whether this helper is an NPC
 * @property {boolean} hasFate - Whether helper is a character with fate > 0
 */

/* -------------------------------------------- */
/*  Data Access Helpers                         */
/* -------------------------------------------- */

/**
 * Get an ability rating from an actor, handling both character (object) and NPC (flat number) data.
 * @param {Actor} actor
 * @param {string} key
 * @returns {number}
 */
function _getAbilityRating(actor, key) {
  const data = actor.system.abilities[key];
  if ( typeof data === "number" ) return data;
  return data?.rating ?? 0;
}

/**
 * Get a skill rating from an actor, handling both character (keyed object) and NPC (array) data.
 * @param {Actor} actor
 * @param {string} key
 * @returns {number}
 */
function _getSkillRating(actor, key) {
  const skillData = actor.system.skills;
  if ( Array.isArray(skillData) ) {
    const entry = skillData.find(s => s.key === key);
    return entry?.rating ?? 0;
  }
  return skillData[key]?.rating ?? 0;
}

/**
 * Check if an actor is blocked from helping anyone.
 * @param {Actor} actor
 * @returns {{ blocked: boolean, reason: string|null }}
 */
export function isBlockedFromHelping(actor) {
  if ( actor.system.conditions.dead ) return { blocked: true, reason: "TB2E.Help.BlockedDead" };
  if ( actor.system.conditions.afraid ) return { blocked: true, reason: "TB2E.Help.BlockedAfraid" };
  return { blocked: false, reason: null };
}

/**
 * Determine which actors can help with a test.
 * @param {object} options
 * @param {Actor} options.actor - The roller (excluded)
 * @param {"ability"|"skill"} options.type
 * @param {string} options.key - Ability/skill key
 * @param {object} [options.testContext={}]
 * @param {boolean} [options.testContext.isRecovery] - Will/Health recovery test
 * @param {boolean} [options.testContext.isLifestyle] - Resources lifestyle test
 * @param {boolean} [options.testContext.isConflict] - Conflict action test
 * @param {boolean} [options.testContext.isSpell] - Spell cast
 * @param {boolean} [options.testContext.isInvocation] - Invocation ritual
 * @param {Actor[]} [options.candidates] - Override candidate list (e.g. conflict team)
 * @returns {EligibleHelper[]}
 */
export function getEligibleHelpers({ actor, type, key, testContext = {}, candidates }) {

  // Recovery and lifestyle tests cannot receive help
  if ( testContext.isRecovery ) return [];
  if ( testContext.isLifestyle ) return [];

  // Build candidate list — characters + NPCs with tokens in the current scene
  let pool;
  if ( candidates ) {
    pool = candidates;
  } else {
    const sceneActorIds = new Set(
      (canvas?.scene?.tokens ?? []).map(t => t.actorId).filter(Boolean)
    );
    pool = game.actors.filter(a => {
      if ( a.id === actor.id ) return false;
      if ( a.type === "character" ) return true;
      if ( a.type === "npc" ) return sceneActorIds.has(a.id);
      return false;
    });
  }

  const results = [];

  for ( const candidate of pool ) {
    // Skip the roller
    if ( candidate.id === actor.id ) continue;

    // Check blocking conditions
    const { blocked } = isBlockedFromHelping(candidate);
    if ( blocked ) continue;

    // Find best help path for this candidate
    const match = _findBestHelpPath(candidate, type, key, actor, testContext);
    if ( !match ) continue;

    results.push({
      id: candidate.id,
      name: candidate.name,
      helpVia: match.helpVia,
      helpViaType: match.helpViaType,
      helpViaLabel: match.helpViaLabel,
      reason: match.reason,
      warnings: match.warnings,
      isNPC: candidate.type === "npc",
      hasFate: candidate.type === "character" && candidate.system.fate.current > 0
    });
  }

  return results;
}

/**
 * Find the best help path a candidate can use for a given test.
 * Returns null if the candidate cannot help.
 * @param {Actor} candidate - The potential helper.
 * @param {"ability"|"skill"} type - Roll type.
 * @param {string} key - The ability/skill key being tested.
 * @param {Actor} roller - The actor making the test.
 * @param {object} testContext - Test context flags.
 * @returns {{ helpVia: string, helpViaType: string, helpViaLabel: string, reason: string, warnings: string[] }|null}
 * @private
 */
function _findBestHelpPath(candidate, type, key, roller, testContext) {
  const warnings = [];

  // Spell/invocation time warnings
  if ( testContext.isSpell && key === "arcanist" ) warnings.push("TB2E.Help.SpellTimeWarning");
  if ( testContext.isInvocation && key === "ritualist" ) warnings.push("TB2E.Help.InvocationTimeWarning");

  if ( type === "ability" ) {
    return _findAbilityHelpPath(candidate, key, warnings);
  }
  return _findSkillHelpPath(candidate, key, roller, warnings);
}

/**
 * Find help path for an ability test.
 * @private
 */
function _findAbilityHelpPath(candidate, key, warnings) {
  // Same ability at rating > 0
  if ( _getAbilityRating(candidate, key) > 0 ) {
    const cfg = abilities[key];
    return {
      helpVia: key,
      helpViaType: "ability",
      helpViaLabel: game.i18n.localize(cfg.label),
      reason: "TB2E.Help.SameAbility",
      warnings
    };
  }

  // Nature with descriptor (always offered as option — GM verifies descriptor relevance)
  if ( _getAbilityRating(candidate, "nature") > 0 ) {
    return {
      helpVia: "nature",
      helpViaType: "ability",
      helpViaLabel: game.i18n.localize(abilities.nature.label),
      reason: "TB2E.Help.NatureDescriptor",
      warnings
    };
  }

  return null;
}

/**
 * Find help path for a skill test.
 * Priority: same skill > suggested help skill > BL ability > Nature
 * @private
 */
function _findSkillHelpPath(candidate, key, roller, warnings) {
  const skillCfg = skills[key];
  if ( !skillCfg ) return null;

  // 1. Same skill at rating > 0
  if ( _getSkillRating(candidate, key) > 0 ) {
    return {
      helpVia: key,
      helpViaType: "skill",
      helpViaLabel: game.i18n.localize(skillCfg.label),
      reason: "TB2E.Help.SameSkill",
      warnings
    };
  }

  // 2. Suggested help skill at rating > 0
  const helpSkills = skillCfg.help || [];
  for ( const helpKey of helpSkills ) {
    if ( _getSkillRating(candidate, helpKey) > 0 ) {
      const helpCfg = skills[helpKey];
      return {
        helpVia: helpKey,
        helpViaType: "skill",
        helpViaLabel: game.i18n.localize(helpCfg.label),
        reason: "TB2E.Help.SuggestedHelp",
        warnings
      };
    }
  }

  // 3. Beginner's Luck help: if the roller is using BL (skill rating 0),
  //    helpers can use the BL ability (Will or Health).
  //    NPCs don't use BL, so skip this path if the roller is an NPC.
  if ( roller.type === "character" && _getSkillRating(roller, key) === 0 ) {
    const blAbilityKey = skillCfg.bl === "H" ? "health" : "will";
    if ( _getAbilityRating(candidate, blAbilityKey) > 0 ) {
      const blCfg = abilities[blAbilityKey];
      return {
        helpVia: blAbilityKey,
        helpViaType: "ability",
        helpViaLabel: game.i18n.localize(blCfg.label),
        reason: "TB2E.Help.BLAbility",
        warnings
      };
    }
  }

  // 4. Nature with descriptor (GM verifies relevance)
  if ( _getAbilityRating(candidate, "nature") > 0 ) {
    return {
      helpVia: "nature",
      helpViaType: "ability",
      helpViaLabel: game.i18n.localize(abilities.nature.label),
      reason: "TB2E.Help.NatureDescriptor",
      warnings
    };
  }

  return null;
}
