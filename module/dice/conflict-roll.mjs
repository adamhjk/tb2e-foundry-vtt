/**
 * Conflict volley resolution logic.
 *
 * Determines interaction types, calculates dice pools, evaluates rolls,
 * and applies damage/effects per the Torchbearer 2E conflict rules (SG pp.58-80).
 */

/**
 * Determine the interaction type for two opposing actions.
 * @param {string} action1  The first team's action key.
 * @param {string} action2  The second team's action key.
 * @returns {string}        "independent", "versus", or "none"
 */
export function getInteraction(action1, action2) {
  return CONFIG.TB2E.conflictInteractions[`${action1}:${action2}`] ?? "independent";
}

/**
 * Build the resolution context for one side of a volley.
 * @param {object} options
 * @param {string} options.action         This side's action key.
 * @param {string} options.opponentAction The opponent's action key.
 * @param {string} options.conflictType   The conflict type key.
 * @param {object} options.combatant      The acting Combatant document.
 * @param {object} options.actor          The acting Actor document.
 * @param {number} [options.impede=0]     Impede penalty dice from prior maneuver.
 * @param {number} [options.position=0]   Position bonus dice from prior maneuver.
 * @returns {object}                       Resolution context.
 */
export function buildResolutionContext({
  action, opponentAction, conflictType, combatant, actor, impede = 0, position = 0
}) {
  const interaction = getInteraction(action, opponentAction);
  // Use effective config from combat when available (handles manual overrides).
  const combat = combatant?.combat;
  const typeCfg = combat?.getEffectiveConflictConfig?.() ?? CONFIG.TB2E.conflictTypes[conflictType];
  const actionCfg = typeCfg?.actions?.[action];

  // Determine if this side tests at all.
  // "none" means this side does NOT test.
  const tests = interaction !== "none";

  // Determine the skill/ability and base dice.
  let testKey = null;
  let testType = null;
  let baseDice = 0;

  if ( tests && actionCfg ) {
    testType = actionCfg.type;
    // Pick the first matching key the actor actually has.
    for ( const key of actionCfg.keys ) {
      if ( testType === "skill" ) {
        const rating = actor.system.skills?.[key]?.rating || 0;
        if ( rating > 0 || actionCfg.keys.length === 1 ) {
          testKey = key;
          baseDice = rating;
          break;
        }
      } else {
        const rating = actor.system.abilities?.[key]?.rating || 0;
        if ( rating > 0 || actionCfg.keys.length === 1 ) {
          testKey = key;
          baseDice = rating;
          break;
        }
      }
    }
    // Fallback to first key if none found.
    if ( !testKey && actionCfg.keys.length ) {
      testKey = actionCfg.keys[0];
      if ( testType === "skill" ) baseDice = actor.system.skills?.[testKey]?.rating || 0;
      else baseDice = actor.system.abilities?.[testKey]?.rating || 0;
    }
  }

  // Calculate obstacle for independent tests.
  let obstacle = 0;
  if ( interaction === "independent" ) {
    obstacle = CONFIG.TB2E.conflictObstacles[action] || 0;
  }

  // Apply maneuver effects.
  let bonusDice = position;
  let penaltyDice = impede;

  // Weapon data for future bonus application.
  const weaponId = combatant.system.weaponId || actor.system.conflict?.weaponId || "";
  const isUnarmed = weaponId === "__unarmed__";
  let weaponBonuses = null;
  if ( weaponId && weaponId !== "__unarmed__" && weaponId !== "__improvised__" ) {
    const weaponItem = actor.items.get(weaponId);
    if ( weaponItem ) {
      weaponBonuses = { name: weaponItem.name, system: weaponItem.system };
    }
  }

  return {
    action,
    opponentAction,
    interaction,
    tests,
    testType,
    testKey,
    baseDice,
    bonusDice,
    penaltyDice,
    obstacle,
    weapon: combatant.system.weapon || actor.system.conflict?.weapon || "",
    weaponId,
    isUnarmed,
    weaponBonuses,
    actorName: actor.name,
    actorImg: actor.img
  };
}

/**
 * Calculate the margin of success from a roll.
 * @param {number} successes  Number of successes rolled.
 * @param {number} obstacle   The obstacle number (0 for versus).
 * @param {number} [opponentSuccesses=0]  Opponent successes for versus tests.
 * @param {string} interaction  The interaction type.
 * @returns {{ margin: number, success: boolean }}
 */
export function calculateMargin(successes, obstacle, opponentSuccesses = 0, interaction = "independent") {
  if ( interaction === "versus" ) {
    const margin = successes - opponentSuccesses;
    return { margin: Math.max(margin, 0), success: margin > 0 };
  }
  const margin = successes - obstacle;
  return { margin: Math.max(margin, 0), success: margin >= 0 };
}

/**
 * Determine the effect of a successful action.
 * @param {string} action           The action key.
 * @param {number} margin           The margin of success.
 * @param {string} interaction      The interaction type.
 * @returns {object}                Effect description.
 */
export function resolveActionEffect(action, margin, interaction) {
  switch ( action ) {
    case "attack":
      return { type: "damage", amount: margin, description: `Deal ${margin} damage` };

    case "feint":
      return { type: "damage", amount: margin, description: `Deal ${margin} damage (feint)` };

    case "defend":
      if ( interaction === "independent" ) {
        // Regroup: restore 1 + MoS on success at Ob 3
        const restore = margin > 0 ? 1 + margin : 0;
        return { type: "restore", amount: restore, description: `Restore ${restore} HP (regroup)` };
      }
      // Versus win: restore MoS
      return { type: "restore", amount: margin, description: `Restore ${margin} HP (defend)` };

    case "maneuver":
      return { type: "maneuver", amount: margin, description: `${margin} MoS to spend on effects` };

    default:
      return { type: "none", amount: 0, description: "" };
  }
}

/**
 * Calculate compromise level from remaining vs starting disposition.
 * @param {number} remaining  Remaining disposition.
 * @param {number} starting   Starting disposition.
 * @returns {string}          "minor", "half", or "major"
 */
export function compromiseLevel(remaining, starting) {
  if ( starting <= 0 ) return "major";
  const ratio = remaining / starting;
  if ( ratio > 0.5 ) return "minor";
  if ( ratio > 0.25 ) return "half";
  return "major";
}
