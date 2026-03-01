/**
 * Torchbearer 2E system configuration constants.
 */

/**
 * Condition definitions. Order matters — this is the display order on the strip.
 * @enum {object}
 */
export const conditions = {
  fresh:     { label: "TB2E.Condition.Fresh",     icon: "fa-solid fa-sun",            color: "--tb-cond-fresh",     page: "SG p.46" },
  hungry:    { label: "TB2E.Condition.Hungry",    icon: "fa-solid fa-drumstick-bite", color: "--tb-cond-hungry",    page: "SG p.47" },
  angry:     { label: "TB2E.Condition.Angry",     icon: "fa-solid fa-face-angry",     color: "--tb-cond-angry",     page: "SG pp.47-48" },
  afraid:    { label: "TB2E.Condition.Afraid",    icon: "fa-solid fa-ghost",          color: "--tb-cond-afraid",    page: "SG p.48" },
  exhausted: { label: "TB2E.Condition.Exhausted", icon: "fa-solid fa-bed",            color: "--tb-cond-exhausted", page: "SG pp.48-49" },
  injured:   { label: "TB2E.Condition.Injured",   icon: "fa-solid fa-heart-crack",    color: "--tb-cond-injured",   page: "SG pp.49-50" },
  sick:      { label: "TB2E.Condition.Sick",      icon: "fa-solid fa-biohazard",      color: "--tb-cond-sick",      page: "SG pp.51-52" },
  dead:      { label: "TB2E.Condition.Dead",      icon: "fa-solid fa-skull",          color: "--tb-cond-dead",      page: "SG p.52" }
};

/**
 * Raw abilities (advancement-tracked) and town abilities.
 * @enum {object}
 */
export const abilities = {
  will:       { label: "TB2E.Ability.Will",       group: "raw",     page: "DH p.58" },
  health:     { label: "TB2E.Ability.Health",     group: "raw",     page: "DH p.59" },
  nature:     { label: "TB2E.Ability.Nature",     group: "raw",     page: "DH p.65" },
  resources:  { label: "TB2E.Ability.Resources",  group: "town",    page: "DH p.60" },
  circles:    { label: "TB2E.Ability.Circles",    group: "town",    page: "DH p.61" },
  precedence: { label: "TB2E.Ability.Precedence", group: "town",    page: "DH p.62" },
  might:      { label: "TB2E.Ability.Might",      group: "special", page: "DH p.64" }
};

/**
 * All 34 skills with Beginner's Luck ability reference and suggested help skills.
 * bl: "W" = Will, "H" = Health
 * help: array of skill keys that can provide help dice on tests of this skill
 * @enum {object}
 */
