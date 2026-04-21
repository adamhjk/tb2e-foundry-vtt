import { conditions, skills } from "../../config.mjs";
import { rollTest } from "../../dice/_module.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

export default class NPCSheet extends HandlebarsApplicationMixin(ActorSheetV2) {

  static #INVENTORY_TYPES = new Set(["weapon", "armor", "container", "gear", "supply"]);

  static DEFAULT_OPTIONS = {
    classes: ["tb2e", "sheet", "actor", "npc"],
    position: { width: 650, height: 700 },
    actions: {
      toggleCondition: NPCSheet.#onToggleCondition,
      toggleTeam: NPCSheet.#onToggleTeam,
      addRow: NPCSheet.#onAddRow,
      deleteRow: NPCSheet.#onDeleteRow,
      rollTest: NPCSheet.#onRollTest,
      setTraitLevel: NPCSheet.#onSetTraitLevel,
      addTrait: NPCSheet.#onAddTrait,
      deleteTrait: NPCSheet.#onDeleteTrait,
      createItem: NPCSheet.#onCreateItem,
      editItem: NPCSheet.#onEditItem,
      deleteItem: NPCSheet.#onDeleteItem
    },
    form: { submitOnChange: true },
    window: { resizable: true, minimizable: true }
  };

  /* -------------------------------------------- */
  /*  Parts                                       */
  /* -------------------------------------------- */

  static PARTS = {
    header: {
      template: "systems/tb2e/templates/actors/npc-header.hbs"
    },
    conditions: {
      template: "systems/tb2e/templates/actors/npc-conditions.hbs"
    },
    body: {
      template: "systems/tb2e/templates/actors/npc-body.hbs",
      scrollable: [""]
    }
  };

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

