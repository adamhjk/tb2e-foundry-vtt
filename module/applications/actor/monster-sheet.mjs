import { conditions } from "../../config.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

export default class MonsterSheet extends HandlebarsApplicationMixin(ActorSheetV2) {

  static DEFAULT_OPTIONS = {
    classes: ["tb2e", "sheet", "actor", "monster"],
    position: { width: 600, height: 700 },
    actions: {
      toggleCondition: MonsterSheet.#onToggleCondition,
      toggleTeam: MonsterSheet.#onToggleTeam,
      addWeapon: MonsterSheet.#onAddWeapon,
      deleteWeapon: MonsterSheet.#onDeleteWeapon
    },
    form: { submitOnChange: true },
    window: { resizable: true }
  };

  /* -------------------------------------------- */
  /*  Parts                                       */
  /* -------------------------------------------- */

  static PARTS = {
    header: {
      template: "systems/tb2e/templates/actors/monster-header.hbs"
    },
    conditions: {
      template: "systems/tb2e/templates/actors/monster-conditions.hbs"
    },
    body: {
      template: "systems/tb2e/templates/actors/monster-body.hbs",
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
    // Exclude fresh — monsters are never Fresh.
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

    // Dispositions with visual tier indicators.
    context.dispositions = sys.dispositions.map((d, i) => {
      let tier = "weakness";
      if ( i === 0 ) tier = "strength";
      else if ( i === 1 ) tier = "competency";
      return { ...d, idx: i, tier };
    });

    context.weapons = sys.weapons.map((w, i) => ({ ...w, idx: i }));
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

  static #onAddWeapon(event, target) {
    const current = foundry.utils.deepClone(this.document.system.weapons || []);
    current.push({});
    this.document.update({ "system.weapons": current });
  }

  /* -------------------------------------------- */

  static #onDeleteWeapon(event, target) {
    const index = Number(target.dataset.index);
    const current = foundry.utils.deepClone(this.document.system.weapons || []);
    current.splice(index, 1);
    this.document.update({ "system.weapons": current });
  }
}
