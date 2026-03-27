const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

export default class SpellSheet extends HandlebarsApplicationMixin(ItemSheetV2) {

  static DEFAULT_OPTIONS = {
    classes: ["tb2e", "sheet", "item", "spell-sheet"],
    position: { width: 520, height: 560 },
    actions: {
      addFactorGroup: SpellSheet.#onAddFactorGroup,
      removeFactorGroup: SpellSheet.#onRemoveFactorGroup,
      addFactorOption: SpellSheet.#onAddFactorOption,
      removeFactorOption: SpellSheet.#onRemoveFactorOption,
      addQuality: SpellSheet.#onAddQuality,
      removeQuality: SpellSheet.#onRemoveQuality
    },
    form: { submitOnChange: true },
    window: { resizable: true, minimizable: true }
  };

  static PARTS = {
    body: {
      template: "systems/tb2e/templates/items/spell-sheet.hbs",
      scrollable: [".spell-sheet-form"]
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

    // Circle options
    context.circleOptions = Object.entries(CONFIG.TB2E.spellCircles).map(([key, cfg]) => ({
      key,
      label: game.i18n.localize(cfg.label),
      selected: Number(key) === item.system.circle
    }));

    // Casting type options
    context.castingTypeOptions = Object.entries(CONFIG.TB2E.castingTypes).map(([key, cfg]) => ({
      key,
      label: game.i18n.localize(cfg.label),
      selected: key === item.system.castingType
    }));

    // Casting time options
    context.castingTimeOptions = Object.entries(CONFIG.TB2E.castingTimes).map(([key, cfg]) => ({
      key,
      label: game.i18n.localize(cfg.label),
      selected: key === item.system.castingTime
    }));

    // Versus defense options
    context.versusDefenseOptions = [
      { key: "will", label: game.i18n.localize("TB2E.Spell.VersusWill"), selected: item.system.versusDefense === "will" },
      { key: "nature", label: game.i18n.localize("TB2E.Spell.VersusNature"), selected: item.system.versusDefense === "nature" },
      { key: "willOrNature", label: game.i18n.localize("TB2E.Spell.VersusWillOrNature"), selected: item.system.versusDefense === "willOrNature" }
    ];

    // Type booleans for template conditionals
    context.isFixed = item.system.castingType === "fixed";
    context.isFactors = item.system.castingType === "factors";
    context.isVersus = item.system.castingType === "versus";
    context.isSkillSwap = item.system.castingType === "skillSwap";
    context.showObstacle = context.isFixed || context.isVersus;

    // Factor groups with indices for editing
    context.factors = (item.system.factors || []).map((group, gi) => ({
      ...group,
      groupIndex: gi,
      options: (group.options || []).map((opt, oi) => ({
        ...opt,
        optionIndex: oi,
        groupIndex: gi
      }))
    }));

    // Conflict bonus actions for skill-swap spells
    if ( context.isSkillSwap ) {
      // Skill options for swap skill
      context.skillOptions = Object.entries(CONFIG.TB2E.skills).map(([key, cfg]) => ({
        key,
        label: game.i18n.localize(cfg.label),
        selected: key === item.system.swapSkill
      }));

      // Conflict type options for checkboxes
      context.conflictTypeOptions = Object.entries(CONFIG.TB2E.conflictTypes).map(([key, cfg]) => ({
        key,
        label: game.i18n.localize(cfg.label),
        checked: (item.system.swapConflictTypes || []).includes(key)
      }));

      context.conflictActions = ["attack", "defend", "feint", "maneuver"].map(action => ({
        action,
        label: game.i18n.localize(CONFIG.TB2E.conflictActions[action]?.label || action),
        type: item.system.conflictBonuses[action].type,
        value: item.system.conflictBonuses[action].value
      }));

      context.qualities = (item.system.conflictQualities || []).map((q, i) => ({
        ...q,
        index: i
      }));
    }

    return context;
  }

  /* -------------------------------------------- */
  /*  Render                                      */
  /* -------------------------------------------- */

  _onRender(context, options) {
    super._onRender(context, options);

    // Conflict type checkboxes (multi-select via array)
    for ( const cb of this.element.querySelectorAll(".swap-conflict-type") ) {
      cb.addEventListener("change", () => {
        const checked = [];
        for ( const el of this.element.querySelectorAll(".swap-conflict-type:checked") ) {
          checked.push(el.value);
        }
        this.document.update({ "system.swapConflictTypes": checked });
      });
    }
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  static #onAddFactorGroup(event, target) {
    const current = foundry.utils.deepClone(this.document.system.factors || []);
    current.push({ name: "", options: [{ label: "", value: 0 }] });
    this.document.update({ "system.factors": current });
  }

  static #onRemoveFactorGroup(event, target) {
    const index = Number(target.dataset.groupIndex);
    const current = foundry.utils.deepClone(this.document.system.factors || []);
    current.splice(index, 1);
    this.document.update({ "system.factors": current });
  }

  static #onAddFactorOption(event, target) {
    const gi = Number(target.dataset.groupIndex);
    const current = foundry.utils.deepClone(this.document.system.factors || []);
    if ( !current[gi] ) return;
    current[gi].options.push({ label: "", value: 0 });
    this.document.update({ "system.factors": current });
  }

  static #onRemoveFactorOption(event, target) {
    const gi = Number(target.dataset.groupIndex);
    const oi = Number(target.dataset.optionIndex);
    const current = foundry.utils.deepClone(this.document.system.factors || []);
    if ( !current[gi] ) return;
    current[gi].options.splice(oi, 1);
    this.document.update({ "system.factors": current });
  }

  static #onAddQuality(event, target) {
    const current = foundry.utils.deepClone(this.document.system.conflictQualities || []);
    current.push({ name: "", description: "" });
    this.document.update({ "system.conflictQualities": current });
  }

  static #onRemoveQuality(event, target) {
    const index = Number(target.dataset.index);
    const current = foundry.utils.deepClone(this.document.system.conflictQualities || []);
    current.splice(index, 1);
    this.document.update({ "system.conflictQualities": current });
  }
}
