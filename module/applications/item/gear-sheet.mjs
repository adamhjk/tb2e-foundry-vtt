const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

export default class GearSheet extends HandlebarsApplicationMixin(ItemSheetV2) {

  static DEFAULT_OPTIONS = {
    classes: ["tb2e", "sheet", "item", "gear-sheet"],
    position: { width: 480, height: 400 },
    actions: {
      addSkillBonus: GearSheet.#onAddSkillBonus,
      removeSkillBonus: GearSheet.#onRemoveSkillBonus
    },
    form: { submitOnChange: true },
    window: { resizable: true }
  };

  static PARTS = {
    body: {
      template: "systems/tb2e/templates/items/gear-sheet.hbs",
      scrollable: [""]
    }
  };

  /* -------------------------------------------- */
  /*  Context                                     */
  /* -------------------------------------------- */

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const item = this.document;
    context.item = item;
    context.system = item.system;
    context.itemType = item.type;

    // Type booleans for template conditionals.
    context.isWeapon = item.type === "weapon";
    context.isArmor = item.type === "armor";
    context.isContainer = item.type === "container";
    context.isGear = item.type === "gear";
    context.isSupply = item.type === "supply";

    // Config enums for selects.
    if ( context.isArmor ) {
      context.armorTypeOptions = this.#buildOptions(CONFIG.TB2E.armorTypes, item.system.armorType);
    }
    if ( context.isContainer ) {
      context.containerTypeOptions = this.#buildOptions(CONFIG.TB2E.containerTypes, item.system.containerType);
    }
    if ( context.isSupply ) {
      context.supplyTypeOptions = this.#buildOptions(CONFIG.TB2E.supplyTypes, item.system.supplyType);
    }
    if ( context.isWeapon ) {
      context.wieldOptions = this.#buildOptions(CONFIG.TB2E.wieldTypes, String(item.system.wield));
    }

    // Skill options for bonuses.
    if ( context.isGear || context.isSupply ) {
      context.skillOptions = Object.entries(CONFIG.TB2E.skills).map(([key, cfg]) => ({
        key,
        label: game.i18n.localize(cfg.label)
      }));
      context.skillBonuses = (item.system.skillBonuses || []).map((b, i) => ({
        ...b,
        index: i,
        skillLabel: CONFIG.TB2E.skills[b.skill]?.label
          ? game.i18n.localize(CONFIG.TB2E.skills[b.skill].label) : b.skill
      }));
    }

    // Conflict bonus actions for weapons.
    if ( context.isWeapon ) {
      context.conflictActions = ["attack", "defend", "feint", "maneuver"].map(action => ({
        action,
        label: game.i18n.localize(CONFIG.TB2E.conflictActions[action]?.label || action),
        type: item.system.conflictBonuses[action].type,
        value: item.system.conflictBonuses[action].value
      }));
    }

    return context;
  }

  /**
   * Build select option arrays from a config enum.
   */
  #buildOptions(enumObj, currentValue) {
    return Object.entries(enumObj).map(([key, cfg]) => ({
      key,
      label: game.i18n.localize(cfg.label),
      selected: key === currentValue
    }));
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  static #onAddSkillBonus(event, target) {
    const current = foundry.utils.deepClone(this.document.system.skillBonuses || []);
    current.push({ skill: "", value: 1, condition: "" });
    this.document.update({ "system.skillBonuses": current });
  }

  static #onRemoveSkillBonus(event, target) {
    const index = Number(target.dataset.index);
    const current = foundry.utils.deepClone(this.document.system.skillBonuses || []);
    current.splice(index, 1);
    this.document.update({ "system.skillBonuses": current });
  }
}
