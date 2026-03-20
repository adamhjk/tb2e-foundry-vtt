import {
  CLASS_DEFS, HOMETOWNS, NATURE_QUESTIONS, UPBRINGING_SKILLS, SOCIAL_SKILLS,
  SPECIALTY_SKILLS, REQUIRED_WISES, AGE_RANGES, SPELL_SCHOOL_TABLE,
  THEURGE_RELIC_TABLE, SHAMAN_RELIC_TABLE, WEAPON_RESTRICTIONS, ARMOR_RESTRICTIONS,
  PACKS, STEPS, applySkill, shouldSkipUpbringing, getAvailableHometowns, buildSkillsMap
} from "../../data/actor/chargen.mjs";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

/**
 * Character Creation Wizard — a guided 12-step process that populates a character actor.
 * Follows the "Gather Round" rules (DH pp.25-47, LMM pp.9-14).
 */
export default class CharacterWizard extends HandlebarsApplicationMixin(ApplicationV2) {

  /**
   * @param {Actor} actor - The character actor to populate.
   * @param {object} [options]
   */
  constructor(actor, options = {}) {
    super(options);
    this.#actor = actor;
    this.#state = this.#createInitialState();
  }

  /** @type {Actor} */
  #actor;

  /** @type {object} Accumulated wizard state — written to actor on finish. */
  #state;

  /* -------------------------------------------- */
  /*  Configuration                               */
  /* -------------------------------------------- */

  static DEFAULT_OPTIONS = {
    id: "character-wizard-{id}",
    classes: ["character-wizard"],
    position: { width: 820, height: 680 },
    window: {
      title: "TB2E.Wizard.Title",
      resizable: true,
      minimizable: true
    },
    actions: {
      goToStep: CharacterWizard.#onGoToStep,
      prev: CharacterWizard.#onPrev,
      next: CharacterWizard.#onNext,
      selectClass: CharacterWizard.#onSelectClass,
      selectStock: CharacterWizard.#onSelectStock,
      selectUpbringing: CharacterWizard.#onSelectUpbringing,
      selectHometown: CharacterWizard.#onSelectHometown,
      selectHometownSkill: CharacterWizard.#onSelectHometownSkill,
      selectHomeTrait: CharacterWizard.#onSelectHomeTrait,
      selectSocial: CharacterWizard.#onSelectSocial,
      selectSpecialty: CharacterWizard.#onSelectSpecialty,
      selectRequiredWise: CharacterWizard.#onSelectRequiredWise,
      answerNature: CharacterWizard.#onAnswerNature,
      selectNatureWise: CharacterWizard.#onSelectNatureWise,
      selectNatureHomeTrait: CharacterWizard.#onSelectNatureHomeTrait,
      answerCircles: CharacterWizard.#onAnswerCircles,
      selectPackType: CharacterWizard.#onSelectPackType,
      rollSpells: CharacterWizard.#onRollSpells,
      rollRelics: CharacterWizard.#onRollRelics,
      selectWeapon: CharacterWizard.#onSelectWeapon,
      selectArmor: CharacterWizard.#onSelectArmor,
      finish: CharacterWizard.#onFinish
    }
  };

  static PARTS = {
    wizard: {
      template: "systems/tb2e/templates/actors/wizard/wizard.hbs",
      scrollable: [".wizard-content"]
    }
  };

  static PARTIALS = [
    "systems/tb2e/templates/actors/wizard/step-class.hbs",
    "systems/tb2e/templates/actors/wizard/step-upbringing.hbs",
    "systems/tb2e/templates/actors/wizard/step-hometown.hbs",
    "systems/tb2e/templates/actors/wizard/step-social.hbs",
    "systems/tb2e/templates/actors/wizard/step-specialty.hbs",
    "systems/tb2e/templates/actors/wizard/step-wises.hbs",
    "systems/tb2e/templates/actors/wizard/step-nature.hbs",
    "systems/tb2e/templates/actors/wizard/step-circles.hbs",
    "systems/tb2e/templates/actors/wizard/step-gear.hbs",
    "systems/tb2e/templates/actors/wizard/step-weapons.hbs",
    "systems/tb2e/templates/actors/wizard/step-armor.hbs",
    "systems/tb2e/templates/actors/wizard/step-finishing.hbs"
  ];

  static {
    Hooks.once("init", () => {
      loadTemplates(CharacterWizard.PARTIALS);
    });
  }

  /* -------------------------------------------- */
  /*  State Initialization                        */
  /* -------------------------------------------- */

