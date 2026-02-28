import { abilities, skills } from "../config.mjs";

/**
 * @typedef {object} EligibleHelper
 * @property {string} id - Actor ID
 * @property {string} name - Actor name
 * @property {string} helpVia - Skill/ability key they help with
 * @property {string} helpViaLabel - Localized label
 * @property {string} reason - Why they qualify (localization key)
 * @property {string[]} warnings - Optional warnings (spell time, etc.)
 */

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

  // Build candidate list
  const pool = candidates ?? game.actors.filter(a => a.type === "character" && a.id !== actor.id);

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
      helpViaLabel: match.helpViaLabel,
      reason: match.reason,
      warnings: match.warnings
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
 * @returns {{ helpVia: string, helpViaLabel: string, reason: string, warnings: string[] }|null}
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
  const abilityData = candidate.system.abilities[key];
  if ( abilityData && abilityData.rating > 0 ) {
    const cfg = abilities[key];
    return {
      helpVia: key,
      helpViaLabel: game.i18n.localize(cfg.label),
      reason: "TB2E.Help.SameAbility",
      warnings
    };
  }

  // Nature with descriptor (always offered as option — GM verifies descriptor relevance)
  const natureData = candidate.system.abilities.nature;
  if ( natureData && natureData.rating > 0 ) {
    return {
      helpVia: "nature",
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
  const sameSkillData = candidate.system.skills[key];
  if ( sameSkillData && sameSkillData.rating > 0 ) {
    return {
      helpVia: key,
      helpViaLabel: game.i18n.localize(skillCfg.label),
      reason: "TB2E.Help.SameSkill",
      warnings
    };
  }

  // 2. Suggested help skill at rating > 0
  const helpSkills = skillCfg.help || [];
  for ( const helpKey of helpSkills ) {
    const helpSkillData = candidate.system.skills[helpKey];
    if ( helpSkillData && helpSkillData.rating > 0 ) {
      const helpCfg = skills[helpKey];
      return {
        helpVia: helpKey,
        helpViaLabel: game.i18n.localize(helpCfg.label),
        reason: "TB2E.Help.SuggestedHelp",
        warnings
      };
    }
  }

  // 3. Beginner's Luck help: if the roller is using BL (skill rating 0),
  //    helpers can use the BL ability (Will or Health)
  const rollerSkillData = roller.system.skills[key];
  if ( !rollerSkillData || rollerSkillData.rating === 0 ) {
    const blAbilityKey = skillCfg.bl === "H" ? "health" : "will";
    const blAbilityData = candidate.system.abilities[blAbilityKey];
    if ( blAbilityData && blAbilityData.rating > 0 ) {
      const blCfg = abilities[blAbilityKey];
      return {
        helpVia: blAbilityKey,
        helpViaLabel: game.i18n.localize(blCfg.label),
        reason: "TB2E.Help.BLAbility",
        warnings
      };
    }
  }

  // 4. Nature with descriptor (GM verifies relevance)
  const natureData = candidate.system.abilities.nature;
  if ( natureData && natureData.rating > 0 ) {
    return {
      helpVia: "nature",
      helpViaLabel: game.i18n.localize(abilities.nature.label),
      reason: "TB2E.Help.NatureDescriptor",
      warnings
    };
  }

  return null;
}