export const skills = {
  alchemist:    { label: "TB2E.Skill.Alchemist",    bl: "W", help: ["loremaster", "laborer"],     page: "DH p.160" },
  arcanist:     { label: "TB2E.Skill.Arcanist",     bl: "W", help: ["loremaster"],                page: "DH p.161" },
  armorer:      { label: "TB2E.Skill.Armorer",       bl: "H", help: ["smith", "laborer"],          page: "DH p.161" },
  carpenter:    { label: "TB2E.Skill.Carpenter",    bl: "H", help: ["alchemist", "laborer"],      page: "DH p.161" },
  cartographer: { label: "TB2E.Skill.Cartographer", bl: "W", help: ["scholar", "pathfinder"],     page: "DH p.162" },
  commander:    { label: "TB2E.Skill.Commander",    bl: "W", help: ["steward", "orator"],         page: "DH p.162" },
  cook:         { label: "TB2E.Skill.Cook",         bl: "W", help: ["alchemist", "laborer"],      page: "DH p.163" },
  criminal:     { label: "TB2E.Skill.Criminal",     bl: "H", help: ["scout", "scholar"],          page: "DH p.163" },
  dungeoneer:   { label: "TB2E.Skill.Dungeoneer",   bl: "H", help: ["sapper", "survivalist"],     page: "DH p.164" },
  fighter:      { label: "TB2E.Skill.Fighter",      bl: "H", help: ["hunter"],                    page: "DH p.164" },
  haggler:      { label: "TB2E.Skill.Haggler",      bl: "W", help: ["manipulator"],               page: "DH p.165" },
  healer:       { label: "TB2E.Skill.Healer",       bl: "W", help: ["survivalist", "alchemist"],  page: "DH p.165" },
  hunter:       { label: "TB2E.Skill.Hunter",       bl: "H", help: ["survivalist", "laborer"],    page: "DH p.166" },
  laborer:      { label: "TB2E.Skill.Laborer",      bl: "H", help: ["peasant"],                   page: "DH pp.166-167" },
  loremaster:   { label: "TB2E.Skill.Loremaster",   bl: "W", help: ["arcanist", "theologian"],    page: "DH p.167" },
  manipulator:  { label: "TB2E.Skill.Manipulator",  bl: "W", help: ["haggler", "persuader"],      page: "DH p.167" },
  mentor:       { label: "TB2E.Skill.Mentor",       bl: "W", help: ["persuader"],                 page: "DH p.168" },
  orator:       { label: "TB2E.Skill.Orator",       bl: "W", help: ["manipulator"],               page: "DH p.168" },
  pathfinder:   { label: "TB2E.Skill.Pathfinder",   bl: "H", help: ["scout", "cartographer"],     page: "DH p.168" },
  peasant:      { label: "TB2E.Skill.Peasant",      bl: "H", help: ["laborer"],                   page: "DH p.169" },
  persuader:    { label: "TB2E.Skill.Persuader",    bl: "W", help: ["manipulator"],               page: "DH p.169" },
  rider:        { label: "TB2E.Skill.Rider",        bl: "H", help: ["peasant"],                   page: "DH p.170" },
  ritualist:    { label: "TB2E.Skill.Ritualist",    bl: "W", help: ["theologian"],                page: "DH p.170" },
  sailor:       { label: "TB2E.Skill.Sailor",       bl: "H", help: ["survivalist", "laborer"],    page: "DH p.171" },
  sapper:       { label: "TB2E.Skill.Sapper",       bl: "H", help: ["alchemist", "laborer"],      page: "DH p.171" },
  scavenger:    { label: "TB2E.Skill.Scavenger",    bl: "H", help: ["scout"],                     page: "DH p.172" },
  scholar:      { label: "TB2E.Skill.Scholar",      bl: "W", help: ["loremaster", "steward"],     page: "DH pp.172-173" },
  scout:        { label: "TB2E.Skill.Scout",        bl: "W", help: ["pathfinder", "hunter"],      page: "DH p.173" },
  smith:        { label: "TB2E.Skill.Smith",        bl: "H", help: ["laborer"],                   page: "DH p.249" },
  steward:      { label: "TB2E.Skill.Steward",      bl: "W", help: ["scholar", "theologian"],     page: "DH p.174" },
  stonemason:   { label: "TB2E.Skill.Stonemason",   bl: "H", help: ["laborer"],                   page: "DH p.174" },
  survivalist:  { label: "TB2E.Skill.Survivalist",  bl: "H", help: ["peasant"],                   page: "DH p.175" },
  theologian:   { label: "TB2E.Skill.Theologian",   bl: "W", help: ["scholar", "ritualist"],      page: "DH p.176" },
  weaver:       { label: "TB2E.Skill.Weaver",       bl: "W", help: ["laborer", "peasant"],        page: "DH p.176" }
};

/**
 * Advancement formula: passes needed = rating, fails needed = rating - 1 (min 1).
 * @param {number} rating - Current ability/skill rating.
 * @returns {{ pass: number, fail: number }}
 */
export function advancementNeeded(rating) {
  return {
    pass: rating,
    fail: Math.max(rating - 1, 1)
  };
}

/**
 * Pack type → number of carried slots.
 * @enum {number}
 */
export const packSlots = {
  none: 0,
  satchel: 3,
  backpack: 6
};

/**
 * Level requirements for advancement (Levels 2-10).
 * @type {Object<number, {fate: number, persona: number, benefit: string}>}
 */
export const levelRequirements = {
  2:  { fate: 4,  persona: 4,  benefit: "TB2E.LevelBenefit.2" },
  3:  { fate: 8,  persona: 8,  benefit: "TB2E.LevelBenefit.3" },
  4:  { fate: 12, persona: 12, benefit: "TB2E.LevelBenefit.4" },
  5:  { fate: 16, persona: 16, benefit: "TB2E.LevelBenefit.5" },
  6:  { fate: 20, persona: 20, benefit: "TB2E.LevelBenefit.6" },
  7:  { fate: 24, persona: 24, benefit: "TB2E.LevelBenefit.7" },
  8:  { fate: 28, persona: 28, benefit: "TB2E.LevelBenefit.8" },
  9:  { fate: 32, persona: 32, benefit: "TB2E.LevelBenefit.9" },
  10: { fate: 36, persona: 36, benefit: "TB2E.LevelBenefit.10" }
};

