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
    if ( actor.type === "monster" ) {
      // Monsters roll Nature for all conflict actions.
      testKey = "nature";
      testType = "ability";
      baseDice = actor.system.nature;
    } else {
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
    // Monster weapons are embedded in the data model, not items.
    if ( actor.type === "monster" && weaponId.startsWith("__monster_") ) {
      const idx = parseInt(weaponId.replace("__monster_", "").replace("__", ""), 10);
      const mw = actor.system.weapons[idx];
      if ( mw ) weaponBonuses = { name: mw.name, system: mw };
    } else {
      const weaponItem = actor.items.get(weaponId);
      if ( weaponItem ) {
        weaponBonuses = { name: weaponItem.name, system: weaponItem.system };
      }
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

/* ============================================ */
/*  Order of Might & Precedence                  */
/* ============================================ */

// Conflict types governed by the Order of Might (SG pp.79-80, 174).
const MIGHT_CONFLICT_TYPES = new Set(["kill", "capture", "driveOff"]);

// Conflict types governed by Precedence / Aura of Authority (SG p.82).
const PRECEDENCE_CONFLICT_TYPES = new Set(["convince", "convinceCrowd", "negotiate"]);

/**
 * Parse a Precedence value which may be stored as a string on monsters
 * ("6", "1-4", "—", "", undefined) or as a number on characters/NPCs.
 * Returns an integer or null if the creature has no applicable Precedence.
 * For ranged values like "1-4", takes the upper bound (worst case for players).
 * @param {string|number|null|undefined} raw
 * @returns {number|null}
 */
export function parsePrecedence(raw) {
  if ( raw == null || raw === "" ) return null;
  if ( typeof raw === "number" ) return Number.isFinite(raw) ? raw : null;
  const str = String(raw).trim();
  if ( !str || str === "—" || str === "-" ) return null;
  // Handle ranges like "1-4": take the higher bound.
  const range = str.match(/^(\d+)\s*-\s*(\d+)$/);
  if ( range ) return parseInt(range[2], 10);
  const n = parseInt(str, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Read a combatant's actor-side value for a given field, handling unlinked
 * synthetic actors. Returns null if no actor is accessible.
 * @param {Combatant} combatant
 * @param {(actor: Actor) => *} read
 * @returns {*}
 */
function _readFromActor(combatant, read) {
  const actor = combatant?.actor;
  if ( !actor ) return null;
  try { return read(actor); } catch { return null; }
}

/**
 * Gather every combatant belonging to a given conflict group.
 * @param {Combat} combat
 * @param {string} groupId
 * @returns {Combatant[]}
 */
function _groupCombatants(combat, groupId) {
  if ( !combat || !groupId ) return [];
  return combat.combatants.filter(c => c._source.group === groupId);
}

/**
 * Highest Might on the given team. Follows SG p.62 ("Compare the highest Might
 * or Precedence on each side"). Skips combatants with no actor. Returns 0 if
 * no combatants are present.
 * @param {Combat} combat
 * @param {string} groupId
 * @returns {number}
 */
export function getTeamMight(combat, groupId) {
  const combatants = _groupCombatants(combat, groupId);
  let best = 0;
  let found = false;
  for ( const c of combatants ) {
    const m = _readFromActor(c, a => Number(a.system?.might));
    if ( Number.isFinite(m) ) {
      if ( !found || m > best ) { best = m; found = true; }
    }
  }
  return found ? best : 0;
}

/**
 * Read the Precedence value from an actor of any type. The schema differs:
 *   - character: `system.abilities.precedence` (NumberField)
 *   - npc:       `system.abilities.precedence.rating` (NumberField in a SchemaField)
 *   - monster:   `system.precedence` (StringField, may be "—" / "1-4" / "6")
 * Returns a number, or null when the actor has no applicable Precedence.
 * @param {Actor} actor
 * @returns {number|null}
 */
function _readActorPrecedence(actor) {
  if ( !actor ) return null;
  if ( actor.type === "monster" ) return parsePrecedence(actor.system?.precedence);
  const ap = actor.system?.abilities?.precedence;
  if ( ap == null ) return null;
  if ( typeof ap === "number" ) return Number.isFinite(ap) ? ap : null;
  if ( typeof ap === "object" && "rating" in ap ) {
    const n = Number(ap.rating);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Highest Precedence on the given team. Monsters store Precedence as a string
 * (including "—" for "does not apply"), so those combatants are skipped when
 * determining team precedence. If no combatant on the team has a numeric
 * Precedence, returns null — the Aura of Authority rule then does not apply
 * in comparisons against this team.
 * @param {Combat} combat
 * @param {string} groupId
 * @returns {number|null}
 */
export function getTeamPrecedence(combat, groupId) {
  const combatants = _groupCombatants(combat, groupId);
  let best = null;
  for ( const c of combatants ) {
    const value = _readFromActor(c, _readActorPrecedence);
    if ( value == null || !Number.isFinite(value) ) continue;
    if ( best == null || value > best ) best = value;
  }
  return best;
}

/**
 * Compute the Order of Might / Aura of Authority success bonus for the acting
 * team. Applies only to kill/capture/driveOff (Might) and
 * convince/convinceCrowd/negotiate (Precedence). The bonus is post-roll, +1s
 * per point greater than the opposing team (SG p.80 "The Greater the Might,
 * the More You Hurt"; SG p.82 "The Aura of Authority"). Returns null when the
 * rule does not apply or when the acting team does not hold the advantage.
 * @param {object} options
 * @param {string} options.conflictType
 * @param {string} options.ourGroupId
 * @param {string} options.opponentGroupId
 * @param {Combat} options.combat
 * @returns {object|null}
 */
export function computeOrderModifier({ conflictType, ourGroupId, opponentGroupId, combat }) {
  if ( !combat || !ourGroupId || !opponentGroupId ) return null;

  let ours, theirs, labelKey, attribute;
  if ( MIGHT_CONFLICT_TYPES.has(conflictType) ) {
    ours = getTeamMight(combat, ourGroupId);
    theirs = getTeamMight(combat, opponentGroupId);
    labelKey = "TB2E.Conflict.Order.MightAdvantage";
    attribute = "might";
  } else if ( PRECEDENCE_CONFLICT_TYPES.has(conflictType) ) {
    ours = getTeamPrecedence(combat, ourGroupId);
    theirs = getTeamPrecedence(combat, opponentGroupId);
    // SG p.82: the rule compares Precedence values; if one side has none, no
    // comparison is possible (their opponent "won't be heard").
    if ( ours == null || theirs == null ) return null;
    labelKey = "TB2E.Conflict.Order.PrecedenceAdvantage";
    attribute = "precedence";
  } else {
    return null;
  }

  const diff = ours - theirs;
  if ( diff <= 0 ) return null;

  return {
    label: game.i18n.format(labelKey, { n: diff }),
    type: "success",
    value: diff,
    source: "conflict",
    icon: attribute === "might" ? "fa-solid fa-hand-fist" : "fa-solid fa-crown",
    color: "--tb-amber",
    timing: "post"
  };
}

/**
 * Determine whether the acting team's chosen conflict type exceeds what the
 * Order of Might or Precedence scale allows (SG p.79 for Might, SG p.82 for
 * Precedence). Non-blocking — the GM can still proceed. Returns null when the
 * conflict is within scale, or a warning descriptor otherwise.
 *
 * Might scale (relative to acting team's highest Might):
 *   capture   ≤ ours
 *   kill      ≤ ours + 1
 *   driveOff  ≤ ours + 2
 *
 * Precedence scale (relative to acting team's highest Precedence):
 *   convince       ≤ ours
 *   negotiate      ≤ ours + 1
 *   convinceCrowd  ≤ ours + 2
 *   trick/riddle   — no restriction (SG p.82)
 *
 * @param {object} options
 * @param {string} options.conflictType
 * @param {string} options.partyGroupId  The adventurers' group (the one being scale-checked).
 * @param {string} options.opponentGroupId
 * @param {Combat} options.combat
 * @returns {{ attribute: "might"|"precedence", conflictType: string, ours: number, theirs: number, limit: number }|null}
 */
export function checkTooMuchToHandle({ conflictType, partyGroupId, opponentGroupId, combat }) {
  if ( !combat || !partyGroupId || !opponentGroupId ) return null;

  const mightSteps = { capture: 0, kill: 1, driveOff: 2 };
  const precedenceSteps = { convince: 0, negotiate: 1, convinceCrowd: 2 };

  if ( conflictType in mightSteps ) {
    const ours = getTeamMight(combat, partyGroupId);
    const theirs = getTeamMight(combat, opponentGroupId);
    const limit = ours + mightSteps[conflictType];
    if ( theirs > limit ) {
      return { attribute: "might", conflictType, ours, theirs, limit };
    }
    return null;
  }

  if ( conflictType in precedenceSteps ) {
    const ours = getTeamPrecedence(combat, partyGroupId);
    const theirs = getTeamPrecedence(combat, opponentGroupId);
    // If the acting team has no Precedence to speak of, they literally can't
    // engage in a Precedence conflict (SG p.82: "you simply won't be heard").
    if ( ours == null ) {
      return { attribute: "precedence", conflictType, ours: null, theirs: theirs ?? null, limit: null };
    }
    if ( theirs == null ) return null;
    const limit = ours + precedenceSteps[conflictType];
    if ( theirs > limit ) {
      return { attribute: "precedence", conflictType, ours, theirs, limit };
    }
    return null;
  }

  return null;
}

/* -------------------------------------------- */

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
