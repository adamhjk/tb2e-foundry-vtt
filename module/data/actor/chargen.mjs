/**
 * Character creation (Gather Round) data definitions.
 * Pure data module — no Foundry class extensions.
 * DH = Dungeoneer's Handbook, LMM = Loremaster's Manual.
 */

/* -------------------------------------------- */
/*  Class Definitions                           */
/* -------------------------------------------- */

/**
 * Per-class chargen data: stocks, abilities, skills, trait, gear rules.
 * @enum {object}
 */
export const CLASS_DEFS = {
  burglar: {
    stocks: ["halfling"],
    page: "DH p.26",
    abilities: { type: "fixed", will: 5, health: 3 },
    skills: { cook: 3, criminal: 3, fighter: 3, hunter: 2, scout: 2, scavenger: 2 },
    classTrait: "Hidden Depths",
    memoryPalaceSlots: 0,
    urdr: 0
  },
  magician: {
    stocks: ["human", "changeling"],
    page: "DH p.26",
    abilities: { type: "distributed", total: 8, min: 2, max: 6 },
    skills: { arcanist: 4, loremaster: 3, alchemist: 2, cartographer: 2, scholar: 2 },
    classTrait: "Wizard's Sight",
    memoryPalaceSlots: 1,
    urdr: 0,
    requiresMentor: true
  },
  outcast: {
    stocks: ["dwarf"],
    page: "DH p.26",
    abilities: { type: "fixed", will: 3, health: 5 },
    skills: { fighter: 4, dungeoneer: 3, armorer: 2, sapper: 2, orator: 2, scout: 2 },
    classTrait: "Born of Earth and Stone",
    memoryPalaceSlots: 0,
    urdr: 0
  },
  ranger: {
    stocks: ["elf"],
    page: "DH p.27",
    abilities: { type: "fixed", will: 4, health: 4 },
    skills: { fighter: 3, pathfinder: 3, scout: 3, hunter: 2, loremaster: 2, survivalist: 2 },
    classTrait: "First Born",
    memoryPalaceSlots: 0,
    urdr: 0
  },
  theurge: {
    stocks: ["human", "changeling"],
    page: "DH p.27",
    abilities: { type: "distributed", total: 8, min: 2, max: 6 },
    skills: { fighter: 3, ritualist: 3, orator: 3, healer: 2, theologian: 2 },
    classTrait: "Touched by the Gods",
    memoryPalaceSlots: 0,
    urdr: 1
  },
  warrior: {
    stocks: ["human", "changeling"],
    page: "DH p.27",
    abilities: { type: "distributed", total: 8, min: 2, max: 6 },
    skills: { fighter: 4, hunter: 3, commander: 2, mentor: 2, rider: 2 },
    classTrait: "Heart of Battle",
    memoryPalaceSlots: 0,
    urdr: 0
  },
  shaman: {
    stocks: ["human", "changeling"],
    page: "LMM p.11",
    abilities: { type: "distributed", total: 8, min: 2, max: 6 },
    skills: { ritualist: 4, theologian: 3, fighter: 2, healer: 2, scavenger: 2 },
    classTrait: "Between Two Worlds",
    memoryPalaceSlots: 0,
    urdr: 1
  },
  skald: {
    stocks: ["human", "changeling"],
    page: "LMM p.13",
    abilities: { type: "distributed", total: 8, min: 2, max: 6 },
    skills: { orator: 4, manipulator: 3, fighter: 2, loremaster: 2, scholar: 2 },
    classTrait: "Voice of Thunder",
    memoryPalaceSlots: 0,
    urdr: 0
  },
  thief: {
    stocks: ["human", "changeling"],
    page: "LMM p.14",
    abilities: { type: "distributed", total: 8, min: 2, max: 6 },
    skills: { criminal: 3, manipulator: 3, scout: 3, sapper: 2, fighter: 2 },
    classTrait: "Devil May Care",
    memoryPalaceSlots: 0,
    urdr: 0
  }
};

/* -------------------------------------------- */
/*  Hometown Definitions                        */
/* -------------------------------------------- */

/**
 * Settlement types for step 3. Each offers a skill and a trait.
 * @enum {object}
 */
