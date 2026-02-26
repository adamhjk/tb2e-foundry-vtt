import { advancementNeeded, conditions, abilities, skills, packSlots, levelRequirements } from "../../config.mjs";
import { rollTest, showAdvancementDialog } from "../../dice/_module.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

export default class CharacterSheet extends HandlebarsApplicationMixin(ActorSheetV2) {

  static DEFAULT_OPTIONS = {
    classes: ["tb2e", "sheet", "actor", "character"],
    position: { width: 800, height: 750 },
    actions: {
      toggleCondition: CharacterSheet.#onToggleCondition,
      toggleBubble: CharacterSheet.#onToggleBubble,
      togglePoint: CharacterSheet.#onTogglePoint,
      setTraitLevel: CharacterSheet.#onSetTraitLevel,
      addRow: CharacterSheet.#onAddRow,
      deleteRow: CharacterSheet.#onDeleteRow,
      rollTest: CharacterSheet.#onRollTest,
      advance: CharacterSheet.#onAdvance
    },
    form: { submitOnChange: true },
    window: { resizable: true }
  };

  /* -------------------------------------------- */
  /*  Parts & Tabs                                */
  /* -------------------------------------------- */

  static PARTS = {
    header: {
      template: "systems/tb2e/templates/actors/character-header.hbs"
    },
    conditions: {
      template: "systems/tb2e/templates/actors/character-conditions.hbs"
    },
    tabs: {
      template: "templates/generic/tab-navigation.hbs"
    },
    identity: {
      template: "systems/tb2e/templates/actors/tabs/character-identity.hbs",
      scrollable: [""]
    },
    abilities: {
      template: "systems/tb2e/templates/actors/tabs/character-abilities.hbs",
      scrollable: [""]
    },
    skills: {
      template: "systems/tb2e/templates/actors/tabs/character-skills.hbs",
      scrollable: [""]
    },
    traits: {
      template: "systems/tb2e/templates/actors/tabs/character-traits.hbs",
      scrollable: [""]
    },
    inventory: {
      template: "systems/tb2e/templates/actors/tabs/character-inventory.hbs",
      scrollable: [""]
    },
    magic: {
      template: "systems/tb2e/templates/actors/tabs/character-magic.hbs",
      scrollable: [""]
    },
    biography: {
      template: "systems/tb2e/templates/actors/tabs/character-biography.hbs",
      scrollable: [""]
    }
  };

  static TABS = {
    sheet: {
      tabs: [
        { id: "identity",  icon: "fa-solid fa-scroll",      label: "TB2E.Tab.identity" },
        { id: "abilities", icon: "fa-solid fa-dice-d20",    label: "TB2E.Tab.abilities" },
        { id: "skills",    icon: "fa-solid fa-hammer",      label: "TB2E.Tab.skills" },
        { id: "traits",    icon: "fa-solid fa-star",        label: "TB2E.Tab.traits" },
        { id: "inventory", icon: "fa-solid fa-bag-shopping", label: "TB2E.Tab.inventory" },
        { id: "magic",     icon: "fa-solid fa-hat-wizard",  label: "TB2E.Tab.magic" },
        { id: "biography", icon: "fa-solid fa-book-open",   label: "TB2E.Tab.biography" }
      ],
      initial: "abilities",
      labelPrefix: "TB2E.Tab"
    }
  };

  /* -------------------------------------------- */
  /*  Partials                                    */
  /* -------------------------------------------- */

  static PARTIALS = [
    "systems/tb2e/templates/actors/parts/advancement-bubbles.hbs",
    "systems/tb2e/templates/actors/parts/point-boxes.hbs"
  ];

  static {
    Hooks.once("init", () => {
      loadTemplates(CharacterSheet.PARTIALS);
    });
  }

