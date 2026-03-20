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
 * Get an ability rating from an actor.
 * @param {Actor} actor
 * @param {string} key
 * @returns {number}
 */
function _getAbilityRating(actor, key) {
  // Monsters store nature directly on system (no abilities object)
  if ( !actor.system.abilities ) return actor.system[key] ?? 0;
  return actor.system.abilities[key]?.rating ?? 0;
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

  // Build candidate list from scene tokens filtered by conflict team.
  let pool;
  if ( candidates ) {
    pool = candidates;
  } else {
    // Build pool from scene tokens so unlinked actors are included.
    // Helpers must be on the same conflict team as the roller.
    const rollerTeam = actor.system.conflict?.team ?? "party";
    const rollerTokenId = actor.isToken ? actor.token?.id : null;
    pool = (canvas?.scene?.tokens ?? []).filter(t => {
      if ( !t.actor ) return false;
      // Exclude the roller: by token ID for unlinked tokens (so other tokens sharing the
      // same base actor are NOT excluded), or by actorId for linked actors.
      if ( rollerTokenId ? t.id === rollerTokenId : t.actorId === actor.id ) return false;
      return (t.actor.system.conflict?.team ?? "party") === rollerTeam;
    });
  }

  const results = [];

  for ( const raw of pool ) {
    // Candidates may be Combatant or Actor objects — normalize to actor for ability checks.
    // Combatant.name resolves to the token name (e.g. "Kobold (1)"); Actor.name is actor name.
    const candidate = raw.actor ?? raw;

    // Skip the roller — only needed for default pool path; when candidates is
    // explicitly provided the caller has already excluded the roller by combatant ID.
    if ( !candidates && candidate.id === actor.id ) continue;

    // Check blocking conditions
    const { blocked } = isBlockedFromHelping(candidate);
    if ( blocked ) continue;

    // Find best help path for this candidate
    const match = _findBestHelpPath(candidate, type, key, actor, testContext);
    if ( !match ) continue;

    results.push({
      id: candidate.id,
      name: raw.name,          // token name if Combatant, actor name if Actor
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
 * @typedef {object} EligibleWiseAider
 * @property {string} id - Actor ID
 * @property {string} name - Actor name
 * @property {number} wiseIndex - Index into actor.system.wises
 * @property {string} wiseName - The wise name
 */

/**
 * Determine which actors can provide "I Am Wise" aid (+1D) for a test.
 * All named wises from eligible characters are returned — the roller/GM decides relevance.
 * @param {object} options
 * @param {Actor} options.actor - The roller (excluded)
 * @param {object} [options.testContext={}]
 * @param {Actor[]} [options.candidates] - Override candidate list
 * @returns {EligibleWiseAider[]}
 */
export function getEligibleWiseAiders({ actor, testContext = {}, candidates }) {
  // Recovery and lifestyle tests cannot receive wise aid
  if ( testContext.isRecovery ) return [];
  if ( testContext.isLifestyle ) return [];

  // Build candidate pool
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

  for ( const raw of pool ) {
    const candidate = raw.actor ?? raw;
    if ( !candidates && candidate.id === actor.id ) continue;
    if ( candidate.type !== "character" ) continue;

    // Check blocking conditions
    const { blocked } = isBlockedFromHelping(candidate);
    if ( blocked ) continue;

    // Collect all named wises
    const wises = candidate.system.wises || [];
    for ( let i = 0; i < wises.length; i++ ) {
      const wise = wises[i];
      if ( !wise.name ) continue;
      results.push({
        id: candidate.id,
        name: raw.name,
        wiseIndex: i,
        wiseName: wise.name
      });
    }
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