export const HOMETOWNS = {
  elfhome: {
    label: "TB2E.Wizard.Hometown.Elfhome",
    page: "DH p.29",
    stockRestriction: ["elf"],
    skills: ["healer", "mentor", "pathfinder"],
    traits: ["Calm", "Quiet"]
  },
  dwarvenHalls: {
    label: "TB2E.Wizard.Hometown.DwarvenHalls",
    page: "DH p.29",
    stockRestriction: null,
    skills: ["armorer", "laborer", "stonemason"],
    traits: ["Cunning", "Fiery"]
  },
  religiousBastion: {
    label: "TB2E.Wizard.Hometown.ReligiousBastion",
    page: "DH p.29",
    stockRestriction: null,
    skills: ["cartographer", "scholar", "theologian"],
    traits: ["Defender", "Scarred"]
  },
  bustlingMetropolis: {
    label: "TB2E.Wizard.Hometown.BustlingMetropolis",
    page: "DH p.30",
    stockRestriction: null,
    skills: ["haggler", "sailor", "steward"],
    traits: ["Extravagant", "Jaded"]
  },
  wizardsTower: {
    label: "TB2E.Wizard.Hometown.WizardsTower",
    page: "DH p.30",
    stockRestriction: null,
    skills: ["alchemist", "loremaster", "scholar"],
    traits: ["Skeptical", "Thoughtful"]
  },
  remoteVillage: {
    label: "TB2E.Wizard.Hometown.RemoteVillage",
    page: "DH p.30",
    stockRestriction: null,
    skills: ["carpenter", "peasant", "weaver"],
    traits: ["Early Riser", "Rough Hands"]
  },
  busyCrossroads: {
    label: "TB2E.Wizard.Hometown.BusyCrossroads",
    page: "DH p.30",
    stockRestriction: null,
    skills: ["cook", "haggler", "rider"],
    traits: ["Foolhardy", "Quick-Witted"]
  }
};

/* -------------------------------------------- */
/*  Skill Lists                                 */
/* -------------------------------------------- */

/** Upbringing skills — human/changeling only, rating 3 or +1 (max 4). */
export const UPBRINGING_SKILLS = [
  "criminal", "laborer", "haggler", "pathfinder", "peasant", "survivalist"
];

/** Social grace skills — all stocks, rating 2 or +1 (max 4). */
export const SOCIAL_SKILLS = ["haggler", "manipulator", "orator", "persuader"];

/** Specialty skills — all stocks, rating 2 or +1 (max 4). Unique per party. */
export const SPECIALTY_SKILLS = [
  "cartographer", "cook", "criminal", "dungeoneer", "haggler", "healer",
  "hunter", "manipulator", "orator", "pathfinder", "persuader", "rider",
  "sapper", "scavenger", "scout", "survivalist"
];

/* -------------------------------------------- */
/*  Wises                                       */
/* -------------------------------------------- */

/**
 * Per-stock required wise choices.
 * @enum {object}
 */
export const REQUIRED_WISES = {
  dwarf: {
    page: "DH p.31",
    pick: 1,
    options: ["Dwarven Chronicles-wise", "Shrewd Appraisal-wise"],
    freeChoice: 1
  },
  elf: {
    page: "DH p.32",
    pick: 1,
    options: ["Elven Lore-wise", "Folly of Humanity-wise", "Folly of Dwarves-wise"],
    freeChoice: 1
  },
  halfling: {
    page: "DH p.31",
    pick: 1,
    options: ["Home-wise", "Needs a Little Salt-wise"],
    freeChoice: 1
  },
  human: {
    page: "DH p.32",
    pick: 0,
    options: [],
    freeChoice: 1
  },
  changeling: {
    page: "LMM p.9",
    pick: 1,
    options: ["Troll-wise", "Giant-wise", "Changeling-wise", "Folklore-wise"],
    freeChoice: 0
  }
};

/* -------------------------------------------- */
/*  Nature Questions                            */
/* -------------------------------------------- */

/**
 * Per-stock nature questions with binary choices and effects.
 * yesEffect/noEffect can include: nature (+1), replaceDescriptor, traitBoost, wise, resources.
 * @enum {object}
 */
