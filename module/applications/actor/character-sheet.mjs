import { advancementNeeded, conditions, abilities, skills, packSlots, levelRequirements } from "../../config.mjs";
import { rollTest, showAdvancementDialog } from "../../dice/_module.mjs";
import { rollDisposition, evaluateRoll, gatherHelpModifiers } from "../../dice/tb2e-roll.mjs";
import { getEligibleHelpers } from "../../dice/help.mjs";

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
      advance: CharacterSheet.#onAdvance,
      toggleTeam: CharacterSheet.#onToggleTeam,
      conflictChooseSkill: CharacterSheet.#onConflictChooseSkill,
      conflictRollDisposition: CharacterSheet.#onConflictRollDisposition,
      conflictDistribute: CharacterSheet.#onConflictDistribute,
      conflictDeclareWeapon: CharacterSheet.#onConflictDeclareWeapon
    },
    form: { submitOnChange: true },
    window: { resizable: true }
  };

  /* -------------------------------------------- */
  /** @type {number|null} */
  #updateCombatHookId = null;

  /** @type {number|null} */
  #updateCombatantHookId = null;

  /** @override */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    // Re-render conflict part when combat state or combatant data changes.
    this.#updateCombatHookId = Hooks.on("updateCombat", () => {
      this.render({ parts: ["conflict"] });
    });
    this.#updateCombatantHookId = Hooks.on("updateCombatant", (combatant) => {
      if ( combatant.actorId === this.document.id || combatant.parent?.combatants.some(c => c.actorId === this.document.id) ) {
        this.render({ parts: ["conflict"] });
      }
    });
  }

  /** @override */
  async _onClose(options) {
    if ( this.#updateCombatHookId != null ) {
      Hooks.off("updateCombat", this.#updateCombatHookId);
      this.#updateCombatHookId = null;
    }
    if ( this.#updateCombatantHookId != null ) {
      Hooks.off("updateCombatant", this.#updateCombatantHookId);
      this.#updateCombatantHookId = null;
    }
    await super._onClose(options);
  }

  /*  Parts & Tabs                                */
  /* -------------------------------------------- */

  static PARTS = {
    header: {
      template: "systems/tb2e/templates/actors/character-header.hbs"
    },
    referenceBar: {
      template: "systems/tb2e/templates/actors/character-reference-bar.hbs"
    },
    conditions: {
      template: "systems/tb2e/templates/actors/character-conditions.hbs"
    },
    conflict: {
      template: "systems/tb2e/templates/actors/character-conflict.hbs"
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
      case "referenceBar":
        partContext.placeholderText = game.i18n.localize("TB2E.Reference.Placeholder");
        break;
      case "conditions":
        this.#prepareConditionsContext(partContext);
        break;
      case "conflict":
        this.#prepareConflictContext(partContext);
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

    // Team toggle display.
    const team = sys.conflict.team || "party";
    context.teamClass = `team-${team}`;
    context.teamIcon = team === "party" ? "fa-solid fa-users" : "fa-solid fa-dragon";
    context.teamLabel = game.i18n.localize(
      team === "party" ? "TB2E.Conflict.TeamParty" : "TB2E.Conflict.TeamGM"
    );

    // Conflict disposition display.
    const disp = sys.conflict.hp;
    context.inConflict = disp.max > 0;
    if ( context.inConflict ) {
      // Derive the conflict label from the active combat.
      const combat = game.combats?.find(c =>
        c.isConflict && c.combatants.some(cb => cb.actorId === this.document.id)
      );
      const conflictType = combat?.system.conflictType || "capture";
      const cfg = CONFIG.TB2E.conflictTypes[conflictType];
      context.conflictLabel = game.i18n.localize(cfg?.label || "TB2E.Conflict.Title");
      context.dispositionPercent = Math.round((disp.value / disp.max) * 100);
    }
  }

  /* -------------------------------------------- */

  #prepareConditionsContext(context) {
    const sys = this.document.system;
    context.conditions = Object.entries(conditions).map(([key, cfg]) => ({
      key,
      label: game.i18n.localize(cfg.label),
      icon: cfg.icon,
      color: cfg.color,
      active: sys.conditions[key],
      page: cfg.page
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
        canAdvance: data.pass >= adv.pass && data.fail >= adv.fail && adv.pass > 0,
        page: cfg.page
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
        canAdvance: data.pass >= adv.pass && data.fail >= adv.fail && adv.pass > 0,
        page: cfg.page
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
  /*  Conflict Panel Context                      */
  /* -------------------------------------------- */

  /**
   * Prepare the conflict panel context for the character sheet.
   * Only populates when this character is part of an active conflict.
   * @param {object} context
   */
  #prepareConflictContext(context) {
    const actor = this.document;
    const combat = game.combats?.find(c =>
      c.isConflict && c.combatants.some(cb => cb.actorId === actor.id)
    );

    if ( !combat ) {
      context.conflict = { active: false };
      return;
    }

    const combatant = combat.combatants.find(c => c.actorId === actor.id);
    if ( !combatant ) {
      context.conflict = { active: false };
      return;
    }

    const groupId = combatant._source.group;
    const gd = combat.system.groupDispositions || {};
    const groupData = gd[groupId] || {};
    const phase = combat.system.phase;
    const conflictCfg = CONFIG.TB2E.conflictTypes[combat.system.conflictType];
    const isCaptain = groupData.captainId === combatant.id;
    const disp = actor.system.conflict.hp;

    const conflictData = {
      active: true,
      combatId: combat.id,
      groupId,
      combatantId: combatant.id,
      typeLabel: game.i18n.localize(conflictCfg?.label ?? "TB2E.Conflict.Title"),
      phase,
      isCaptain,
      hp: disp,
      hpPercent: disp.max > 0 ? Math.round((disp.value / disp.max) * 100) : 0,
      weapon: combatant.system.weapon || actor.system.conflict.weapon || "",
      isRolling: phase === "rolling",
      isDistribution: phase === "distribution",
      isWeapons: phase === "weapons",
      isScriptingOrActive: phase === "scripting" || phase === "active",
      hasRolled: groupData.rolled != null,
      hasDistributed: !!groupData.distributed
    };

    // Rolling phase data.
    if ( phase === "rolling" && isCaptain && !groupData.rolled ) {
      const captain = combat.combatants.get(groupData.captainId);
      const chosenSkill = captain?.system.chosenSkill || null;
      conflictData.needsSkillChoice = !chosenSkill && (conflictCfg?.dispositionSkills?.length > 1);

      if ( conflictData.needsSkillChoice ) {
        conflictData.skillOptions = (conflictCfg.dispositionSkills || []).map(k => ({
          key: k,
          label: game.i18n.localize(CONFIG.TB2E.skills[k]?.label || k),
          rating: actor.system.skills[k]?.rating || 0
        }));
      } else {
        const skill = chosenSkill || conflictCfg?.dispositionSkills?.[0];
        conflictData.chosenSkillLabel = skill ? game.i18n.localize(CONFIG.TB2E.skills[skill]?.label || skill) : "";
        conflictData.rollPool = actor.system.skills[skill]?.rating || 0;
        conflictData.abilityLabel = game.i18n.localize(
          CONFIG.TB2E.abilities[conflictCfg.dispositionAbility]?.label || conflictCfg.dispositionAbility
        );
        conflictData.abilityRating = actor.system.abilities[conflictCfg.dispositionAbility]?.rating || 0;
      }
    }

    // Distribution phase data.
    if ( phase === "distribution" && isCaptain && !groupData.distributed && groupData.rolled != null ) {
      const total = groupData.rolled;
      const members = combat.combatants.filter(c => c._source.group === groupId);
      const base = Math.floor(total / (members.length || 1));
      let remainder = total - (base * (members.length || 1));
      conflictData.dispositionTotal = total;
      conflictData.distributionRows = members.map(c => {
        const suggested = base + (remainder > 0 ? 1 : 0);
        if ( remainder > 0 ) remainder--;
        return {
          id: c.id,
          name: c.name,
          isCaptain: groupData.captainId === c.id,
          suggested
        };
      });
    }

    context.conflict = conflictData;
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
  /*  Render Hook                                 */
  /* -------------------------------------------- */

  _onRender(context, options) {
    super._onRender(context, options);

    // Reference bar hover behavior.
    const bar = this.element.querySelector(".reference-bar-text");
    if ( bar ) {
      const placeholder = bar.textContent;
      this.element.querySelectorAll("[data-page]").forEach(el => {
        el.addEventListener("mouseenter", () => {
          const label = el.querySelector(".skill-name, .ability-name, .condition-label")?.textContent || "";
          bar.textContent = `${label.trim()} \u2014 ${el.dataset.page}`;
          bar.classList.remove("placeholder");
        });
        el.addEventListener("mouseleave", () => {
          bar.textContent = placeholder;
          bar.classList.add("placeholder");
        });
      });
    }

    // Conflict distribution live validation.
    const distSection = this.element.querySelector(".conflict-distribution");
    if ( distSection ) {
      const inputs = distSection.querySelectorAll(".conflict-dist-value");
      const remainingEl = distSection.querySelector(".conflict-dist-remaining");
      const total = parseInt(distSection.dataset.total) || 0;
      function updateRemaining() {
        let sum = 0;
        for ( const input of inputs ) sum += parseInt(input.value) || 0;
        const remaining = total - sum;
        remainingEl.textContent = remaining;
        remainingEl.classList.toggle("invalid", remaining !== 0);
      }
      for ( const input of inputs ) {
        input.addEventListener("change", updateRemaining);
        input.addEventListener("input", updateRemaining);
      }
    }
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

  /* -------------------------------------------- */

  /**
   * Toggle team assignment between "party" and "gm".
   */
  static #onToggleTeam(event, target) {
    const current = this.document.system.conflict.team || "party";
    this.document.update({ "system.conflict.team": current === "party" ? "gm" : "party" });
  }

  /* -------------------------------------------- */
  /*  Conflict Action Handlers                    */
  /* -------------------------------------------- */

  /**
   * Find the active conflict containing this actor.
   * @returns {{ combat: Combat, combatant: Combatant, groupId: string }|null}
   */
  #findConflict() {
    const actor = this.document;
    const combat = game.combats?.find(c =>
      c.isConflict && c.combatants.some(cb => cb.actorId === actor.id)
    );
    if ( !combat ) return null;
    const combatant = combat.combatants.find(c => c.actorId === actor.id);
    if ( !combatant ) return null;
    return { combat, combatant, groupId: combatant._source.group };
  }

  /**
   * Choose a disposition skill (captain only, rolling phase).
   */
  static async #onConflictChooseSkill(event, target) {
    const info = this.#findConflict();
    if ( !info ) return;
    const skillKey = target.dataset.skill;
    if ( skillKey ) await info.combat.chooseSkill(info.groupId, skillKey);
  }

  /**
   * Roll disposition from the character sheet (captain only).
   */
  static async #onConflictRollDisposition(event, target) {
    const info = this.#findConflict();
    if ( !info ) return;
    const { combat, combatant, groupId } = info;

    const gd = combat.system.groupDispositions?.[groupId];
    if ( !gd?.captainId || gd.captainId !== combatant.id ) return;

    const captain = combat.combatants.get(gd.captainId);
    const chosenSkill = captain?.system.chosenSkill;
    if ( !chosenSkill ) return;

    const conflictCfg = CONFIG.TB2E.conflictTypes[combat.system.conflictType];
    const actor = this.document;

    // Build available helpers.
    const members = combat.combatants.filter(c => c._source.group === groupId);
    const memberActors = members
      .filter(c => c.id !== gd.captainId)
      .map(c => game.actors.get(c.actorId))
      .filter(Boolean);
    const eligible = getEligibleHelpers({
      actor,
      type: "skill",
      key: chosenSkill,
      testContext: { isConflict: true },
      candidates: memberActors
    });
    const availableHelpers = eligible.map(h => {
      const cbt = members.find(c => c.actorId === h.id);
      return {
        id: cbt?.id ?? h.id,
        name: h.name,
        helpVia: h.helpVia,
        helpViaLabel: h.helpViaLabel,
        warnings: h.warnings
      };
    });

    const result = await rollDisposition({
      actor,
      skillKey: chosenSkill,
      abilityKey: conflictCfg.dispositionAbility,
      availableHelpers
    });
    if ( !result ) return;

    // Roll the dice.
    const { roll, successes, diceResults } = await evaluateRoll(result.poolSize);
    const disposition = successes + result.abilityRating;

    // Build modifiers for card display.
    const helpMods = gatherHelpModifiers(result.selectedHelpers || []);
    const allModifiers = [...result.modifiers, ...helpMods];

    // Render roll card.
    const group = combat.groups.get(groupId);
    const cardHtml = await foundry.applications.handlebars.renderTemplate(
      "systems/tb2e/templates/chat/roll-result.hbs", {
        actorName: actor.name, actorImg: actor.img,
        label: result.label, baseDice: result.baseDice, poolSize: result.poolSize,
        successes, modifiers: allModifiers, diceResults,
        isDisposition: true, disposition,
        abilityLabel: result.abilityLabel, abilityRating: result.abilityRating,
        conflictTypeLabel: game.i18n.localize(conflictCfg.label),
        conflictTitle: game.i18n.localize("TB2E.Conflict.Title"),
        groupName: group?.name ?? "",
        successesLabel: game.i18n.localize("TB2E.Roll.Successes"),
        testLabel: game.i18n.localize("TB2E.Roll.Test"),
        testTypeLabel: game.i18n.localize("TB2E.Conflict.Disposition"),
        dispositionLabel: game.i18n.localize("TB2E.Conflict.Disposition")
      }
    );

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: cardHtml, rolls: [roll],
      type: CONST.CHAT_MESSAGE_STYLES.OTHER
    });

    await combat.requestStoreDispositionRoll(groupId, { rolled: disposition, diceResults, cardHtml });
  }

  /**
   * Distribute disposition from the character sheet (captain only).
   */
  static async #onConflictDistribute(event, target) {
    const info = this.#findConflict();
    if ( !info ) return;
    const { combat, groupId } = info;

    const gd = combat.system.groupDispositions?.[groupId];
    if ( !gd?.rolled ) return;
    const total = gd.rolled;

    // Read distribution from inputs.
    const section = target.closest(".conflict-distribution");
    const distribution = {};
    const inputs = section.querySelectorAll(".conflict-dist-value");
    for ( const input of inputs ) {
      distribution[input.name.replace("disp-", "")] = parseInt(input.value) || 0;
    }

    const sum = Object.values(distribution).reduce((a, b) => a + b, 0);
    if ( sum !== total ) {
      ui.notifications.warn(game.i18n.format("TB2E.Conflict.DistributionMismatch", { total, sum }));
      return;
    }

    await combat.distributeDisposition(groupId, distribution);
  }

  /**
   * Declare weapon from the character sheet (weapons phase).
   */
  static async #onConflictDeclareWeapon(event, target) {
    const info = this.#findConflict();
    if ( !info ) return;

    const section = target.closest(".conflict-weapon-area");
    const input = section?.querySelector(".conflict-weapon-input");
    const weaponName = input?.value?.trim() || "";
    await info.combat.setWeapon(info.combatant.id, weaponName);
  }
}