  /* -------------------------------------------- */
  /*  Context Preparation                         */
  /* -------------------------------------------- */

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.document;
    context.actor = actor;
    context.system = actor.system;
    return context;
  }

  /* -------------------------------------------- */

  async _preparePartContext(partId, context, options) {
    const partContext = await super._preparePartContext(partId, context, options);
    if ( partId in partContext.tabs ) partContext.tab = partContext.tabs[partId];

    switch ( partId ) {
      case "header":
        this.#prepareHeaderContext(partContext);
        break;
      case "conditions":
        this.#prepareConditionsContext(partContext);
        break;
      case "identity":
        partContext.whoYouAreFields = this._prepareWhoYouAreFields();
        partContext.convictionFields = this._prepareConvictionFields();
        break;
      case "abilities":
        this.#prepareAbilitiesContext(partContext);
        break;
      case "skills":
        this.#prepareSkillsContext(partContext);
        break;
      case "traits":
        this.#prepareTraitsContext(partContext);
        break;
      case "inventory":
        this.#prepareInventoryContext(partContext);
        break;
      case "magic":
        partContext.spells = context.system.spells;
        partContext.relics = context.system.relics;
        break;
      case "biography":
        this.#prepareBiographyContext(partContext);
        break;
    }
    return partContext;
  }

  /* -------------------------------------------- */

  #prepareHeaderContext(context) {
    const sys = this.document.system;
    context.fateLabel = game.i18n.localize("TB2E.Fields.Fate");
    context.personaLabel = game.i18n.localize("TB2E.Fields.Persona");
    context.fatePips = this.#buildPips(sys.fate.current, sys.fate.total);
    context.personaPips = this.#buildPips(sys.persona.current, sys.persona.total);
  }

  /* -------------------------------------------- */

  #prepareConditionsContext(context) {
    const sys = this.document.system;
    context.conditions = Object.entries(conditions).map(([key, cfg]) => ({
      key,
      label: game.i18n.localize(cfg.label),
      icon: cfg.icon,
      color: cfg.color,
      active: sys.conditions[key]
    }));
  }

  /* -------------------------------------------- */

  #prepareAbilitiesContext(context) {
    const sys = this.document.system;
    context.rawAbilities = [];
    context.townAbilities = [];

    for ( const [key, cfg] of Object.entries(abilities) ) {
      if ( cfg.group === "special" ) continue;
      const data = sys.abilities[key];
      const adv = advancementNeeded(data.rating);
      const entry = {
        key,
        label: game.i18n.localize(cfg.label),
        path: `system.abilities.${key}`,
        rating: data.rating,
        pass: data.pass,
        fail: data.fail,
        passArray: this.#buildBubbles(data.pass, adv.pass),
        failArray: this.#buildBubbles(data.fail, adv.fail),
        canAdvance: data.pass >= adv.pass && data.fail >= adv.fail && adv.pass > 0
      };
      if ( cfg.group === "raw" ) context.rawAbilities.push(entry);
      else context.townAbilities.push(entry);
    }
  }

  /* -------------------------------------------- */

  #prepareSkillsContext(context) {
    const sys = this.document.system;
    context.skills = Object.entries(skills).map(([key, cfg]) => {
      const data = sys.skills[key];
      const adv = advancementNeeded(data.rating);
      return {
        key,
        label: game.i18n.localize(cfg.label),
        bl: cfg.bl,
        path: `system.skills.${key}`,
        rating: data.rating,
        hasRating: data.rating > 0,
        pass: data.pass,
        fail: data.fail,
        passArray: this.#buildBubbles(data.pass, adv.pass),
        failArray: this.#buildBubbles(data.fail, adv.fail),
        canAdvance: data.pass >= adv.pass && data.fail >= adv.fail && adv.pass > 0
      };
    });
  }

  /* -------------------------------------------- */

  #prepareTraitsContext(context) {
    const sys = this.document.system;
    context.traits = sys.traits.map((t, i) => ({
      ...t,
      idx: i,
      levels: [1, 2, 3].map(l => ({ value: l, active: l === t.level }))
    }));
    context.wises = sys.wises;
  }

  /* -------------------------------------------- */

  #prepareInventoryContext(context) {
    const sys = this.document.system;
    const packCount = packSlots[sys.inventory.packType] || 0;

    context.packOptions = [
      { key: "none", label: game.i18n.localize("TB2E.Pack.none"), selected: sys.inventory.packType === "none" },
      { key: "satchel", label: game.i18n.localize("TB2E.Pack.satchel"), selected: sys.inventory.packType === "satchel" },
      { key: "backpack", label: game.i18n.localize("TB2E.Pack.backpack"), selected: sys.inventory.packType === "backpack" }
    ];

    // Build slot groups
    const slotDefs = [
      { key: "head",   label: "TB2E.Inventory.Head",   count: 1 },
      { key: "neck",   label: "TB2E.Inventory.Neck",   count: 1 },
      { key: "hands",  label: "TB2E.Inventory.Hands",  count: 2 },
      { key: "torso",  label: "TB2E.Inventory.Torso",  count: 3 },
      { key: "belt",   label: "TB2E.Inventory.Belt",   count: 3 },
      { key: "feet",   label: "TB2E.Inventory.Feet",   count: 1 },
      { key: "pocket", label: "TB2E.Inventory.Pocket", count: 1 },
      { key: "pack",   label: "TB2E.Inventory.Pack",   count: packCount }
    ];
    if ( sys.inventory.hasLargeSack ) {
      slotDefs.push({ key: "sack", label: "TB2E.Inventory.Sack", count: 6 });
    }
    for ( let i = 0; i < sys.inventory.smallSacks; i++ ) {
      slotDefs.push({ key: `smallsack${i}`, label: "TB2E.Inventory.Sack", count: 3 });
    }

    context.inventorySlots = slotDefs.filter(s => s.count > 0).map(s => ({
      key: s.key,
      label: game.i18n.localize(s.label),
      count: s.count,
      slots: Array.from({ length: s.count }, () => ({ occupied: false, name: "" }))
    }));
  }

  /* -------------------------------------------- */

  #prepareBiographyContext(context) {
    const sys = this.document.system;
    context.allies = sys.allies;
    context.currentLevel = sys.level;
    context.levelRequirements = Object.entries(levelRequirements).map(([lvl, req]) => ({
      level: Number(lvl),
      fate: req.fate,
      persona: req.persona,
      benefit: game.i18n.localize(req.benefit)
    }));
  }

  /* -------------------------------------------- */
  /*  Identity Tab Helpers (unchanged)            */
  /* -------------------------------------------- */

  _prepareWhoYouAreFields() {
    const sys = this.document.system;
    return [
      { name: "stock", label: game.i18n.localize("TB2E.Fields.Stock"), value: sys.stock, type: "text" },
      { name: "class", label: game.i18n.localize("TB2E.Fields.Class"), value: sys.class, type: "text" },
      { name: "age", label: game.i18n.localize("TB2E.Fields.Age"), value: sys.age, type: "text" },
      { name: "home", label: game.i18n.localize("TB2E.Fields.Home"), value: sys.home, type: "text" },
      { name: "raiment", label: game.i18n.localize("TB2E.Fields.Raiment"), value: sys.raiment, type: "text" },
      { name: "parents", label: game.i18n.localize("TB2E.Fields.Parents"), value: sys.parents, type: "text" },
      { name: "mentor", label: game.i18n.localize("TB2E.Fields.Mentor"), value: sys.mentor, type: "text" },
      { name: "friend", label: game.i18n.localize("TB2E.Fields.Friend"), value: sys.friend, type: "text" },
      { name: "enemy", label: game.i18n.localize("TB2E.Fields.Enemy"), value: sys.enemy, type: "text" },
      { name: "level", label: game.i18n.localize("TB2E.Fields.Level"), value: sys.level, type: "number" }
    ];
  }

  /* -------------------------------------------- */

  _prepareConvictionFields() {
    const sys = this.document.system;
    return [
      {
        name: "belief", value: sys.belief,
        label: game.i18n.localize("TB2E.Fields.Belief"),
        hint: game.i18n.localize("TB2E.Fields.BeliefHint")
      },
      {
        name: "creed", value: sys.creed,
        label: game.i18n.localize("TB2E.Fields.Creed"),
        hint: game.i18n.localize("TB2E.Fields.CreedHint")
      },
      {
        name: "goal", value: sys.goal,
        label: game.i18n.localize("TB2E.Fields.Goal"),
        hint: game.i18n.localize("TB2E.Fields.GoalHint")
      },
      {
        name: "instinct", value: sys.instinct,
        label: game.i18n.localize("TB2E.Fields.Instinct"),
        hint: game.i18n.localize("TB2E.Fields.InstinctHint")
      }
    ];
  }

  /* -------------------------------------------- */
  /*  Utility Helpers                             */
  /* -------------------------------------------- */

  /**
   * Build an array of {filled} objects for advancement bubble rendering.
   * @param {number} current - How many are filled.
   * @param {number} total - How many bubbles to show.
   * @returns {{filled: boolean}[]}
   */
  #buildBubbles(current, total) {
    if ( total <= 0 ) return [];
    return Array.from({ length: total }, (_, i) => ({ filled: i < current }));
  }

  /**
   * Build an array of {filled} objects for point pip rendering.
   * @param {number} current - Current available points.
   * @param {number} total - Max points.
   * @returns {{filled: boolean}[]}
   */
  #buildPips(current, total) {
    if ( total <= 0 ) return [];
    return Array.from({ length: total }, (_, i) => ({ filled: i < current }));
  }

  /* -------------------------------------------- */
  /*  Action Handlers                             */
  /* -------------------------------------------- */

  /**
   * Toggle a condition on/off. If activating any condition, deactivate Fresh.
   * If deactivating all conditions, reactivate Fresh.
   */
  static #onToggleCondition(event, target) {
    const condition = target.dataset.condition;
    const sys = this.document.system;
    const current = sys.conditions[condition];
    const update = {};

    if ( condition === "fresh" ) {
      // Toggling Fresh on clears all other conditions
      if ( !current ) {
        update["system.conditions.fresh"] = true;
        for ( const key of Object.keys(sys.conditions) ) {
          if ( key !== "fresh" ) update[`system.conditions.${key}`] = false;
        }
      } else {
        update["system.conditions.fresh"] = false;
      }
    } else {
      update[`system.conditions.${condition}`] = !current;
      // Activating a negative condition removes Fresh
      if ( !current ) {
        update["system.conditions.fresh"] = false;
      }
    }
    this.document.update(update);
  }

  /* -------------------------------------------- */

  /**
   * Toggle an advancement bubble. Clicking sets the count to index+1,
   * or if already at that value, sets it to index (toggle off the last filled).
   */
  static #onToggleBubble(event, target) {
    const path = target.dataset.path;
    const index = Number(target.dataset.index);
    const current = foundry.utils.getProperty(this.document, path);
    const newVal = (current === index + 1) ? index : index + 1;
    this.document.update({ [path]: newVal });
  }

  /* -------------------------------------------- */

  /**
   * Toggle a point pip (fate/persona). Same logic as bubbles.
   */
  static #onTogglePoint(event, target) {
    const path = target.dataset.path;
    const index = Number(target.dataset.index);
    const current = foundry.utils.getProperty(this.document, path);
    const newVal = (current === index + 1) ? index : index + 1;
    this.document.update({ [path]: newVal });
  }

  /* -------------------------------------------- */

  /**
   * Set trait level (1/2/3).
   */
  static #onSetTraitLevel(event, target) {
    const index = Number(target.dataset.index);
    const level = Number(target.dataset.level);
    this.document.update({ [`system.traits.${index}.level`]: level });
  }

  /* -------------------------------------------- */

  /**
   * Add a blank row to an array field (spells, relics, allies).
   */
  static #onAddRow(event, target) {
    const arrayName = target.dataset.array;
    const current = foundry.utils.deepClone(this.document.system[arrayName] || []);
    current.push({});
    this.document.update({ [`system.${arrayName}`]: current });
  }

  /* -------------------------------------------- */

  /**
   * Delete a row from an array field.
   */
  static #onDeleteRow(event, target) {
    const arrayName = target.dataset.array;
    const index = Number(target.dataset.index);
    const current = foundry.utils.deepClone(this.document.system[arrayName] || []);
    current.splice(index, 1);
    this.document.update({ [`system.${arrayName}`]: current });
  }

  /* -------------------------------------------- */

  /**
   * Roll an ability or skill test. Ignores clicks on inputs and advancement bubbles
   * so the row acts as a clickable roll trigger only on "dead" space and the label.
   */
  static #onRollTest(event, target) {
    const clicked = event.target;
    if ( clicked.closest("input, button.bubble, .btn-advance") ) return;
    rollTest({
      actor: this.document,
      type: target.dataset.type,
      key: target.dataset.key
    });
  }

  /* -------------------------------------------- */

  /**
   * Trigger the advancement dialog for an ability or skill.
   */
  static #onAdvance(event, target) {
    showAdvancementDialog({
      actor: this.document,
      type: target.dataset.type,
      key: target.dataset.key
    });
  }
}