export const NATURE_QUESTIONS = {
  dwarf: {
    page: "DH p.35",
    questions: [
      {
        flavor: "TB2E.Wizard.Nature.Dwarf.Q1.Flavor",
        yesLabel: "TB2E.Wizard.Nature.Dwarf.Q1.Yes",
        noLabel: "TB2E.Wizard.Nature.Dwarf.Q1.No",
        yesEffect: { nature: 1 },
        noEffect: { replaceDescriptor: { from: "Avenging Grudges", to: "Negotiating" } }
      },
      {
        flavor: "TB2E.Wizard.Nature.Dwarf.Q2.Flavor",
        yesLabel: "TB2E.Wizard.Nature.Dwarf.Q2.Yes",
        noLabel: "TB2E.Wizard.Nature.Dwarf.Q2.No",
        yesEffect: { nature: 1 },
        noEffect: { traitBoost: "Born of Earth and Stone" }
      },
      {
        flavor: "TB2E.Wizard.Nature.Dwarf.Q3.Flavor",
        yesLabel: "TB2E.Wizard.Nature.Dwarf.Q3.Yes",
        noLabel: "TB2E.Wizard.Nature.Dwarf.Q3.No",
        yesEffect: { nature: 1 },
        noEffect: { resources: 1 }
      }
    ]
  },
  elf: {
    page: "DH p.36",
    questions: [
      {
        flavor: "TB2E.Wizard.Nature.Elf.Q1.Flavor",
        yesLabel: "TB2E.Wizard.Nature.Elf.Q1.Yes",
        noLabel: "TB2E.Wizard.Nature.Elf.Q1.No",
        yesEffect: { nature: 1 },
        noEffect: { replaceDescriptor: { from: "Singing", to: "Enchanting" } }
      },
      {
        flavor: "TB2E.Wizard.Nature.Elf.Q2.Flavor",
        yesLabel: "TB2E.Wizard.Nature.Elf.Q2.Yes",
        noLabel: "TB2E.Wizard.Nature.Elf.Q2.No",
        yesEffect: { traitBoost: "First Born" },
        noEffect: { nature: 1 }
      },
      {
        flavor: "TB2E.Wizard.Nature.Elf.Q3.Flavor",
        yesLabel: "TB2E.Wizard.Nature.Elf.Q3.Yes",
        noLabel: "TB2E.Wizard.Nature.Elf.Q3.No",
        yesEffect: { nature: 1 },
        noEffect: { replaceHomeTrait: ["Fiery", "Curious", "Restless"] }
      }
    ]
  },
  halfling: {
    page: "DH p.33",
    questions: [
      {
        flavor: "TB2E.Wizard.Nature.Halfling.Q1.Flavor",
        yesLabel: "TB2E.Wizard.Nature.Halfling.Q1.Yes",
        noLabel: "TB2E.Wizard.Nature.Halfling.Q1.No",
        yesEffect: { nature: 1 },
        noEffect: { replaceDescriptor: { from: "Merrymaking", to: "Hoarding" } }
      },
      {
        flavor: "TB2E.Wizard.Nature.Halfling.Q2.Flavor",
        yesLabel: "TB2E.Wizard.Nature.Halfling.Q2.Yes",
        noLabel: "TB2E.Wizard.Nature.Halfling.Q2.No",
        yesEffect: { nature: 1 },
        noEffect: { traitBoost: "Hidden Depths" }
      },
      {
        flavor: "TB2E.Wizard.Nature.Halfling.Q3.Flavor",
        yesLabel: "TB2E.Wizard.Nature.Halfling.Q3.Yes",
        noLabel: "TB2E.Wizard.Nature.Halfling.Q3.No",
        yesEffect: { nature: 1 },
        noEffect: { replaceDescriptor: { from: "Sneaking", to: "Demanding" } }
      }
    ]
  },
  human: {
    page: "DH p.34",
    questions: [
      {
        flavor: "TB2E.Wizard.Nature.Human.Q1.Flavor",
        yesLabel: "TB2E.Wizard.Nature.Human.Q1.Yes",
        noLabel: "TB2E.Wizard.Nature.Human.Q1.No",
        yesEffect: { nature: 1 },
        noEffect: { traitBoost: "__classTrait__" }
      },
      {
        flavor: "TB2E.Wizard.Nature.Human.Q2.Flavor",
        yesLabel: "TB2E.Wizard.Nature.Human.Q2.Yes",
        noLabel: "TB2E.Wizard.Nature.Human.Q2.No",
        yesEffect: { nature: 1 },
        noEffect: { wise: ["Elf-wise", "Dwarf-wise", "Politics-wise"] }
      },
      {
        flavor: "TB2E.Wizard.Nature.Human.Q3.Flavor",
        yesLabel: "TB2E.Wizard.Nature.Human.Q3.Yes",
        noLabel: "TB2E.Wizard.Nature.Human.Q3.No",
        yesEffect: { nature: 1 },
        noEffect: { replaceHomeTrait: ["Loner", "Foolhardy", "Defender"] }
      }
    ]
  },
  changeling: {
    page: "LMM p.9",
    questions: [
      {
        flavor: "TB2E.Wizard.Nature.Changeling.Q1.Flavor",
        yesLabel: "TB2E.Wizard.Nature.Changeling.Q1.Yes",
        noLabel: "TB2E.Wizard.Nature.Changeling.Q1.No",
        yesEffect: { nature: 1 },
        noEffect: { replaceDescriptor: { from: "Tricking", to: "Demanding" } }
      },
      {
        flavor: "TB2E.Wizard.Nature.Changeling.Q2.Flavor",
        yesLabel: "TB2E.Wizard.Nature.Changeling.Q2.Yes",
        noLabel: "TB2E.Wizard.Nature.Changeling.Q2.No",
        yesEffect: { nature: 1 },
        noEffect: { wise: ["Secrets-wise", "Ancient Grievances-wise", "Revenge-wise"] }
      },
      {
        flavor: "TB2E.Wizard.Nature.Changeling.Q3.Flavor",
        yesLabel: "TB2E.Wizard.Nature.Changeling.Q3.Yes",
        noLabel: "TB2E.Wizard.Nature.Changeling.Q3.No",
        yesEffect: { nature: 1 },
        noEffect: { traitBoost: "Huldrekall" }
      }
    ]
  }
};

