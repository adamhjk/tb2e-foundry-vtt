import { SLOT_OPTION_KEYS, formatSlotOptions } from "../../data/item/_fields.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

export default class GearSheet extends HandlebarsApplicationMixin(ItemSheetV2) {

  static DEFAULT_OPTIONS = {
    classes: ["tb2e", "sheet", "item", "gear-sheet"],
    position: { width: 480, height: 400 },
    actions: {
      addSkillBonus: GearSheet.#onAddSkillBonus,
      removeSkillBonus: GearSheet.#onRemoveSkillBonus,
      addLinkedInvocation: GearSheet.#onAddLinkedInvocation,
      removeLinkedInvocation: GearSheet.#onRemoveLinkedInvocation
    },
    form: { submitOnChange: true },
    window: { resizable: true }
  };

  static PARTS = {
    body: {
      template: "systems/tb2e/templates/items/gear-sheet.hbs",
      scrollable: [".gear-sheet-form"]
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
    context.isRelic = item.type === "relic";

    // Slot options editor for all item types.
    const slotLabels = {
      head: "TB2E.SlotOption.Head", neck: "TB2E.SlotOption.Neck", wornHand: "TB2E.SlotOption.WornHand",
      carried: "TB2E.SlotOption.Carried", torso: "TB2E.SlotOption.Torso", belt: "TB2E.SlotOption.Belt",
      feet: "TB2E.SlotOption.Feet", pack: "TB2E.SlotOption.Pack", pocket: "TB2E.SlotOption.Pocket",
      quiver: "TB2E.SlotOption.Quiver", pouch: "TB2E.SlotOption.Pouch"
    };
    context.slotOptionFields = SLOT_OPTION_KEYS.map(key => ({
      key,
      label: game.i18n.localize(slotLabels[key]),
      value: item.system.slotOptions[key] ?? 1,
      enabled: item.system.slotOptions[key] != null
    }));
    context.slotOptionsNotation = formatSlotOptions(item.system.slotOptions);

    // Config enums for selects.
    if ( context.isArmor ) {
      context.armorTypeOptions = this.#buildOptions(CONFIG.TB2E.armorTypes, item.system.armorType);
    }
    if ( context.isContainer ) {
      context.containerTypeOptions = this.#buildOptions(CONFIG.TB2E.containerTypes, item.system.containerType);
      context.isLiquidContainer = !!CONFIG.TB2E.containerTypes[item.system.containerType]?.liquid;
      if ( context.isLiquidContainer ) {
        context.liquidTypeOptions = this.#buildOptions(CONFIG.TB2E.liquidTypes, item.system.liquidType);
      }
    }
    if ( context.isSupply ) {
      context.supplyTypeOptions = this.#buildOptions(CONFIG.TB2E.supplyTypes, item.system.supplyType);
    }
    if ( context.isWeapon ) {
      context.wieldOptions = this.#buildOptions(CONFIG.TB2E.wieldTypes, String(item.system.wield));
    }

    // Relic fields
    if ( context.isRelic ) {
      context.relicTierOptions = this.#buildOptions(CONFIG.TB2E.relicTiers, item.system.relicTier);
      context.circleOptions = [1, 2, 3, 4].map(n => ({
        key: String(n),
        label: game.i18n.localize(CONFIG.TB2E.invocationCircles[n]?.label),
        selected: item.system.linkedCircle === n
      }));
      context.linkedInvocations = (item.system.linkedInvocations || []).map((name, i) => ({
        name, index: i
      }));
      context.isGreatRelic = item.system.relicTier === "great";
    }

    // Skill/ability options for bonuses (gear, supply, and weapon items).
    if ( context.isGear || context.isSupply || context.isWeapon ) {
      const abilityEntries = Object.entries(CONFIG.TB2E.abilities)
        .filter(([, cfg]) => cfg.group === "raw")
        .map(([key, cfg]) => ({ key, label: game.i18n.localize(cfg.label) }));
      const skillEntries = Object.entries(CONFIG.TB2E.skills)
        .map(([key, cfg]) => ({ key, label: game.i18n.localize(cfg.label) }));
      context.skillOptions = [...abilityEntries, ...skillEntries];

      const allLabels = { ...CONFIG.TB2E.abilities, ...CONFIG.TB2E.skills };
      context.skillBonuses = (item.system.skillBonuses || []).map((b, i) => ({
        ...b,
        index: i,
        skillLabel: allLabels[b.skill]?.label
          ? game.i18n.localize(allLabels[b.skill].label) : b.skill
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
  /*  Render                                      */
  /* -------------------------------------------- */

  _onRender(context, options) {
    super._onRender(context, options);
    // Toggle the number input disabled state for immediate visual feedback.
    // The actual data update is handled by submitOnChange + _processFormData.
    for ( const cb of this.element.querySelectorAll(".slot-option-toggle") ) {
      cb.addEventListener("change", (ev) => {
        const key = ev.currentTarget.dataset.key;
        const input = this.element.querySelector(`input[name="system.slotOptions.${key}"]`);
        if ( input ) input.disabled = !ev.currentTarget.checked;
      });
    }
  }

  /* -------------------------------------------- */
  /*  Form Data                                   */
  /* -------------------------------------------- */

  /** @override */
  _processFormData(event, form, formData) {
    const submitData = super._processFormData(event, form, formData);
    // Always include all slot options with correct values based on checkbox state.
    // Disabled number inputs are excluded from FormData, so we read the DOM directly.
    if ( !submitData.system ) submitData.system = {};
    if ( !submitData.system.slotOptions ) submitData.system.slotOptions = {};
    for ( const key of SLOT_OPTION_KEYS ) {
      const cb = form.querySelector(`.slot-option-toggle[data-key="${key}"]`);
      if ( cb?.checked ) {
        const input = form.querySelector(`input[name="system.slotOptions.${key}"]`);
        submitData.system.slotOptions[key] = input ? (Number(input.value) || 1) : 1;
      } else {
        submitData.system.slotOptions[key] = null;
      }
    }
    return submitData;
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

  static #onAddLinkedInvocation(event, target) {
    const current = foundry.utils.deepClone(this.document.system.linkedInvocations || []);
    current.push("");
    this.document.update({ "system.linkedInvocations": current });
  }

  static #onRemoveLinkedInvocation(event, target) {
    const index = Number(target.dataset.index);
    const current = foundry.utils.deepClone(this.document.system.linkedInvocations || []);
    current.splice(index, 1);
    this.document.update({ "system.linkedInvocations": current });
  }
}
