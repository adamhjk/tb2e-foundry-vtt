/**
 * Torchbearer 2E system configuration constants.
 */

/**
 * Condition definitions. Order matters — this is the display order on the strip.
 * @enum {object}
 */
export const conditions = {
  fresh:     { label: "TB2E.Condition.Fresh",     icon: "fa-solid fa-sun",          color: "--tb-cond-fresh" },
  hungry:    { label: "TB2E.Condition.Hungry",    icon: "fa-solid fa-drumstick-bite", color: "--tb-cond-hungry" },
  angry:     { label: "TB2E.Condition.Angry",     icon: "fa-solid fa-face-angry",   color: "--tb-cond-angry" },
  afraid:    { label: "TB2E.Condition.Afraid",    icon: "fa-solid fa-ghost",        color: "--tb-cond-afraid" },
  exhausted: { label: "TB2E.Condition.Exhausted", icon: "fa-solid fa-bed",          color: "--tb-cond-exhausted" },
  injured:   { label: "TB2E.Condition.Injured",   icon: "fa-solid fa-heart-crack",  color: "--tb-cond-injured" },
  sick:      { label: "TB2E.Condition.Sick",      icon: "fa-solid fa-biohazard",    color: "--tb-cond-sick" },
  dead:      { label: "TB2E.Condition.Dead",      icon: "fa-solid fa-skull",        color: "--tb-cond-dead" }
};

/**
 * Raw abilities (advancement-tracked) and town abilities.
 * @enum {object}
 */
export const abilities = {
  will:       { label: "TB2E.Ability.Will",       group: "raw" },
  health:     { label: "TB2E.Ability.Health",     group: "raw" },
  nature:     { label: "TB2E.Ability.Nature",     group: "raw" },
  resources:  { label: "TB2E.Ability.Resources",  group: "town" },
  circles:    { label: "TB2E.Ability.Circles",    group: "town" },
  precedence: { label: "TB2E.Ability.Precedence", group: "town" },
  might:      { label: "TB2E.Ability.Might",      group: "special" }
};

/**
 * All 25 skills with Beginner's Luck ability reference.
 * bl: "W" = Will, "H" = Health
 * @enum {object}
 */
export const skills = {
  alchemist:    { label: "TB2E.Skill.Alchemist",    bl: "W" },
  arcanist:     { label: "TB2E.Skill.Arcanist",     bl: "W" },
  armorer:      { label: "TB2E.Skill.Armorer",       bl: "H" },
  cartographer: { label: "TB2E.Skill.Cartographer", bl: "W" },
  commander:    { label: "TB2E.Skill.Commander",    bl: "W" },
  cook:         { label: "TB2E.Skill.Cook",         bl: "W" },
  criminal:     { label: "TB2E.Skill.Criminal",     bl: "W" },
  dungeoneer:   { label: "TB2E.Skill.Dungeoneer",   bl: "H" },
  fighter:      { label: "TB2E.Skill.Fighter",      bl: "H" },
  haggler:      { label: "TB2E.Skill.Haggler",      bl: "W" },
  healer:       { label: "TB2E.Skill.Healer",       bl: "W" },
  hunter:       { label: "TB2E.Skill.Hunter",       bl: "H" },
  loremaster:   { label: "TB2E.Skill.Loremaster",   bl: "W" },
  manipulator:  { label: "TB2E.Skill.Manipulator",  bl: "W" },
  mentor:       { label: "TB2E.Skill.Mentor",       bl: "W" },
  orator:       { label: "TB2E.Skill.Orator",       bl: "W" },
  pathfinder:   { label: "TB2E.Skill.Pathfinder",   bl: "H" },
  persuader:    { label: "TB2E.Skill.Persuader",    bl: "W" },
  rider:        { label: "TB2E.Skill.Rider",        bl: "H" },
  ritualist:    { label: "TB2E.Skill.Ritualist",    bl: "W" },
  scavenger:    { label: "TB2E.Skill.Scavenger",    bl: "W" },
  scholar:      { label: "TB2E.Skill.Scholar",      bl: "W" },
  scout:        { label: "TB2E.Skill.Scout",        bl: "W" },
  survivalist:  { label: "TB2E.Skill.Survivalist",  bl: "H" },
  theologian:   { label: "TB2E.Skill.Theologian",   bl: "W" }
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

export default { conditions, abilities, skills, advancementNeeded, packSlots, levelRequirements };