/* -------------------------------------------- */
/*  Age Ranges                                  */
/* -------------------------------------------- */

/** @enum {{ min: number, max: number }} */
export const AGE_RANGES = {
  dwarf:      { min: 30,  max: 51  },
  elf:        { min: 60,  max: 101 },
  halfling:   { min: 26,  max: 31  },
  human:      { min: 14,  max: 21  },
  changeling: { min: 17,  max: 25  }
};

/* -------------------------------------------- */
/*  Spell School Table (2d6) — Magicians        */
/* -------------------------------------------- */

/**
 * 2d6 → spell school and starting spell names.
 * Roll 11-12 is "choose" — handled in UI.
 * @type {Object<string, {school: string, spells: string[]}>}
 */
export const SPELL_SCHOOL_TABLE = {
  2:  { school: "Necromancy",     spells: ["Dæmonic Stupefaction", "Supernal Vision", "Wisdom of the Sages"] },
  3:  { school: "Necromancy",     spells: ["Dæmonic Stupefaction", "Supernal Vision", "Wisdom of the Sages"] },
  4:  { school: "Divination",     spells: ["Aetherial Premonition", "Wayfinder's Friend", "Supernal Vision"] },
  5:  { school: "Abjuration",     spells: ["Wayfinder's Friend", "Wizard's Ægis", "Word of Binding"] },
  6:  { school: "Conjuration",    spells: ["Aetheric Appendage", "Dæmonic Stupefaction", "Wyrd Lights"] },
  7:  { school: "Transmutation",  spells: ["Dweomercraft", "Lightness of Being", "Word of Binding"] },
  8:  { school: "Illusion",       spells: ["Arcane Semblance", "Celestial Music", "Wyrd Lights"] },
  9:  { school: "Enchantment",    spells: ["Celestial Music", "Dæmonic Stupefaction", "Thread of Friendship"] },
  10: { school: "Evocation",      spells: ["Swarm", "Lightness of Being", "Mystic Porter"] },
  11: { school: "Choose",         spells: [] },
  12: { school: "Choose",         spells: [] }
};

/* -------------------------------------------- */
/*  Theurge Relic Table (3d6)                   */
/* -------------------------------------------- */

/**
 * 3d6 → starting relics and invocations for Theurges.
 * @type {Object<string, {relics: string[], invocations: string[]}>}
 */