/**
 * Conflict type definitions with per-action skill/ability mappings.
 * dispositionSkills: skills the captain can choose for the disposition roll.
 * dispositionAbility: ability added to the disposition total.
 * actions: per-action test type and skill/ability keys for this conflict type.
 * @enum {object}
 */
export const conflictTypes = {
  kill: {
    label: "TB2E.Conflict.Type.Kill",
    dispositionSkills: ["fighter"],
    dispositionAbility: "health",
    actions: {
      attack:   { type: "skill",   keys: ["fighter"] },
      defend:   { type: "ability", keys: ["health"] },
      feint:    { type: "skill",   keys: ["fighter"] },
      maneuver: { type: "ability", keys: ["health"] }
    }
  },
  capture: {
    label: "TB2E.Conflict.Type.Capture",
    dispositionSkills: ["fighter", "hunter"],
    dispositionAbility: "will",
    actions: {
      attack:   { type: "skill", keys: ["fighter"] },
      defend:   { type: "skill", keys: ["hunter"] },
      feint:    { type: "skill", keys: ["hunter"] },
      maneuver: { type: "skill", keys: ["fighter"] }
    }
  },
  chase: {
    label: "TB2E.Conflict.Type.Chase",
    dispositionSkills: ["hunter", "pathfinder"],
    dispositionAbility: "health",
    actions: {
      attack:   { type: "skill",   keys: ["hunter", "pathfinder"] },
      defend:   { type: "ability", keys: ["health"] },
      feint:    { type: "skill",   keys: ["hunter", "pathfinder"] },
      maneuver: { type: "ability", keys: ["health"] }
    }
  },
  driveOff: {
    label: "TB2E.Conflict.Type.DriveOff",
    dispositionSkills: ["fighter"],
    dispositionAbility: "health",
    actions: {
      attack:   { type: "skill",   keys: ["fighter"] },
      defend:   { type: "ability", keys: ["health"] },
      feint:    { type: "skill",   keys: ["fighter"] },
      maneuver: { type: "ability", keys: ["health"] }
    }
  },
  flee: {
    label: "TB2E.Conflict.Type.Flee",
    dispositionSkills: ["scout", "rider"],
    dispositionAbility: "health",
    actions: {
      attack:   { type: "skill",   keys: ["scout", "rider"] },
      defend:   { type: "ability", keys: ["health"] },
      feint:    { type: "skill",   keys: ["scout", "rider"] },
      maneuver: { type: "ability", keys: ["health"] }
    }
  },
  convince: {
    label: "TB2E.Conflict.Type.Convince",
    dispositionSkills: ["persuader"],
    dispositionAbility: "will",
    actions: {
      attack:   { type: "skill",   keys: ["persuader"] },
      defend:   { type: "ability", keys: ["will"] },
      feint:    { type: "skill",   keys: ["persuader"] },
      maneuver: { type: "ability", keys: ["will"] }
    }
  },
  convinceCrowd: {
    label: "TB2E.Conflict.Type.ConvinceCrowd",
    dispositionSkills: ["orator"],
    dispositionAbility: "will",
    actions: {
      attack:   { type: "skill",   keys: ["orator"] },
      defend:   { type: "ability", keys: ["will"] },
      feint:    { type: "skill",   keys: ["orator"] },
      maneuver: { type: "ability", keys: ["will"] }
    }
  },
  trick: {
    label: "TB2E.Conflict.Type.Trick",
    dispositionSkills: ["manipulator"],
    dispositionAbility: "will",
    actions: {
      attack:   { type: "skill",   keys: ["manipulator"] },
      defend:   { type: "ability", keys: ["will"] },
      feint:    { type: "skill",   keys: ["manipulator"] },
      maneuver: { type: "ability", keys: ["will"] }
    }
  },
  negotiate: {
    label: "TB2E.Conflict.Type.Negotiate",
    dispositionSkills: ["haggler", "persuader"],
    dispositionAbility: "will",
    actions: {
      attack:   { type: "skill",   keys: ["haggler", "persuader"] },
      defend:   { type: "ability", keys: ["will"] },
      feint:    { type: "skill",   keys: ["haggler", "persuader"] },
      maneuver: { type: "ability", keys: ["will"] }
    }
  },
  abjure: {
    label: "TB2E.Conflict.Type.Abjure",
    dispositionSkills: ["ritualist", "theologian"],
    dispositionAbility: "will",
    actions: {
      attack:   { type: "skill",   keys: ["ritualist", "theologian"] },
      defend:   { type: "ability", keys: ["will"] },
      feint:    { type: "skill",   keys: ["ritualist", "theologian"] },
      maneuver: { type: "ability", keys: ["will"] }
    }
  },
  riddle: {
    label: "TB2E.Conflict.Type.Riddle",
    dispositionSkills: ["loremaster", "scholar"],
    dispositionAbility: "will",
    actions: {
      attack:   { type: "skill",   keys: ["loremaster", "scholar"] },
      defend:   { type: "ability", keys: ["will"] },
      feint:    { type: "skill",   keys: ["loremaster", "scholar"] },
      maneuver: { type: "ability", keys: ["will"] }
    }
  },
  war: {
    label: "TB2E.Conflict.Type.War",
    dispositionSkills: ["commander"],
    dispositionAbility: "will",
    actions: {
      attack:   { type: "skill",   keys: ["commander"] },
      defend:   { type: "ability", keys: ["will"] },
      feint:    { type: "skill",   keys: ["commander"] },
      maneuver: { type: "ability", keys: ["will"] }
    }
  },
  journey: {
    label: "TB2E.Conflict.Type.Journey",
    dispositionSkills: ["pathfinder", "survivalist"],
    dispositionAbility: "health",
    actions: {
      attack:   { type: "skill",   keys: ["pathfinder", "survivalist"] },
      defend:   { type: "ability", keys: ["health"] },
      feint:    { type: "skill",   keys: ["pathfinder", "survivalist"] },
      maneuver: { type: "ability", keys: ["health"] }
    }
  }
};

