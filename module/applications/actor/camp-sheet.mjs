const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

/**
 * Minimal ActorSheetV2 for camp-type actors — follows the npc-sheet layout
 * convention: a small header (portrait + name) and a scrollable body with
 * fieldset sections for type, amenities, disasters, visits, and notes.
 *
 * Session state for the active camp visit lives in `tb2e.campState`
 * (edited from the Camp Panel, not this sheet). This sheet shows state
 * that *persists across visits*.
 */
export default class CampSheet extends HandlebarsApplicationMixin(ActorSheetV2) {

  static DEFAULT_OPTIONS = {
    classes: ["tb2e", "sheet", "actor", "camp"],
    position: { width: 520, height: 620 },
    actions: {
      resetDisasters: CampSheet.#onResetDisasters,
      toggleAmenity:  CampSheet.#onToggleAmenity,
      removeVisit:    CampSheet.#onRemoveVisit
    },
    form: { submitOnChange: true },
    window: { resizable: true, minimizable: true }
  };

  static PARTS = {
    header: {
      template: "systems/tb2e/templates/actors/camp-header.hbs"
    },
    body: {
      template: "systems/tb2e/templates/actors/camp-body.hbs",
      scrollable: [""]
    }
  };

  /* -------------------------------------------- */
  /*  Context                                      */
  /* -------------------------------------------- */

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.document;
    const system = actor.system;

    context.actor = actor;
    context.system = system;
    context.isGM = game.user.isGM;

    const CampData = CONFIG.Actor.dataModels.camp;
    context.typeOptions = CampData.CAMP_TYPES.map(t => ({
      key: t,
      label: game.i18n.localize(`TB2E.Camp.Type.${t}`),
      selected: system.type === t
    }));

    context.dangerOptions = CampData.DANGER_LEVELS.map(d => ({
      key: d,
      label: game.i18n.localize(`TB2E.Camp.Danger.${d}`),
      selected: system.defaultDanger === d
    }));

    context.typeLabel = game.i18n.localize(`TB2E.Camp.Type.${system.type}`);

    // Visit history, newest first, with a readable date. Resolve the
    // stored `disasterKey` (which is a TableResult uuid from the
    // camp-events compendium) to the result's human-readable name.
    const rawVisits = [...(system.visits ?? [])].sort((a, b) => b.ts - a.ts);
    context.visits = await Promise.all(rawVisits.map(async (v, idx) => {
      let disasterLabel = "";
      if ( v.disasterKey ) {
        try {
          const doc = await fromUuid(v.disasterKey);
          disasterLabel = doc?.name || doc?.text || "";
        } catch ( _err ) { /* stale uuid — leave blank */ }
      }
      return {
        idx,
        outcome: v.outcome,
        outcomeLabel: game.i18n.localize(`TB2E.Camp.Sheet.VisitOutcome.${v.outcome}`),
        disasterLabel,
        notes: v.notes,
        when: v.ts ? new Date(v.ts).toLocaleDateString() : ""
      };
    }));

    return context;
  }

  /* -------------------------------------------- */
  /*  Actions                                      */
  /* -------------------------------------------- */

  static async #onResetDisasters(event, target) {
    if ( !game.user.isGM ) return;
    await this.document.update({ "system.disastersThisAdventure": 0 });
  }

  static async #onToggleAmenity(event, target) {
    if ( !game.user.isGM ) return;
    const key = target.dataset.amenity;
    if ( !key ) return;
    const current = this.document.system.amenities?.[key] ?? false;
    await this.document.update({ [`system.amenities.${key}`]: !current });
  }

  static async #onRemoveVisit(event, target) {
    if ( !game.user.isGM ) return;
    const idx = Number(target.dataset.index);
    const visits = [...(this.document.system.visits ?? [])];
    if ( Number.isInteger(idx) && idx >= 0 && idx < visits.length ) {
      visits.splice(idx, 1);
      await this.document.update({ "system.visits": visits });
    }
  }
}