export const THEURGE_RELIC_TABLE = {
  3:  { relics: ["Shield Painted with Sigrun's Runes", "Banner of the Lords of Valor"],
        invocations: ["Sigrun's Voice of Thunder", "Chant of the Lords of Valor"] },
  4:  { relics: ["Shield Painted with Sigrun's Runes", "Banner of the Lords of Valor"],
        invocations: ["Sigrun's Voice of Thunder", "Chant of the Lords of Valor"] },
  5:  { relics: ["Mantle Embroidered with the Lady of Valor", "Weapon of a Hero or Immortal"],
        invocations: ["Inspiring Aura", "Evocation of the Lords of Battle"] },
  6:  { relics: ["Pearl", "Vestments of the Lords of Life and Death"],
        invocations: ["Merciful Balm", "Fury of the Lords of Life and Death"] },
  7:  { relics: ["Pearl", "Hyresti's Silver Chalice"],
        invocations: ["Merciful Balm", "Blood Vow to the Lords of Creation"] },
  8:  { relics: ["Bone Knitting Needles", "Skull of Saint Barnabås"],
        invocations: ["Bone Knitter", "Catholicon of the Lord of Plagues"] },
  9:  { relics: ["Wooden Toy Oxen", "Silver Lancet"],
        invocations: ["Blessing of the Lord of Labor", "Balm of the Lords of Serenity"] },
  10: { relics: ["Drinking Horn of a 100-Year-Old Ox", "Vial of Perfume"],
        invocations: ["Benediction of the Lords of Creation", "Gift of Hospitality"] },
  11: { relics: ["Pouch of Pure Sea Salt", "Freydis' Sickle"],
        invocations: ["Shipwright's Chant", "Grace of the Lords of Plenty"] },
  12: { relics: ["Rune-Scribed Shuttlecock", "Dowsing Rod of the Water Witch"],
        invocations: ["Loom of the Disir", "Spring of the Eternal"] },
  13: { relics: ["Silver Censer with Burning Coal", "Heavy Hide Gloves of the Lords of Forges"],
        invocations: ["Breath of the Burning Lord", "Cloak of the Lord of Forges"] },
  14: { relics: ["Ruby Inscribed with the Name of Lord Fire", "Amulet of the Eye of the Burning Lord"],
        invocations: ["Forge Rites", "Supplication to the Burning Lord"] },
  15: { relics: ["Silver Replica of Sigtyr's Scepter", "Crown of the Lords of Law"],
        invocations: ["Sigtyr's Arresting Speech", "Wrath of the Lords of Law"] },
  16: { relics: ["Tally Sticks of the Immortals", "Harpa's Eye"],
        invocations: ["Wisdom of the Mother", "Vision of the Lords of Chaos and Law"] },
  17: { relics: ["Spindle or Distaff", "Sol's Disc"],
        invocations: ["Mudra of Fate", "Guidance of the Lord of Paths and Ways"] },
  18: { relics: ["Spindle or Distaff", "Sol's Disc"],
        invocations: ["Mudra of Fate", "Guidance of the Lord of Paths and Ways"] }
};

/* -------------------------------------------- */
/*  Shaman Relic Table (3d6)                    */
/* -------------------------------------------- */

/**
 * 3d6 → starting relics and invocations for Shamans.
 * @type {Object<string, {relics: string[], invocations: string[]}>}
 */
