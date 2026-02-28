import { conditions, skills } from "../../config.mjs";
import { rollTest } from "../../dice/_module.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

export default class NPCSheet extends HandlebarsApplicationMixin(ActorSheetV2) {

  static DEFAULT_OPTIONS = {
    classes: ["tb2e", "sheet", "actor", "npc"],
    position: { width: 650, height: 700 },
    actions: {
      toggleCondition: NPCSheet.#onToggleCondition,
      toggleTeam: NPCSheet.#onToggleTeam,
      addRow: NPCSheet.#onAddRow,
      deleteRow: NPCSheet.#onDeleteRow,
      rollTest: NPCSheet.#onRollTest,
      setTraitLevel: NPCSheet.#onSetTraitLevel
    },
    form: { submitOnChange: true },
    window: { resizable: true }
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
      { key: "nature", label: game.i18n.localize("TB2E.Ability.Nature"), value: sys.abilities.nature },
      { key: "will", label: game.i18n.localize("TB2E.Ability.Will"), value: sys.abilities.will },
      { key: "health", label: game.i18n.localize("TB2E.Ability.Health"), value: sys.abilities.health }
    ];

    // Town abilities
    context.townAbilities = [
      { key: "resources", label: game.i18n.localize("TB2E.Ability.Resources"), value: sys.abilities.resources },
      { key: "circles", label: game.i18n.localize("TB2E.Ability.Circles"), value: sys.abilities.circles },
      { key: "precedence", label: game.i18n.localize("TB2E.Ability.Precedence"), value: sys.abilities.precedence }
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

    // Traits with level pips
    context.traits = sys.traits.map((t, i) => ({
      ...t,
      idx: i,
      levels: [1, 2, 3].map(l => ({ value: l, active: l === t.level }))
    }));
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
    const index = Number(target.dataset.index);
    const level = Number(target.dataset.level);
    this.document.update({ [`system.traits.${index}.level`]: level });
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
}