    switch ( partId ) {
      case "header":
        this.#prepareHeaderContext(partContext);
        break;
      case "conditions":
        this.#prepareConditionsContext(partContext);
        break;
      case "body":
        this.#prepareBodyContext(partContext);
        this.#prepareGearContext(partContext);
        break;
    }
    return partContext;
  }

  /* -------------------------------------------- */

  #prepareHeaderContext(context) {
    const sys = this.document.system;

    // Summary line: "Human Innkeeper — Might 2" or just "Might 2".
    const identity = [sys.stock, sys.class].filter(Boolean).join(" ");
    const mightLabel = game.i18n.localize("TB2E.Fields.Might");
    context.summaryLine = identity
      ? `${identity} \u2014 ${mightLabel} ${sys.might}`
      : `${mightLabel} ${sys.might}`;

    // Team toggle display.
    const team = sys.conflict.team || "gm";
    context.teamClass = `team-${team}`;
    context.teamIcon = team === "party" ? "fa-solid fa-users" : "fa-solid fa-dragon";
    context.teamLabel = game.i18n.localize(
      team === "party" ? "TB2E.Conflict.TeamParty" : "TB2E.Conflict.TeamGM"
    );

    // Conflict disposition display.
    const disp = sys.conflict.hp;
    context.inConflict = disp.max > 0;
    if ( context.inConflict ) {
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
    // Exclude fresh — NPCs are never Fresh.
    context.conditions = Object.entries(conditions)
      .filter(([key]) => key !== "fresh")
      .map(([key, cfg]) => ({
        key,
        label: game.i18n.localize(cfg.label),
        icon: cfg.icon,
        color: cfg.color,
        active: sys.conditions[key]
      }));
  }

  /* -------------------------------------------- */

  #prepareBodyContext(context) {
    const sys = this.document.system;

    // Raw abilities
    context.rawAbilities = [
      { key: "nature", label: game.i18n.localize("TB2E.Ability.Nature"), value: sys.abilities.nature.rating },
      { key: "will", label: game.i18n.localize("TB2E.Ability.Will"), value: sys.abilities.will.rating },
      { key: "health", label: game.i18n.localize("TB2E.Ability.Health"), value: sys.abilities.health.rating }
    ];

    // Town abilities
    context.townAbilities = [
      { key: "resources", label: game.i18n.localize("TB2E.Ability.Resources"), value: sys.abilities.resources.rating },
      { key: "circles", label: game.i18n.localize("TB2E.Ability.Circles"), value: sys.abilities.circles.rating },
      { key: "precedence", label: game.i18n.localize("TB2E.Ability.Precedence"), value: sys.abilities.precedence.rating }
    ];

    // All skill options for dropdown, sorted by label
    const allSkillOptions = Object.entries(skills)
      .map(([key, cfg]) => ({ key, label: game.i18n.localize(cfg.label) }))
      .sort((a, b) => a.label.localeCompare(b.label));

    // Skills with index and dropdown options
    context.skills = sys.skills.map((s, i) => ({
      ...s,
      idx: i,
      skillOptions: allSkillOptions.map(opt => ({
        ...opt,
        selected: opt.key === s.key
      }))
    }));

    // Wises
    context.wises = sys.wises;

    // Traits with level pips (Item-based)
    context.traits = (this.document.itemTypes.trait || []).map(item => ({
      itemId: item.id,
      name: item.name,
      level: item.system.level,
      levels: [1, 2, 3].map(l => ({ value: l, active: l === item.system.level }))
    }));
  }

  /* -------------------------------------------- */

  #prepareGearContext(context) {
    const items = this.document.items.filter(i => NPCSheet.#INVENTORY_TYPES.has(i.type));
    context.gear = items.map(item => ({
      itemId: item.id,
      name: item.name,
      type: item.type,
      typeLabel: game.i18n.localize(`TYPES.Item.${item.type}`),
      typeCss: `type-${item.type}`
    }));
  }

  /* -------------------------------------------- */
  /*  Render Hook                                 */
  /* -------------------------------------------- */

  _onRender(context, options) {
    super._onRender(context, options);

    // NPC trait name input change handlers (Item updates).
    for ( const input of this.element.querySelectorAll(".npc-trait-name-input") ) {
      input.addEventListener("change", () => {
        const itemId = input.closest("[data-item-id]")?.dataset.itemId;
        const item = this.document.items.get(itemId);
        if ( item ) item.update({ name: input.value });
      });
    }
  }

  /* -------------------------------------------- */
  /*  Action Handlers                             */
  /* -------------------------------------------- */

  static #onToggleCondition(event, target) {
    const condition = target.dataset.condition;
    const current = this.document.system.conditions[condition];
    this.document.update({ [`system.conditions.${condition}`]: !current });
  }

  /* -------------------------------------------- */

  static #onToggleTeam(event, target) {
    const current = this.document.system.conflict.team || "gm";
    this.document.update({ "system.conflict.team": current === "party" ? "gm" : "party" });
  }

  /* -------------------------------------------- */

  static #onAddRow(event, target) {
    const arrayName = target.dataset.array;
    const current = foundry.utils.deepClone(this.document.system[arrayName] || []);
    if ( arrayName === "wises" ) {
      current.push("");
    } else {
      current.push({});
    }
    this.document.update({ [`system.${arrayName}`]: current });
  }

  /* -------------------------------------------- */

  static #onDeleteRow(event, target) {
    const arrayName = target.dataset.array;
    const index = Number(target.dataset.index);
    const current = foundry.utils.deepClone(this.document.system[arrayName] || []);
    current.splice(index, 1);
    this.document.update({ [`system.${arrayName}`]: current });
  }

  /* -------------------------------------------- */

  static #onSetTraitLevel(event, target) {
    const itemId = target.dataset.itemId;
    const level = Number(target.dataset.level);
    const item = this.document.items.get(itemId);
    if ( item ) item.update({ "system.level": level });
  }

  /* -------------------------------------------- */

  static async #onAddTrait(event, target) {
    await Item.create({ name: "New Trait", type: "trait" }, { parent: this.document });
  }

  static async #onDeleteTrait(event, target) {
    const itemId = target.dataset.itemId;
    const item = this.document.items.get(itemId);
    if ( item ) await item.delete();
  }

  /* -------------------------------------------- */

  static #onRollTest(event, target) {
    const clicked = event.target;
    if ( clicked.closest("input, select, button") ) return;
    rollTest({
      actor: this.document,
      type: target.dataset.type,
      key: target.dataset.key
    });
  }

  /* -------------------------------------------- */

  static async #onCreateItem(event, target) {
    const type = target.dataset.type || "gear";
    const name = game.i18n.localize(`TYPES.Item.${type}`);
    await Item.create({ name, type }, { parent: this.document });
  }

  /* -------------------------------------------- */

  static #onEditItem(event, target) {
    const itemId = target.dataset.itemId;
    const item = this.document.items.get(itemId);
    if ( item ) item.sheet.render(true);
  }

  /* -------------------------------------------- */

  static async #onDeleteItem(event, target) {
    const itemId = target.dataset.itemId;
    const item = this.document.items.get(itemId);
    if ( item ) await item.delete();
  }
}