export const SHAMAN_RELIC_TABLE = {
  3:  { relics: ["Cloak with the Rune of Silence", "Preserved Flower of the Tree of Night"],
        invocations: ["Ondurdis's Quietude", "Summoning the Shrouded One"] },
  4:  { relics: ["Cloak with the Rune of Silence", "Preserved Flower of the Tree of Night"],
        invocations: ["Ondurdis's Quietude", "Summoning the Shrouded One"] },
  5:  { relics: ["Pure Silver Needle", "Well-Fed Locust"],
        invocations: ["Heike's Cunning Needle", "Orison to the Lord of Locusts"] },
  6:  { relics: ["Rune-Inscribed Dowsing Rod", "Stone from the Banks of the River of Truth"],
        invocations: ["Dowsing Rune", "Meditations of the River of Truth"] },
  7:  { relics: ["Lodestone Carved with the Wayfinding Rune", "Tattoo of the Rune of Fate"],
        invocations: ["Winter's Winding Path", "Byrnie of the Disir"] },
  8:  { relics: ["Spindle or Distaff Marked with the Rune of Fate", "Lock of Njor's Hair"],
        invocations: ["Mudra of Fate", "Invocation to the Immortal Waters"] },
  9:  { relics: ["Finely Carved Model Ship", "Thread from the Skein of Destiny"],
        invocations: ["Njor's Breath", "Verthandi's Binding"] },
  10: { relics: ["Bag of Astragali Dice", "Sol's Disc"],
        invocations: ["Supplication to the Saints of Secrets", "Guidance of the Lord of Paths and Ways"] },
  11: { relics: ["Living Adder", "Brass, Eight-Pointed Chaos Star"],
        invocations: ["Poison Mind", "Execration"] },
  12: { relics: ["Preserved Tongue of a Liar", "Harpa's Eye"],
        invocations: ["Vafrudnir's Silver Tongue", "Vision of the Lords of Chaos and Law"] },
  13: { relics: ["Vali's Sacrificial Knife", "Dire Wolf Cloak"],
        invocations: ["Vali's Slaughter Prayer", "Frenzy of the Lord of Beasts"] },
  14: { relics: ["Hrym's Fingernail", "Dagger Used in a Murder"],
        invocations: ["Hrym's Hand", "Vali's Red Mask"] },
  15: { relics: ["Hunting Horn", "Vial of Saliva from the Lord of Beasts"],
        invocations: ["Hound of the Hunt", "Tongue of the Lord of Beasts"] },
  16: { relics: ["Idol of the Lords of All Fevers and Plagues", "Fang of the Lord of Adders"],
        invocations: ["Fevers of the Lord of Plagues", "Orison to the Lord of Adders"] },
  17: { relics: ["Hunting Horn", "Claw, Tooth, Feather or Tuft of Fur from the Lord of Beasts"],
        invocations: ["Hound of the Hunt", "Boon of the Otherworld"] },
  18: { relics: ["Hunting Horn", "Claw, Tooth, Feather or Tuft of Fur from the Lord of Beasts"],
        invocations: ["Hound of the Hunt", "Boon of the Otherworld"] }
};

/* -------------------------------------------- */
/*  Weapon & Armor Restrictions                 */
/* -------------------------------------------- */

/**
 * Per-class allowed weapon names (matching compendium entries).
 * null means "any weapon".
 * @enum {string[]|null}
 */
export const WEAPON_RESTRICTIONS = {
  burglar:  ["Battle Axe", "Bow", "Dagger", "Flail", "Hand Axe", "Mace", "Sling", "Spear", "Staff", "Sword", "Warhammer"],
  magician: ["Dagger", "Staff"],
  outcast:  ["Battle Axe", "Bow", "Crossbow", "Dagger", "Flail", "Halberd", "Hand Axe", "Mace", "Polearm", "Sling", "Spear", "Staff", "Sword", "Warhammer"],
  ranger:   ["Bow", "Dagger", "Spear", "Sword"],
  theurge:  ["Battle Axe", "Dagger", "Flail", "Great Sword", "Halberd", "Hand Axe", "Mace", "Polearm", "Sling", "Spear", "Staff", "Sword", "Warhammer"],
  warrior:  null,
  shaman:   ["Dagger", "Hand Axe", "Sling", "Staff"],
  skald:    ["Battle Axe", "Dagger", "Hand Axe", "Sling", "Spear", "Sword"],
  thief:    ["Bow", "Crossbow", "Dagger", "Hand Axe", "Mace", "Staff", "Sword"]
};

/**
 * Per-class allowed armor names (matching compendium entries) and shield eligibility.
 * @enum {object}
 */
export const ARMOR_RESTRICTIONS = {
  burglar:  { armor: ["Leather Armor"], helmet: true, shield: true },
  magician: { armor: [], helmet: false, shield: false },
  outcast:  { armor: ["Leather Armor", "Chain Armor", "Plate Armor"], helmet: true, shield: true },
  ranger:   { armor: ["Leather Armor", "Chain Armor"], helmet: true, shield: false },
  theurge:  { armor: [], helmet: false, shield: true },
  warrior:  { armor: ["Leather Armor", "Chain Armor", "Plate Armor"], helmet: true, shield: true },
  shaman:   { armor: [], helmet: false, shield: true },
  skald:    { armor: ["Leather Armor", "Chain Armor"], helmet: true, shield: false },
  thief:    { armor: ["Leather Armor"], helmet: false, shield: false }
};

/* -------------------------------------------- */
/*  Compendium Pack Names                       */
/* -------------------------------------------- */