  #createInitialState() {
    return {
      currentStep: "class",
      // Step 1
      class: null, stock: null, will: null, health: null,
      // Step 2
      upbringingSkill: null,
      // Step 3
      hometown: null, hometownSkill: null, homeTrait: null,
      // Step 4
      socialGrace: null,
      // Step 5
      specialty: null,
      // Step 6
      wises: [],
      // Step 7
      natureAnswers: {},
      natureWiseChoice: null,
      natureHomeTraitChoice: null,
      // Step 8
      circles: 1, hasFriend: null, hasParents: null, hasMentor: null, hasEnemy: null,
      friend: "", parents: "", mentor: "", enemy: "",
      // Step 9
      packType: null,
      spellSchoolRoll: null, spellSchool: null, spells: [],
      relicRoll: null, relics: [], invocations: [],
      // Step 10
      selectedWeapons: [],
      // Step 11
      selectedArmor: [],
      // Step 12
      name: this.#actor.name || "", belief: "", instinct: "", raiment: "", age: ""
    };
  }

  /* -------------------------------------------- */
  /*  Step Navigation                             */
  /* -------------------------------------------- */

  /** Get the ordered steps, filtering out upbringing for non-human/changeling. */
  get #steps() {
    return STEPS.filter(s => {
      if ( s.id === "upbringing" && this.#state.stock && shouldSkipUpbringing(this.#state.stock) ) return false;
      return true;
    });
  }

  get #currentStepIndex() {
    return this.#steps.findIndex(s => s.id === this.#state.currentStep);
  }

  get #canGoNext() {
    return this.#currentStepIndex < this.#steps.length - 1 && this.#isStepComplete(this.#state.currentStep);
  }

  get #canGoPrev() {
    return this.#currentStepIndex > 0;
  }

  #isStepComplete(stepId) {
    const s = this.#state;
    switch ( stepId ) {
      case "class": return !!s.class && !!s.stock && s.will != null && s.health != null;
      case "upbringing": return !!s.upbringingSkill;
      case "hometown": return !!s.hometown && !!s.hometownSkill && !!s.homeTrait;
      case "social": return !!s.socialGrace;
      case "specialty": return !!s.specialty;
      case "wises": return s.wises.length > 0;
      case "nature": {
        const stock = s.stock;
        if ( !stock ) return false;
        const questions = NATURE_QUESTIONS[stock]?.questions || [];
        const answered = Object.keys(s.natureAnswers).length;
        if ( answered < questions.length ) return false;
        // Check if any answer requires a secondary choice that hasn't been made.
        for ( const [idx, answer] of Object.entries(s.natureAnswers) ) {
          const q = questions[idx];
          if ( !q ) continue;
          const effect = answer ? q.yesEffect : q.noEffect;
          if ( effect.wise && !s.natureWiseChoice ) return false;
          if ( effect.replaceHomeTrait && !s.natureHomeTraitChoice ) return false;
        }
        return true;
      }
      case "circles": return s.hasFriend != null && s.hasParents != null && s.hasMentor != null && s.hasEnemy != null;
      case "gear": return !!s.packType;
      case "weapons": return s.selectedWeapons.length > 0;
      case "armor": return true; // Armor is optional for some classes.
      case "finishing": return !!s.name;
      default: return false;
    }
  }

  /* -------------------------------------------- */
  /*  Context Preparation                         */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const s = this.#state;
    const steps = this.#steps;

    // Step navigation.
    context.steps = steps.map((step, i) => {
      const currentIdx = this.#currentStepIndex;
      return {
        ...step,
        label: game.i18n.localize(step.label),
        number: i + 1,
        isCurrent: step.id === s.currentStep,
        isComplete: i < currentIdx || this.#isStepComplete(step.id),
        isAccessible: i <= currentIdx || (i === currentIdx + 1 && this.#isStepComplete(s.currentStep))
      };
    });

    // Footer nav.
    context.canPrev = this.#canGoPrev;
    context.canNext = this.#canGoNext;
    context.isLastStep = s.currentStep === "finishing";
    context.canFinish = s.currentStep === "finishing" && this.#isStepComplete("finishing");

    // Active step flags.
    context.currentStep = s.currentStep;
    for ( const step of STEPS ) {
      context[`is${step.id.charAt(0).toUpperCase() + step.id.slice(1)}Step`] = s.currentStep === step.id;
    }

    // Current step page reference.
    const currentStepDef = steps.find(st => st.id === s.currentStep);
    context.currentPage = currentStepDef?.page || "";

    // Prepare step-specific context.
    switch ( s.currentStep ) {
      case "class": this.#prepareClassContext(context); break;
      case "upbringing": this.#prepareUpbringingContext(context); break;
      case "hometown": this.#prepareHometownContext(context); break;
      case "social": this.#prepareSocialContext(context); break;
      case "specialty": this.#prepareSpecialtyContext(context); break;
      case "wises": this.#prepareWisesContext(context); break;
      case "nature": this.#prepareNatureContext(context); break;
      case "circles": this.#prepareCirclesContext(context); break;
      case "gear": this.#prepareGearContext(context); break;
      case "weapons": this.#prepareWeaponsContext(context); break;
      case "armor": this.#prepareArmorContext(context); break;
      case "finishing": this.#prepareFinishingContext(context); break;
    }

    // Running summary strip (visible on all steps once a class is chosen).
    context.summary = this.#buildSummary();

    return context;
  }

  /* -------------------------------------------- */

  #prepareClassContext(context) {
    const s = this.#state;
    const classCfg = CONFIG.TB2E.classes;
    const stockCfg = CONFIG.TB2E.stocks;

    context.classes = Object.entries(classCfg).map(([key, cfg]) => ({
      key,
      label: game.i18n.localize(cfg.label),
      page: cfg.page,
      stocks: cfg.stocks.map(sk => game.i18n.localize(stockCfg[sk]?.label || sk)),
      isSelected: s.class === key,
      classDef: CLASS_DEFS[key]
    }));

    context.selectedClass = s.class;
    context.selectedStock = s.stock;

    // Available stocks for selected class.
    if ( s.class ) {
      const def = CLASS_DEFS[s.class];
      context.availableStocks = def.stocks.map(sk => ({
        key: sk,
        label: game.i18n.localize(stockCfg[sk]?.label || sk),
        isSelected: s.stock === sk,
        isAutoSelected: def.stocks.length === 1
      }));
      context.isAutoStock = def.stocks.length === 1;

      // Will/Health distribution.
      if ( def.abilities.type === "distributed" ) {
        context.distributed = true;
        context.willValue = s.will ?? def.abilities.max;
        context.healthValue = s.health ?? (def.abilities.total - (s.will ?? def.abilities.max));
        context.abilityMin = def.abilities.min;
        context.abilityMax = def.abilities.max;
        context.abilityTotal = def.abilities.total;
      } else {
        context.distributed = false;
        context.willValue = def.abilities.will;
        context.healthValue = def.abilities.health;
      }

      // Starting skills preview.
      context.classSkills = Object.entries(def.skills).map(([key, rating]) => ({
        key,
        label: game.i18n.localize(CONFIG.TB2E.skills[key]?.label || key),
        rating
      }));
      context.classTrait = def.classTrait;
    }
  }

  /* -------------------------------------------- */

  #prepareUpbringingContext(context) {
    const s = this.#state;
    const classSkills = CLASS_DEFS[s.class]?.skills || {};
    context.upbringingSkills = UPBRINGING_SKILLS.map(key => {
      const currentRating = classSkills[key] || 0;
      const newRating = applySkill(currentRating, 3);
      return {
        key,
        label: game.i18n.localize(CONFIG.TB2E.skills[key]?.label || key),
        currentRating,
        newRating,
        isIncrease: currentRating > 0,
        isSelected: s.upbringingSkill === key
      };
    });
  }

  /* -------------------------------------------- */

  #prepareHometownContext(context) {
    const s = this.#state;
    const towns = getAvailableHometowns(s.stock);

    context.hometowns = Object.entries(towns).map(([key, town]) => ({
      key,
      label: game.i18n.localize(town.label),
      page: town.page,
      isSelected: s.hometown === key
    }));

    if ( s.hometown && towns[s.hometown] ) {
      const town = towns[s.hometown];
      const classSkills = CLASS_DEFS[s.class]?.skills || {};
      const upbringing = s.upbringingSkill;

      // Build current skill map up to this point.
      const currentSkills = { ...classSkills };
      if ( upbringing && !shouldSkipUpbringing(s.stock) ) {
        currentSkills[upbringing] = applySkill(currentSkills[upbringing] || 0, 3);
      }

      context.hometownSkills = town.skills.map(key => {
        const currentRating = currentSkills[key] || 0;
        const newRating = applySkill(currentRating, 2);
        return {
          key,
          label: game.i18n.localize(CONFIG.TB2E.skills[key]?.label || key),
          currentRating,
          newRating,
          isIncrease: currentRating > 0,
          isSelected: s.hometownSkill === key
        };
      });

      context.hometownTraits = town.traits.map(t => ({
        name: t,
        isSelected: s.homeTrait === t
      }));
    }
  }

  /* -------------------------------------------- */

  #prepareSocialContext(context) {
    const s = this.#state;
    const currentSkills = this.#buildCurrentSkills("social");

    context.socialSkills = SOCIAL_SKILLS.map(key => {
      const currentRating = currentSkills[key] || 0;
      const newRating = applySkill(currentRating, 2);
      return {
        key,
        label: game.i18n.localize(CONFIG.TB2E.skills[key]?.label || key),
        currentRating,
        newRating,
        isIncrease: currentRating > 0,
        isSelected: s.socialGrace === key
      };
    });
  }

  /* -------------------------------------------- */

  #prepareSpecialtyContext(context) {
    const s = this.#state;
    const currentSkills = this.#buildCurrentSkills("specialty");

    context.specialtySkills = SPECIALTY_SKILLS.map(key => {
      const currentRating = currentSkills[key] || 0;
      const newRating = applySkill(currentRating, 2);
      return {
        key,
        label: game.i18n.localize(CONFIG.TB2E.skills[key]?.label || key),
        currentRating,
        newRating,
        isIncrease: currentRating > 0,
        isSelected: s.specialty === key
      };
    });
  }

  /* -------------------------------------------- */

  #prepareWisesContext(context) {
    const s = this.#state;
    const stock = s.stock;
    const wiseDef = REQUIRED_WISES[stock];

    const pick = wiseDef?.pick || 0;
    context.requiredWisePick = pick;
    context.requiredWiseOptions = (wiseDef?.options || []).map(name => ({
      name,
      isSelected: s.wises[0] === name
    }));
    context.currentWises = [...s.wises];
    context.wisePage = wiseDef?.page || "";

    // Build free-wise input slots.
    const freeCount = wiseDef?.freeChoice || 0;
    context.freeWiseSlots = [];
    for ( let i = 0; i < freeCount; i++ ) {
      const idx = pick + i;
      context.freeWiseSlots.push({ index: idx, value: s.wises[idx] || "" });
    }
  }

  /* -------------------------------------------- */

  #prepareNatureContext(context) {
    const s = this.#state;
    const stock = s.stock;
    const stockCfg = CONFIG.TB2E.stocks[stock];
    const natureDef = NATURE_QUESTIONS[stock];
    if ( !natureDef || !stockCfg ) return;

    // Base descriptors (may be modified by answers).
    const descriptors = [...(stockCfg.natureDescriptors || [])];

    // Calculate running nature.
    let nature = 3;
    const effects = [];

    context.natureQuestions = natureDef.questions.map((q, idx) => {
      const answer = s.natureAnswers[idx];
      const answered = answer != null;
      let effect = null;

      if ( answered ) {
        effect = answer ? q.yesEffect : q.noEffect;
        if ( effect.nature ) nature += effect.nature;
      }

      return {
        index: idx,
        flavor: game.i18n.localize(q.flavor),
        yesLabel: game.i18n.localize(q.yesLabel),
        noLabel: game.i18n.localize(q.noLabel),
        answered,
        answer,
        effect,
        // Does this answer need a secondary choice?
        needsWiseChoice: answered && !answer && !!effect?.wise,
        wiseOptions: effect?.wise || [],
        selectedNatureWise: s.natureWiseChoice,
        needsHomeTraitChoice: answered && !answer && !!effect?.replaceHomeTrait,
        homeTraitOptions: effect?.replaceHomeTrait || [],
        selectedHomeTrait: s.natureHomeTraitChoice
      };
    });

    context.natureScore = nature;
    context.natureDescriptors = this.#computeNatureDescriptors();
    context.naturePage = natureDef.page;
  }

  /* -------------------------------------------- */

  #prepareCirclesContext(context) {
    const s = this.#state;
    const classDef = CLASS_DEFS[s.class];

    context.hasFriend = s.hasFriend;
    context.hasParents = s.hasParents;
    context.hasMentor = s.hasMentor;
    context.hasEnemy = s.hasEnemy;
    context.friend = s.friend;
    context.parents = s.parents;
    context.mentor = s.mentor;
    context.enemy = s.enemy;
    context.requiresMentor = classDef?.requiresMentor || false;

    // Calculate circles.
    let circles = 1;
    if ( s.hasFriend ) circles++;
    if ( s.hasParents ) circles++;
    if ( s.hasMentor ) circles++;
    if ( s.hasEnemy ) circles++;
    context.circlesScore = circles;

    // Loner check — no friend means loner.
    context.isLoner = s.hasFriend === false;
  }

  /* -------------------------------------------- */

  #prepareGearContext(context) {
    const s = this.#state;
    const classDef = CLASS_DEFS[s.class];

    context.packType = s.packType;
    context.isMagician = s.class === "magician";
    context.isTheurge = s.class === "theurge";
    context.isShaman = s.class === "shaman";
    context.needsSpellRoll = s.class === "magician" && !s.spellSchoolRoll;
    context.needsRelicRoll = (s.class === "theurge" || s.class === "shaman") && !s.relicRoll;
    context.spellSchool = s.spellSchool;
    context.spells = s.spells;
    context.relics = s.relics;
    context.invocations = s.invocations;
    context.spellSchoolRoll = s.spellSchoolRoll;
    context.relicRoll = s.relicRoll;
  }

  /* -------------------------------------------- */

  #prepareWeaponsContext(context) {
    const s = this.#state;
    const restrictions = WEAPON_RESTRICTIONS[s.class];

    // If null, all weapons allowed.
    context.allWeaponsAllowed = restrictions === null;
    context.allowedWeapons = (restrictions || []).map(name => ({
      name,
      isSelected: s.selectedWeapons.includes(name)
    }));
    if ( restrictions === null ) {
      // List all weapon names from pack — the wizard populates at render.
      context.allowedWeapons = [];
      context.loadAllWeapons = true;
    }
    context.selectedWeapons = [...s.selectedWeapons];

    // Thief always starts with a dagger — auto-add if not present.
    context.forcedDagger = s.class === "thief";
    if ( context.forcedDagger && !s.selectedWeapons.includes("Dagger") ) {
      s.selectedWeapons.push("Dagger");
    }

    // Shield option for classes that allow it.
    const armorDef = ARMOR_RESTRICTIONS[s.class];
    context.canChooseShield = armorDef?.shield || false;
  }

  /* -------------------------------------------- */

  #prepareArmorContext(context) {
    const s = this.#state;
    const restrictions = ARMOR_RESTRICTIONS[s.class];

    context.allowedArmor = (restrictions?.armor || []).map(name => ({
      name,
      isSelected: s.selectedArmor.includes(name)
    }));
    context.canHelmet = restrictions?.helmet || false;
    context.helmetSelected = s.selectedArmor.includes("Helmet");
    context.canShield = restrictions?.shield || false;
    context.shieldSelected = s.selectedArmor.includes("Shield");
    context.noArmorAllowed = !restrictions?.armor?.length && !restrictions?.helmet && !restrictions?.shield;
    context.selectedArmor = [...s.selectedArmor];
  }

  /* -------------------------------------------- */

  #prepareFinishingContext(context) {
    const s = this.#state;
    const ageRange = AGE_RANGES[s.stock] || { min: 14, max: 100 };

    context.name = s.name || this.#actor.name;
    context.belief = s.belief;
    context.instinct = s.instinct;
    context.raiment = s.raiment;
    context.age = s.age;
    context.ageMin = ageRange.min;
    context.ageMax = ageRange.max;
  }

  /* -------------------------------------------- */
  /*  Skill Building Helpers                      */
  /* -------------------------------------------- */

  /**
   * Build the current skills map up to (but not including) the given step.
   * @param {string} upToStep
   * @returns {Object<string, number>}
   */
  #buildCurrentSkills(upToStep) {
    const s = this.#state;
    const skills = {};

    // Class skills.
    const classDef = CLASS_DEFS[s.class];
    if ( classDef ) {
      for ( const [key, rating] of Object.entries(classDef.skills) ) skills[key] = rating;
    }

    if ( upToStep === "upbringing" ) return skills;

    // Upbringing.
    if ( s.upbringingSkill && !shouldSkipUpbringing(s.stock) ) {
      skills[s.upbringingSkill] = applySkill(skills[s.upbringingSkill] || 0, 3);
    }

    if ( upToStep === "hometown" ) return skills;

    // Hometown.
    if ( s.hometownSkill ) {
      skills[s.hometownSkill] = applySkill(skills[s.hometownSkill] || 0, 2);
    }

    if ( upToStep === "social" ) return skills;

    // Social.
    if ( s.socialGrace ) {
      skills[s.socialGrace] = applySkill(skills[s.socialGrace] || 0, 2);
    }

    if ( upToStep === "specialty" ) return skills;

    // Specialty.
    if ( s.specialty ) {
      skills[s.specialty] = applySkill(skills[s.specialty] || 0, 2);
    }

    return skills;
  }

  /** Build running skill roster for display. */
  #buildSkillRoster() {
    const skills = this.#buildCurrentSkills("__final__");
    return Object.entries(skills)
      .filter(([, v]) => v > 0)
      .map(([key, rating]) => ({
        key,
        label: game.i18n.localize(CONFIG.TB2E.skills[key]?.label || key),
        rating
      }))
      .sort((a, b) => b.rating - a.rating || a.label.localeCompare(b.label));
  }

  /** Compute nature descriptors based on answers. */
  #computeNatureDescriptors() {
    const s = this.#state;
    const stock = s.stock;
    const stockCfg = CONFIG.TB2E.stocks[stock];
    if ( !stockCfg ) return [];
    const descriptors = [...(stockCfg.natureDescriptors || [])];
    const questions = NATURE_QUESTIONS[stock]?.questions || [];

    for ( const [idx, answer] of Object.entries(s.natureAnswers) ) {
      const q = questions[idx];
      if ( !q ) continue;
      const effect = answer ? q.yesEffect : q.noEffect;
      if ( effect.replaceDescriptor ) {
        const i = descriptors.indexOf(effect.replaceDescriptor.from);
        if ( i >= 0 ) descriptors[i] = effect.replaceDescriptor.to;
      }
    }
    return descriptors;
  }

  /** Build a running summary of all choices made so far. */
  #buildSummary() {
    const s = this.#state;
    const classCfg = CONFIG.TB2E.classes[s.class];
    const stockCfg = CONFIG.TB2E.stocks[s.stock];
    const classDef = CLASS_DEFS[s.class];
    const hometownDef = HOMETOWNS[s.hometown];
    return {
      class: classCfg ? game.i18n.localize(classCfg.label) : "",
      stock: stockCfg ? game.i18n.localize(stockCfg.label) : "",
      will: s.will,
      health: s.health,
      classTrait: classDef?.classTrait || "",
      stockTrait: s.stock === "changeling" ? "Huldrekall" : "",
      homeTrait: s.homeTrait || "",
      hometown: hometownDef ? game.i18n.localize(hometownDef.label) : "",
      skills: this.#buildSkillRoster(),
      wises: s.natureWiseChoice ? [...s.wises, s.natureWiseChoice] : s.wises,
      descriptors: this.#computeNatureDescriptors(),
      natureScore: this.#computeNature(),
      circles: this.#computeCircles(),
      circleNames: [s.friend, s.parents, s.mentor, s.enemy].filter(Boolean),
      weapons: s.selectedWeapons,
      armor: s.selectedArmor
    };
  }

  #computeNature() {
    const s = this.#state;
    const questions = NATURE_QUESTIONS[s.stock]?.questions || [];
    let nature = 3;
    for ( const [idx, answer] of Object.entries(s.natureAnswers) ) {
      const q = questions[idx];
      if ( !q ) continue;
      const effect = answer ? q.yesEffect : q.noEffect;
      if ( effect.nature ) nature += effect.nature;
    }
    return nature;
  }

  #computeCircles() {
    const s = this.#state;
    let circles = 1;
    if ( s.hasFriend ) circles++;
    if ( s.hasParents ) circles++;
    if ( s.hasMentor ) circles++;
    if ( s.hasEnemy ) circles++;
    return circles;
  }

  #computeResources() {
    const s = this.#state;
    const questions = NATURE_QUESTIONS[s.stock]?.questions || [];
    let resources = 0;
    for ( const [idx, answer] of Object.entries(s.natureAnswers) ) {
      const q = questions[idx];
      if ( !q ) continue;
      const effect = answer ? q.yesEffect : q.noEffect;
      if ( effect.resources ) resources = effect.resources;
    }
    return resources;
  }

  /* -------------------------------------------- */
  /*  DOM Event Handlers                          */
  /* -------------------------------------------- */

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);

    // Will/Health slider.
    const willSlider = this.element.querySelector(".will-slider");
    if ( willSlider ) {
      willSlider.addEventListener("input", (event) => {
        const classDef = CLASS_DEFS[this.#state.class];
        if ( !classDef ) return;
        const health = parseInt(event.target.value);
        const will = classDef.abilities.total - health;
        this.#state.will = will;
        this.#state.health = health;
        const willDisplay = this.element.querySelector(".will-display");
        const healthDisplay = this.element.querySelector(".health-display");
        if ( willDisplay ) willDisplay.textContent = will;
        if ( healthDisplay ) healthDisplay.textContent = health;
      });
    }

    // Wises text inputs.
    for ( const input of this.element.querySelectorAll(".wise-input") ) {
      input.addEventListener("change", (event) => {
        const idx = parseInt(event.target.dataset.wiseIndex);
        const value = event.target.value.trim();
        const wises = [...this.#state.wises];
        wises[idx] = value;
        this.#state.wises = wises.filter(w => w);
        this.render();
      });
    }

    // Circles text inputs.
    for ( const input of this.element.querySelectorAll(".circles-input") ) {
      input.addEventListener("change", (event) => {
        const field = event.target.dataset.field;
        if ( field ) this.#state[field] = event.target.value.trim();
      });
    }

    // Finishing text inputs — update state and toggle finish button live.
    for ( const input of this.element.querySelectorAll(".finishing-input") ) {
      const syncState = (event) => {
        const field = event.target.dataset.field;
        if ( field ) this.#state[field] = event.target.value.trim();
        // Enable/disable finish button based on name.
        const finishBtn = this.element.querySelector('.wizard-btn.finish');
        if ( finishBtn ) finishBtn.disabled = !this.#state.name;
      };
      input.addEventListener("input", syncState);
      input.addEventListener("change", syncState);
    }

    // Load all weapons from compendium if needed (unrestricted class).
    const restrictions = WEAPON_RESTRICTIONS[this.#state.class];
    if ( restrictions === null && this.#state.currentStep === "weapons" ) {
      this.#loadWeaponsFromCompendium();
    }
  }

  /** Load weapon names from compendium for unrestricted classes. */
  async #loadWeaponsFromCompendium() {
    const pack = game.packs.get(PACKS.weapons);
    if ( !pack ) return;
    const index = await pack.getIndex();
    const container = this.element.querySelector(".weapon-list");
    if ( !container ) return;
    for ( const entry of index ) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `weapon-card${this.#state.selectedWeapons.includes(entry.name) ? " selected" : ""}`;
      btn.dataset.action = "selectWeapon";
      btn.dataset.weapon = entry.name;
      btn.innerHTML = `<span class="weapon-name">${entry.name}</span>`;
      container.appendChild(btn);
    }
  }

  /* -------------------------------------------- */
  /*  Action Handlers — Navigation                */
  /* -------------------------------------------- */

  /** @this {CharacterWizard} */
  static #onGoToStep(event, target) {
    const stepId = target.dataset.step;
    if ( !stepId ) return;
    const steps = this.#steps;
    const targetIdx = steps.findIndex(s => s.id === stepId);
    const currentIdx = this.#currentStepIndex;
    // Can only go to completed or next steps.
    if ( targetIdx <= currentIdx || (targetIdx === currentIdx + 1 && this.#isStepComplete(this.#state.currentStep)) ) {
      this.#state.currentStep = stepId;
      this.render();
    }
  }

  /** @this {CharacterWizard} */
  static #onPrev() {
    if ( !this.#canGoPrev ) return;
    const steps = this.#steps;
    this.#state.currentStep = steps[this.#currentStepIndex - 1].id;
    this.render();
  }

  /** @this {CharacterWizard} */
  static #onNext() {
    if ( !this.#canGoNext ) return;
    const steps = this.#steps;
    this.#state.currentStep = steps[this.#currentStepIndex + 1].id;
    this.render();
  }

  /* -------------------------------------------- */
  /*  Action Handlers — Step 1: Class             */
  /* -------------------------------------------- */

  /** @this {CharacterWizard} */
  static #onSelectClass(event, target) {
    const classKey = target.dataset.classKey;
    if ( !classKey || !CLASS_DEFS[classKey] ) return;
    const def = CLASS_DEFS[classKey];
    this.#state.class = classKey;

    // Auto-select stock if only one option.
    if ( def.stocks.length === 1 ) {
      this.#state.stock = def.stocks[0];
    } else {
      this.#state.stock = null;
    }

    // Set abilities.
    if ( def.abilities.type === "fixed" ) {
      this.#state.will = def.abilities.will;
      this.#state.health = def.abilities.health;
    } else {
      // Default to balanced (middle of range).
      const mid = Math.floor(def.abilities.total / 2);
      this.#state.health = Math.max(def.abilities.min, Math.min(def.abilities.max, mid));
      this.#state.will = def.abilities.total - this.#state.health;
    }

    // Reset downstream choices.
    this.#state.upbringingSkill = null;
    this.#state.hometown = null;
    this.#state.hometownSkill = null;
    this.#state.homeTrait = null;
    this.#state.socialGrace = null;
    this.#state.specialty = null;
    this.#state.wises = [];
    this.#state.natureAnswers = {};
    this.#state.natureWiseChoice = null;
    this.#state.natureHomeTraitChoice = null;
    this.#state.selectedWeapons = [];
    this.#state.selectedArmor = [];
    this.#state.spellSchoolRoll = null;
    this.#state.spellSchool = null;
    this.#state.spells = [];
    this.#state.relicRoll = null;
    this.#state.relics = [];
    this.#state.invocations = [];

    this.render();
  }

  /** @this {CharacterWizard} */
  static #onSelectStock(event, target) {
    const stockKey = target.dataset.stock;
    if ( !stockKey ) return;
    this.#state.stock = stockKey;
    this.render();
  }

  /* -------------------------------------------- */
  /*  Action Handlers — Step 2: Upbringing        */
  /* -------------------------------------------- */

  /** @this {CharacterWizard} */
  static #onSelectUpbringing(event, target) {
    this.#state.upbringingSkill = target.dataset.skill;
    this.render();
  }

  /* -------------------------------------------- */
  /*  Action Handlers — Step 3: Hometown          */
  /* -------------------------------------------- */

  /** @this {CharacterWizard} */
  static #onSelectHometown(event, target) {
    const key = target.dataset.hometown;
    if ( this.#state.hometown !== key ) {
      this.#state.hometown = key;
      this.#state.hometownSkill = null;
      this.#state.homeTrait = null;
    }
    this.render();
  }

  /** @this {CharacterWizard} */
  static #onSelectHometownSkill(event, target) {
    this.#state.hometownSkill = target.dataset.skill;
    this.render();
  }

  /** @this {CharacterWizard} */
  static #onSelectHomeTrait(event, target) {
    this.#state.homeTrait = target.dataset.trait;
    this.render();
  }

  /* -------------------------------------------- */
  /*  Action Handlers — Step 4: Social Grace      */
  /* -------------------------------------------- */

  /** @this {CharacterWizard} */
  static #onSelectSocial(event, target) {
    this.#state.socialGrace = target.dataset.skill;
    this.render();
  }

  /* -------------------------------------------- */
  /*  Action Handlers — Step 5: Specialty         */
  /* -------------------------------------------- */

  /** @this {CharacterWizard} */
  static #onSelectSpecialty(event, target) {
    this.#state.specialty = target.dataset.skill;
    this.render();
  }

  /* -------------------------------------------- */
  /*  Action Handlers — Step 6: Wises             */
  /* -------------------------------------------- */

  /** @this {CharacterWizard} */
  static #onSelectRequiredWise(event, target) {
    const wise = target.dataset.wise;
    if ( !wise ) return;
    const wises = [...this.#state.wises];
    wises[0] = wise;
    this.#state.wises = wises;
    this.render();
  }

  /* -------------------------------------------- */
  /*  Action Handlers — Step 7: Nature            */
  /* -------------------------------------------- */

  /** @this {CharacterWizard} */
  static #onAnswerNature(event, target) {
    const idx = parseInt(target.dataset.questionIndex);
    const answer = target.dataset.answer === "yes";
    this.#state.natureAnswers[idx] = answer;
    // Clear secondary choices if changing an answer.
    this.#state.natureWiseChoice = null;
    this.#state.natureHomeTraitChoice = null;
    this.render();
  }

  /** @this {CharacterWizard} */
  static #onSelectNatureWise(event, target) {
    this.#state.natureWiseChoice = target.dataset.wise;
    this.render();
  }

  /** @this {CharacterWizard} */
  static #onSelectNatureHomeTrait(event, target) {
    this.#state.natureHomeTraitChoice = target.dataset.trait;
    this.render();
  }

  /* -------------------------------------------- */
  /*  Action Handlers — Step 8: Circles           */
  /* -------------------------------------------- */

  /** @this {CharacterWizard} */
  static #onAnswerCircles(event, target) {
    const question = target.dataset.question;
    const answer = target.dataset.answer === "yes";
    this.#state[question] = answer;
    this.render();
  }

  /* -------------------------------------------- */
  /*  Action Handlers — Step 9: Gear              */
  /* -------------------------------------------- */

  /** @this {CharacterWizard} */
  static #onSelectPackType(event, target) {
    this.#state.packType = target.dataset.pack;
    this.render();
  }

  /** @this {CharacterWizard} */
  static async #onRollSpells() {
    const roll = await new Roll("2d6").evaluate();
    const total = roll.total;
    const entry = SPELL_SCHOOL_TABLE[total];
    this.#state.spellSchoolRoll = total;
    this.#state.spellSchool = entry?.school || "Choose";
    this.#state.spells = [...(entry?.spells || [])];

    // Display roll in chat.
    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this.#actor }),
      flavor: game.i18n.localize("TB2E.Wizard.SpellSchoolRoll")
    });

    this.render();
  }

  /** @this {CharacterWizard} */
  static async #onRollRelics() {
    const roll = await new Roll("3d6").evaluate();
    const total = roll.total;
    const table = this.#state.class === "shaman" ? SHAMAN_RELIC_TABLE : THEURGE_RELIC_TABLE;
    const entry = table[total];
    this.#state.relicRoll = total;
    this.#state.relics = [...(entry?.relics || [])];
    this.#state.invocations = [...(entry?.invocations || [])];

    // Display roll in chat.
    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this.#actor }),
      flavor: game.i18n.localize("TB2E.Wizard.RelicRoll")
    });

    this.render();
  }

  /* -------------------------------------------- */
  /*  Action Handlers — Step 10: Weapons          */
  /* -------------------------------------------- */

  /** @this {CharacterWizard} */
  static #onSelectWeapon(event, target) {
    const weapon = target.dataset.weapon;
    if ( !weapon ) return;
    const weapons = [...this.#state.selectedWeapons];
    const idx = weapons.indexOf(weapon);
    if ( idx >= 0 ) weapons.splice(idx, 1);
    else weapons.push(weapon);
    this.#state.selectedWeapons = weapons;
    this.render();
  }

  /* -------------------------------------------- */
  /*  Action Handlers — Step 11: Armor            */
  /* -------------------------------------------- */

  /** @this {CharacterWizard} */
  static #onSelectArmor(event, target) {
    const armor = target.dataset.armor;
    if ( !armor ) return;
    const selected = [...this.#state.selectedArmor];
    const idx = selected.indexOf(armor);
    if ( idx >= 0 ) selected.splice(idx, 1);
    else selected.push(armor);
    this.#state.selectedArmor = selected;
    this.render();
  }

  /* -------------------------------------------- */
  /*  Finish — Apply to Actor                     */
  /* -------------------------------------------- */

  /** @this {CharacterWizard} */
  static async #onFinish() {
    // Read final text inputs from the DOM.
    for ( const input of this.element.querySelectorAll(".finishing-input") ) {
      const field = input.dataset.field;
      if ( field ) this.#state[field] = input.value.trim();
    }

    if ( !this.#state.name ) {
      ui.notifications.warn(game.i18n.localize("TB2E.Wizard.NameRequired"));
      return;
    }

    await this.#applyToActor();
    this.close();
    this.#actor.sheet?.render(true);
  }

  /* -------------------------------------------- */

  async #applyToActor() {
    const s = this.#state;
    const classDef = CLASS_DEFS[s.class];
    if ( !classDef ) return;

    // Build final skills.
    const finalSkills = buildSkillsMap(s);
    const skillsData = {};
    for ( const [key, rating] of Object.entries(finalSkills) ) {
      skillsData[`skills.${key}.rating`] = rating;
    }

    // Compute final values.
    const nature = this.#computeNature();
    const circles = this.#computeCircles();
    const resources = this.#computeResources();
    const descriptors = this.#computeNatureDescriptors();

    // Build wises array.
    const allWises = [...s.wises];
    // Add nature-granted wise.
    if ( s.natureWiseChoice ) allWises.push(s.natureWiseChoice);
    // Add changeling Huldrekall wise if applicable (handled via trait, not wise).

    const wisesData = allWises.filter(w => w).map(name => ({
      name,
      pass: false, fail: false, fate: false, persona: false
    }));

    // Build hometown label.
    const hometownDef = HOMETOWNS[s.hometown];
    const homeLabel = hometownDef ? game.i18n.localize(hometownDef.label) : "";

    // Actor update.
    const updateData = {
      name: s.name,
      "system.stock": s.stock,
      "system.class": s.class,
      "system.level": 1,
      "system.age": s.age,
      "system.home": homeLabel,
      "system.raiment": s.raiment,
      "system.belief": s.belief,
      "system.instinct": s.instinct,
      "system.parents": s.parents,
      "system.mentor": s.mentor,
      "system.friend": s.friend,
      "system.enemy": s.enemy,
      "system.abilities.will.rating": s.will,
      "system.abilities.health.rating": s.health,
      "system.abilities.nature.rating": nature,
      "system.abilities.nature.max": nature,
      "system.abilities.resources.rating": resources,
      "system.abilities.circles.rating": circles,
      "system.might": 1,
      "system.natureDescriptors": descriptors,
      "system.wises": wisesData,
      "system.conditions.fresh": true,
      "system.memoryPalaceSlots": classDef.memoryPalaceSlots,
      "system.urdr.capacity": classDef.urdr
    };

    // Apply skills via dot-notation.
    for ( const [path, value] of Object.entries(skillsData) ) {
      updateData[`system.${path}`] = value;
    }

    await this.#actor.update(updateData);

    // Create trait items.
    const traitItems = [];

    // Class trait.
    traitItems.push({
      name: classDef.classTrait,
      type: "trait",
      system: { level: 1 }
    });

    // Home trait.
    if ( s.homeTrait ) {
      const homeTraitLevel = s.natureHomeTraitChoice === s.homeTrait ? 2 : 1;
      traitItems.push({
        name: s.homeTrait,
        type: "trait",
        system: { level: homeTraitLevel }
      });
    }

    // Huldrekall for changelings.
    if ( s.stock === "changeling" ) {
      const huldrekallLevel = this.#getTraitBoostLevel("Huldrekall");
      traitItems.push({
        name: "Huldrekall",
        type: "trait",
        system: { level: huldrekallLevel }
      });
    }

    // Loner trait if no friend.
    if ( s.hasFriend === false ) {
      traitItems.push({
        name: "Loner",
        type: "trait",
        system: { level: 1 }
      });
    }

    // Nature-answer trait boosts.
    const questions = NATURE_QUESTIONS[s.stock]?.questions || [];
    for ( const [idx, answer] of Object.entries(s.natureAnswers) ) {
      const q = questions[idx];
      if ( !q ) continue;
      const effect = answer ? q.yesEffect : q.noEffect;
      if ( effect.traitBoost ) {
        const traitName = effect.traitBoost === "__classTrait__" ? classDef.classTrait : effect.traitBoost;
        // Check if we already added this trait — if so, boost its level.
        const existing = traitItems.find(t => t.name === traitName);
        if ( existing ) {
          existing.system.level = Math.min((existing.system.level || 1) + 1, 3);
        }
        // else: the class trait or home trait was already added at level 1, boosted above.
      }
    }

    if ( traitItems.length ) {
      await Item.implementation.create(traitItems, { parent: this.#actor });
    }

    // Import compendium items (weapons, armor, spells, relics, invocations).
    const itemsToCreate = [];

    // Weapons.
    for ( const weaponName of s.selectedWeapons ) {
      const item = await this.#findCompendiumItem(PACKS.weapons, weaponName);
      if ( item ) itemsToCreate.push(item.toObject());
    }

    // Armor.
    for ( const armorName of s.selectedArmor ) {
      const item = await this.#findCompendiumItem(PACKS.armor, armorName);
      if ( item ) itemsToCreate.push(item.toObject());
    }

    // Spells (magician).
    if ( s.class === "magician" && s.spells.length ) {
      for ( const spellName of s.spells ) {
        const item = await this.#findCompendiumItem(PACKS.spells, spellName);
        if ( item ) itemsToCreate.push(item.toObject());
      }
    }

    // Relics and invocations (theurge).
    if ( s.class === "theurge" ) {
      for ( const relicName of s.relics ) {
        const item = await this.#findCompendiumItem(PACKS.theurgeRelics, relicName);
        if ( item ) itemsToCreate.push(item.toObject());
        else itemsToCreate.push({ name: relicName, type: "relic", system: { tier: "minor" } });
      }
      for ( const invName of s.invocations ) {
        const item = await this.#findCompendiumItem(PACKS.theurgeInvocations, invName);
        if ( item ) itemsToCreate.push(item.toObject());
        else itemsToCreate.push({ name: invName, type: "invocation", system: {} });
      }
    }

    // Relics and invocations (shaman).
    if ( s.class === "shaman" ) {
      for ( const relicName of s.relics ) {
        const item = await this.#findCompendiumItem(PACKS.shamanicRelics, relicName);
        if ( item ) itemsToCreate.push(item.toObject());
        else itemsToCreate.push({ name: relicName, type: "relic", system: { tier: "minor" } });
      }
      for ( const invName of s.invocations ) {
        const item = await this.#findCompendiumItem(PACKS.shamanicInvocations, invName);
        if ( item ) itemsToCreate.push(item.toObject());
        else itemsToCreate.push({ name: invName, type: "invocation", system: {} });
      }
    }

    // Pack (satchel or backpack).
    if ( s.packType ) {
      const packName = s.packType === "backpack" ? "Backpack" : "Satchel";
      const item = await this.#findCompendiumItem(PACKS.containers, packName);
      if ( item ) itemsToCreate.push(item.toObject());
    }

    if ( itemsToCreate.length ) {
      await Item.implementation.create(itemsToCreate, { parent: this.#actor });
    }
  }

  /* -------------------------------------------- */

  /** Get the effective level for a trait boosted by nature answers. */
  #getTraitBoostLevel(traitName) {
    const questions = NATURE_QUESTIONS[this.#state.stock]?.questions || [];
    let level = 1;
    for ( const [idx, answer] of Object.entries(this.#state.natureAnswers) ) {
      const q = questions[idx];
      if ( !q ) continue;
      const effect = answer ? q.yesEffect : q.noEffect;
      if ( effect.traitBoost === traitName ) level = 2;
    }
    return level;
  }

  /**
   * Find an item in a compendium pack by name.
   * @param {string} packId
   * @param {string} name
   * @returns {Promise<Item|null>}
   */
  async #findCompendiumItem(packId, name) {
    const pack = game.packs.get(packId);
    if ( !pack ) return null;
    const index = await pack.getIndex();
    const entry = index.find(e => e.name === name);
    if ( !entry ) return null;
    return pack.getDocument(entry._id);
  }
}
