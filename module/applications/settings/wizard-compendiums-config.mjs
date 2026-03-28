import { DEFAULT_PACKS, PACK_GROUPS, PACK_LABELS } from "../../data/actor/chargen.mjs";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

/**
 * Settings form that lets the GM choose which compendium packs the character creation wizard uses.
 */
export default class WizardCompendiumsConfig extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "wizard-compendiums-config",
    tag: "form",
    window: {
      title: "TB2E.Settings.WizardCompendiums.Name",
      contentClasses: ["standard-form"]
    },
    form: {
      closeOnSubmit: true,
      handler: WizardCompendiumsConfig.#onSubmit
    },
    position: { width: 480 },
    actions: {
      reset: WizardCompendiumsConfig.#onReset
    }
  };

  /** @override */
  static PARTS = {
    form: {
      template: "systems/tb2e/templates/settings/wizard-compendiums.hbs",
      scrollable: [""]
    },
    footer: {
      template: "templates/generic/form-footer.hbs"
    }
  };

  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const overrides = game.settings.get("tb2e", "wizardCompendiums");
    const current = { ...DEFAULT_PACKS, ...overrides };

    // Build the list of all available Item-type packs.
    const availablePacks = [];
    for ( const pack of game.packs ) {
      if ( pack.metadata.type !== "Item" ) continue;
      availablePacks.push({ collection: pack.collection, label: pack.metadata.label });
    }
    availablePacks.sort((a, b) => a.label.localeCompare(b.label));

    // Build grouped fields for the template.
    const groups = PACK_GROUPS.map(group => ({
      label: group.label,
      fields: group.keys.map(key => ({
        key,
        label: PACK_LABELS[key],
        value: current[key],
        default: DEFAULT_PACKS[key],
        choices: availablePacks
      }))
    }));

    return {
      groups,
      buttons: [
        { type: "reset", label: "TB2E.Settings.WizardCompendiums.ResetDefaults", icon: "fa-solid fa-arrow-rotate-left", action: "reset" },
        { type: "submit", label: "SETTINGS.Save", icon: "fa-solid fa-floppy-disk" }
      ]
    };
  }

  /* -------------------------------------------- */

  /**
   * Handle form submission — save only the overridden (non-default) values.
   * @param {SubmitEvent} event
   * @param {HTMLFormElement} form
   * @param {FormDataExtended} formData
   */
  static async #onSubmit(event, form, formData) {
    const data = formData.object;
    const overrides = {};
    for ( const [key, defaultPack] of Object.entries(DEFAULT_PACKS) ) {
      const value = data[key];
      if ( value && value !== defaultPack ) overrides[key] = value;
    }
    await game.settings.set("tb2e", "wizardCompendiums", overrides);
  }

  /* -------------------------------------------- */

  /** Reset all packs to defaults. */
  static async #onReset() {
    await game.settings.set("tb2e", "wizardCompendiums", {});
    this.render();
  }
}