/** Pack slugs for compendium lookups. */
export const PACKS = {
  weapons: "tb2e.weapons",
  armor: "tb2e.armor",
  spells: "tb2e.spells",
  theurgeRelics: "tb2e.theurge-relics",
  theurgeInvocations: "tb2e.theurge-invocations",
  shamanicRelics: "tb2e.shamanic-relics",
  shamanicInvocations: "tb2e.shamanic-invocations",
  containers: "tb2e.containers",
  equipment: "tb2e.equipment",
  lightSources: "tb2e.light-sources",
  foodAndDrink: "tb2e.food-and-drink"
};

/* -------------------------------------------- */
/*  Step Definitions                            */
/* -------------------------------------------- */

/** Ordered wizard steps. */
export const STEPS = [
  { id: "class",      label: "TB2E.Wizard.Step.Class",      page: "DH pp.26-27, LMM pp.11-14" },
  { id: "upbringing", label: "TB2E.Wizard.Step.Upbringing", page: "DH p.29" },
  { id: "hometown",   label: "TB2E.Wizard.Step.Hometown",   page: "DH pp.29-30" },
  { id: "social",     label: "TB2E.Wizard.Step.Social",     page: "DH p.30" },
  { id: "specialty",  label: "TB2E.Wizard.Step.Specialty",  page: "DH p.31" },
  { id: "wises",      label: "TB2E.Wizard.Step.Wises",      page: "DH pp.31-32" },
  { id: "nature",     label: "TB2E.Wizard.Step.Nature",     page: "DH pp.33-36" },
  { id: "circles",    label: "TB2E.Wizard.Step.Circles",    page: "DH pp.36-37" },
  { id: "gear",       label: "TB2E.Wizard.Step.Gear",       page: "DH pp.38-42" },
  { id: "weapons",    label: "TB2E.Wizard.Step.Weapons",    page: "DH pp.39-40" },
  { id: "armor",      label: "TB2E.Wizard.Step.Armor",      page: "DH p.40" },
  { id: "finishing",   label: "TB2E.Wizard.Step.Finishing",   page: "DH pp.44-47" }
];

/* -------------------------------------------- */
/*  Helpers                                     */
/* -------------------------------------------- */

/**
 * Apply a skill at chargen: if character already has it, +1 (max 4); otherwise set to rating.
 * @param {number} currentRating
 * @param {number} baseRating
 * @returns {number}
 */
export function applySkill(currentRating, baseRating) {
  if ( currentRating > 0 ) return Math.min(currentRating + 1, 4);
  return baseRating;
}

/**
 * Check whether the upbringing step should be skipped for a given stock.
 * Only humans and changelings get upbringing.
 * @param {string} stock
 * @returns {boolean}
 */
export function shouldSkipUpbringing(stock) {
  return !["human", "changeling"].includes(stock);
}

/**
 * Get the available hometowns for a given stock.
 * Elfhome is restricted to elves; all others are open.
 * @param {string} stock
 * @returns {Object<string, object>}
 */
export function getAvailableHometowns(stock) {
  const result = {};
  for ( const [key, town] of Object.entries(HOMETOWNS) ) {
    if ( town.stockRestriction && !town.stockRestriction.includes(stock) ) continue;
    result[key] = town;
  }
  return result;
}

/**
 * Build the complete skills map after all chargen steps.
 * @param {object} state - Wizard state object.
 * @returns {Object<string, number>} - Skill key → final rating.
 */
export function buildSkillsMap(state) {
  const skills = {};

  // Class skills.
  const classDef = CLASS_DEFS[state.class];
  if ( classDef ) {
    for ( const [key, rating] of Object.entries(classDef.skills) ) {
      skills[key] = rating;
    }
  }

  // Upbringing (humans/changelings) — rating 3 or +1.
  if ( state.upbringingSkill && !shouldSkipUpbringing(state.stock) ) {
    skills[state.upbringingSkill] = applySkill(skills[state.upbringingSkill] || 0, 3);
  }

  // Hometown skill — rating 2 or +1.
  if ( state.hometownSkill ) {
    skills[state.hometownSkill] = applySkill(skills[state.hometownSkill] || 0, 2);
  }

  // Social grace — rating 2 or +1.
  if ( state.socialGrace ) {
    skills[state.socialGrace] = applySkill(skills[state.socialGrace] || 0, 2);
  }

  // Specialty — rating 2 or +1.
  if ( state.specialty ) {
    skills[state.specialty] = applySkill(skills[state.specialty] || 0, 2);
  }

  return skills;
}