/**
 * Conflict action definitions.
 * @enum {object}
 */
export const conflictActions = {
  attack:   { label: "TB2E.Conflict.Action.Attack",   icon: "fa-solid fa-sword",         pip: "A" },
  defend:   { label: "TB2E.Conflict.Action.Defend",   icon: "fa-solid fa-shield",        pip: "D" },
  feint:    { label: "TB2E.Conflict.Action.Feint",    icon: "fa-solid fa-face-disguise", pip: "F" },
  maneuver: { label: "TB2E.Conflict.Action.Maneuver", icon: "fa-solid fa-arrows-rotate", pip: "M" }
};

/**
 * Conflict action interaction matrix.
 * Keys are "yourAction:opponentAction" → interaction type.
 * - "independent": both test independently (attacker at Ob 0, defender at Ob 3)
 * - "versus": both test versus each other
 * - "none": the first actor doesn't test at all
 * @enum {string}
 */
export const conflictInteractions = {
  "attack:attack":     "independent",
  "attack:defend":     "versus",
  "attack:feint":      "independent",
  "attack:maneuver":   "versus",
  "defend:attack":     "versus",
  "defend:defend":     "independent",
  "defend:feint":      "none",
  "defend:maneuver":   "versus",
  "feint:attack":      "none",
  "feint:defend":      "independent",
  "feint:feint":       "versus",
  "feint:maneuver":    "independent",
  "maneuver:attack":   "versus",
  "maneuver:defend":   "versus",
  "maneuver:feint":    "independent",
  "maneuver:maneuver": "independent"
};

/**
 * Independent obstacles per action when testing independently.
 * @enum {number}
 */
export const conflictObstacles = {
  attack: 0,
  defend: 3,
  feint: 0,
  maneuver: 0
};

/**
 * Maneuver effects by margin of success cost.
 * @enum {object}
 */
export const maneuverEffects = {
  1: { key: "impede",   label: "TB2E.Conflict.Maneuver.Impede",   description: "-1D opponent's next action" },
  2: { key: "position", label: "TB2E.Conflict.Maneuver.Position", description: "+2D your team's next action" },
  3: { key: "disarm",   label: "TB2E.Conflict.Maneuver.Disarm",   description: "Remove opponent weapon/trait" },
  4: { key: "rearm",    label: "TB2E.Conflict.Maneuver.Rearm",    description: "Equip weapon mid-round" }
};

export default {
  conditions, abilities, skills, advancementNeeded, packSlots, levelRequirements,
  conflictTypes, conflictActions, conflictInteractions, conflictObstacles, maneuverEffects
};
