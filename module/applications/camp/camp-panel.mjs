import * as campState from "../../data/camp/state.mjs";
import CampData from "../../data/actor/camp.mjs";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

/**
 * Floating wizard panel for running the Torchbearer 2E Camp phase
 * (Scholar's Guide pp. 90–96).
 *
 * Mirrors the shape of `ConflictPanel`: a tabbed wizard with a header bar,
 * state-icon tab strip (`✓` / `▶` / `○`), scrollable content area, and
 * roster strip. Phase A ships the shell; each subsequent phase fills in
 * a tab. The panel reads session state from `tb2e.campState` (see
 * `module/data/camp/state.mjs`) and writes via state helpers; all
 * mutation goes through the GM-only helpers so players can't desync the
 * panel by tampering with the setting.
 *
 * Singleton — access via CampPanel.getInstance().
 */
export default class CampPanel extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @type {string} Currently active tab (what the user is looking at).
   *  Not the same as `campState.phase` (where the GM is in the procedure —
   *  that drives the completed/current/upcoming tab-state icons). */
  #activeTab = "site";

  /** @type {Object<string, number>} Hook IDs for cleanup. */
  #hookIds = {};

  static DEFAULT_OPTIONS = {
    id: "camp-panel",
    classes: ["tb2e", "camp-panel"],
    position: { width: 572, height: 682 },
    window: {
      title: "TB2E.CampPanel.Title",
      resizable: true,
      minimizable: true
    },
    actions: {
      switchTab:        CampPanel.#onSwitchTab,
      selectCamp:       CampPanel.#onSelectCamp,
      createNewCamp:    CampPanel.#onCreateNewCamp,
      openCampSheet:    CampPanel.#onOpenCampSheet,
      advanceTo:        CampPanel.#onAdvanceTo,
      setDanger:        CampPanel.#onSetDanger,
      toggleSurvey:     CampPanel.#onToggleSurvey,
      setFire:          CampPanel.#onSetFire,
      toggleWatcher:    CampPanel.#onToggleWatcher,
      adjustGmSit:      CampPanel.#onAdjustGmSit,
      rollEvents:       CampPanel.#onRollEvents,
      markAvert:        CampPanel.#onMarkAvert,
      rollAvertTest:    CampPanel.#onRollAvertTest,
      toggleUnavertable: CampPanel.#onToggleUnavertable,
      spendCheck:       CampPanel.#onSpendCheck,
      recordMemorize:   CampPanel.#onRecordMemorize,
      recordPurify:     CampPanel.#onRecordPurify,
      shareCheck:       CampPanel.#onShareCheck,
      useInstinct:      CampPanel.#onUseInstinct,
      endCamp:          CampPanel.#onEndCamp,
      cancelCamp:       CampPanel.#onCancelCamp
    }
  };

  static PARTS = {
    panel: {
      template: "systems/tb2e/templates/camp/panel.hbs",
      scrollable: [".panel-content"]
    }
  };

  static PARTIALS = [
    "systems/tb2e/templates/camp/panel-site.hbs",
    "systems/tb2e/templates/camp/panel-setup.hbs",
    "systems/tb2e/templates/camp/panel-decisions.hbs",
    "systems/tb2e/templates/camp/panel-events.hbs",
    "systems/tb2e/templates/camp/panel-strategy.hbs",
    "systems/tb2e/templates/camp/panel-break.hbs",
    "systems/tb2e/templates/camp/panel-roster.hbs"
  ];

  static {
    Hooks.once("init", () => {
      foundry.applications.handlebars.loadTemplates(CampPanel.PARTIALS);
    });
  }

  /* -------------------------------------------- */
  /*  Singleton Pattern                            */
  /* -------------------------------------------- */

  static getInstance() {
    return game.tb2e.campPanel ??= new CampPanel();
  }

  /* -------------------------------------------- */
  /*  Tab machinery                                */
  /* -------------------------------------------- */

  static TAB_DEFS = [
    { id: "site",      labelKey: "TB2E.Camp.Tabs.Site",      icon: "fa-solid fa-map-location-dot" },
    { id: "setup",     labelKey: "TB2E.Camp.Tabs.Setup",     icon: "fa-solid fa-campground" },
    { id: "decisions", labelKey: "TB2E.Camp.Tabs.Decisions", icon: "fa-solid fa-person-hiking" },
    { id: "events",    labelKey: "TB2E.Camp.Tabs.Events",    icon: "fa-solid fa-dice-d6" },
    { id: "strategy",  labelKey: "TB2E.Camp.Tabs.Strategy",  icon: "fa-solid fa-clipboard-list" },
    { id: "break",     labelKey: "TB2E.Camp.Tabs.Break",     icon: "fa-solid fa-sun" }
  ];

  /* -------------------------------------------- */
  /*  Lifecycle                                    */
  /* -------------------------------------------- */

  /** @override */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);

    this.#hookIds.updateSetting = Hooks.on("updateSetting", (setting) => {
      if ( setting.key === "tb2e.campState" ) {
        // `_prepareContext` pulls activeTab forward when phase advances;
        // we just need to trigger a re-render.
        this.render();
      }
    });
    this.#hookIds.updateActor = Hooks.on("updateActor", () => this.render());
    this.#hookIds.createActor = Hooks.on("createActor", () => this.render());
    this.#hookIds.deleteActor = Hooks.on("deleteActor", () => this.render());

    // Auto-select a camp actor that's already on the current scene — if
    // the GM has a camp pinned on the map, opening the panel should jump
    // straight to Setup with that camp selected (per user request). Skip
    // when a session is already underway (don't override the GM's choice).
    if ( game.user.isGM ) {
      const state = campState.getCampState();
      if ( !state.active ) {
        const sceneCamp = campState.getSceneCampActor();
        if ( sceneCamp ) await campState.beginCamp(sceneCamp.id);
      }
    }
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
    // Share-check dropdown — fires on change, then resets to the empty
    // option so the same pair can share again without reloading.
    for ( const select of this.element.querySelectorAll(".camp-strategy-share-select") ) {
      select.addEventListener("change", async (ev) => {
        const fromId = ev.target.dataset.actorId;
        const toId = ev.target.value;
        if ( !fromId || !toId ) return;
        if ( !game.user.isGM ) return;
        const giver = game.actors.get(fromId);
        const receiver = game.actors.get(toId);
        if ( !giver || !receiver ) return;
        if ( (giver.system.checks ?? 0) <= 0 ) return;
        await giver.update({ "system.checks": giver.system.checks - 1 });
        await receiver.update({ "system.checks": (receiver.system.checks ?? 0) + 1 });
        await campState.recordTest({
          actorId: fromId,
          kind: "share",
          toActorId: toId,
          detail: ""
        });
        ev.target.value = "";
      });
    }
  }

  /** @override */
  async _onClose(options) {
    for ( const [name, id] of Object.entries(this.#hookIds) ) {
      if ( id != null ) Hooks.off(name === "updateSetting" ? "updateSetting" : name, id);
    }
    this.#hookIds = {};
    await super._onClose(options);
  }

  /* -------------------------------------------- */
  /*  Context                                      */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const state = campState.getCampState();
    const campActor = campState.getCampActor(state);

    const phaseIdx = CampPanel.TAB_DEFS.findIndex(t => t.id === state.phase);
    let activeIdx = CampPanel.TAB_DEFS.findIndex(t => t.id === this.#activeTab);
    // If the session phase has advanced past where the user is looking
    // (e.g. `beginCamp` moved phase to "setup" while `#activeTab` is still
    // the default "site"), pull the active tab forward so the GM sees the
    // current step on open. User clicks always set activeTab ≥ phase, so
    // this never yanks the tab backward.
    if ( phaseIdx > activeIdx ) {
      this.#activeTab = state.phase;
      activeIdx = phaseIdx;
    }

    const tabs = CampPanel.TAB_DEFS.map((t, i) => ({
      id: t.id,
      label: game.i18n.localize(t.labelKey),
      icon: t.icon,
      isActive: i === activeIdx,
      state: i < phaseIdx ? "completed" : (i === phaseIdx ? "current" : "upcoming")
    }));

    // Existing camps for the Site tab list.
    const existingCamps = game.actors
      .filter(a => a.type === "camp")
      .map(a => ({
        id: a.id,
        name: a.name,
        img: a.img,
        typeLabel: game.i18n.localize(`TB2E.Camp.Type.${a.system.type}`),
        dangerLabel: game.i18n.localize(`TB2E.Camp.Danger.${a.system.defaultDanger}`),
        amenitiesSummary: this.#summarizeAmenities(a),
        disasters: a.system.disastersThisAdventure,
        visits: a.system.visits.length,
        selected: a.id === state.campActorId
      }));

    // Camp-type options for the "new camp" dialog (and setup).
    const campTypeOptions = CampData.CAMP_TYPES.map(t => ({
      key: t,
      label: game.i18n.localize(`TB2E.Camp.Type.${t}`)
    }));
    const dangerOptions = CampData.DANGER_LEVELS.map(d => ({
      key: d,
      label: game.i18n.localize(`TB2E.Camp.Danger.${d}`)
    }));

    // Party check pool (SG p. 90 — ≥1 check required to make camp).
    // Scene-party only: characters whose tokens are on the current scene
    // and whose conflict team is "party".
    const watcherSet = new Set(state.watchers ?? []);
    const memorizedSet = new Set(state.memorizedBy ?? []);
    const purifiedSet = new Set(state.purifiedBy ?? []);
    const characters = campState.getPartyActors();
    const partyChecks = characters.map(pc => {
      const checks = pc.system.checks ?? 0;
      const isWatcher = watcherSet.has(pc.id);
      const isExhausted = !!pc.system.conditions?.exhausted;
      const conditionBadges = [];
      if ( pc.system.conditions?.hungry )    conditionBadges.push("H&T");
      if ( pc.system.conditions?.exhausted ) conditionBadges.push("Exh");
      if ( pc.system.conditions?.angry )     conditionBadges.push("Ang");
      if ( pc.system.conditions?.afraid )    conditionBadges.push("Afr");
      if ( pc.system.conditions?.injured )   conditionBadges.push("Inj");
      if ( pc.system.conditions?.sick )      conditionBadges.push("Sick");
      return {
        id: pc.id,
        name: pc.name,
        img: pc.img,
        checks,
        hasChecks: checks > 0,
        pips: Array.from({ length: checks }, () => ({})),
        isWatcher,
        isExhausted,
        hasMemorized: memorizedSet.has(pc.id),
        hasPurified:  purifiedSet.has(pc.id),
        canRecover:   !isWatcher && checks > 0,
        canMemorize:  !isWatcher && !memorizedSet.has(pc.id) && checks > 0,
        canPurify:    !isWatcher && !purifiedSet.has(pc.id) && checks > 0,
        canTest:      checks > 0,
        instinctLabel: isExhausted ? "Instinct (1 ✓)" : "Instinct (free)",
        shareTargets: [],  // filled below
        conditions: conditionBadges
      };
    });
    // Populate share-check targets: every OTHER PC.
    for ( const pc of partyChecks ) {
      pc.shareTargets = partyChecks.filter(p => p.id !== pc.id).map(p => ({ id: p.id, name: p.name }));
    }
    const partyCheckTotal = partyChecks.reduce((sum, pc) => sum + pc.checks, 0);
    const canBeginDecisions = partyCheckTotal >= 1;

    // Flatten the camp actor to plain data so Handlebars doesn't fight with
    // the Actor document Proxy (which has been observed to evaluate as
    // falsy in some `{{#unless}}` paths).
    const campActorView = campActor ? {
      id: campActor.id,
      name: campActor.name,
      img: campActor.img,
      system: foundry.utils.duplicate(campActor.system)
    } : null;
    const campTypeLabel = campActor
      ? game.i18n.localize(`TB2E.Camp.Type.${campActor.system.type}`) : "";
    const dangerLabel = state.danger
      ? game.i18n.localize(`TB2E.Camp.Danger.${state.danger}`) : "";

    // Camp log — resolve each entry's actor names and a localized kind
    // label, so the Strategy tab can render "Test: Thrar" instead of just
    // "test" or "Share: Thrar → Grima" instead of a raw detail string.
    const kindLabels = {
      test:     game.i18n.localize("TB2E.Camp.Strategy.LogKind.test"),
      recover:  game.i18n.localize("TB2E.Camp.Strategy.LogKind.recover"),
      memorize: game.i18n.localize("TB2E.Camp.Strategy.LogKind.memorize"),
      purify:   game.i18n.localize("TB2E.Camp.Strategy.LogKind.purify"),
      instinct: game.i18n.localize("TB2E.Camp.Strategy.LogKind.instinct"),
      share:    game.i18n.localize("TB2E.Camp.Strategy.LogKind.share"),
      avert:    game.i18n.localize("TB2E.Camp.Strategy.LogKind.avert")
    };
    const logEntries = (state.log ?? []).map(entry => {
      const actor = entry.actorId ? game.actors.get(entry.actorId) : null;
      const toActor = entry.toActorId ? game.actors.get(entry.toActorId) : null;
      return {
        ...entry,
        kindLabel: kindLabels[entry.kind] ?? entry.kind,
        actorName: actor?.name ?? "?",
        toName:    toActor?.name ?? null
      };
    });

    // Events tab — resolve the drawn TableResult (terminal, for display
    // name) AND the top-level row (for disaster flags + avert config).
    // Subtable draws (e.g. "Curiosity" → "Owlbear") have distinct
    // terminal and top-level uuids; flat draws (e.g. Safe camp) share.
    let eventsResult = null;
    if ( state.events.resultUuid ) {
      try {
        const terminalDoc = await fromUuid(state.events.resultUuid);
        const topDoc = state.events.topResultUuid
          && state.events.topResultUuid !== state.events.resultUuid
          ? await fromUuid(state.events.topResultUuid)
          : terminalDoc;
        if ( terminalDoc ) {
          const topFlags = topDoc?.flags?.tb2e?.campEvents ?? {};
          eventsResult = {
            uuid: terminalDoc.uuid,
            name: terminalDoc.name || terminalDoc.text || "",
            isDisaster:    !!state.events.isDisaster    || !!topFlags.isDisaster,
            isUnavertable: !!state.events.isUnavertable || !!topFlags.isUnavertable,
            avert: topFlags.avert ?? null
          };
        }
      } catch ( _err ) { eventsResult = null; }
    }

    const modifier = campActor
      ? campState.computeEventsModifier(state, campActor, characters)
      : { breakdown: [], net: 0 };

    // Watcher detail list for avert buttons.
    const watcherDetails = (state.watchers ?? [])
      .map(id => game.actors.get(id))
      .filter(a => a)
      .map(a => ({ id: a.id, name: a.name, img: a.img }));

    return {
      isGM: game.user.isGM,
      activeTab: this.#activeTab,
      tabs,
      campState: state,
      campActor: campActorView,
      hasCampActor: !!campActorView,
      campTypeLabel,
      dangerLabel,
      existingCamps,
      campTypeOptions,
      dangerOptions,
      partyChecks,
      partyCheckTotal,
      canBeginDecisions,
      eventsResult,
      eventsModifier: modifier,
      watcherDetails,
      logEntries,
      isSiteTab:      this.#activeTab === "site",
      isSetupTab:     this.#activeTab === "setup",
      isDecisionsTab: this.#activeTab === "decisions",
      isEventsTab:    this.#activeTab === "events",
      isStrategyTab:  this.#activeTab === "strategy",
      isBreakTab:     this.#activeTab === "break"
    };
  }

  #summarizeAmenities(actor) {
    const parts = [];
    if ( actor.system.amenities.shelter )     parts.push(game.i18n.localize("TB2E.Camp.Amenity.shelter"));
    if ( actor.system.amenities.concealment ) parts.push(game.i18n.localize("TB2E.Camp.Amenity.concealment"));
    if ( actor.system.amenities.water )       parts.push(game.i18n.localize("TB2E.Camp.Amenity.water"));
    return parts.length ? parts.join(", ") : game.i18n.localize("TB2E.Camp.Panel.NoAmenities");
  }

  /* -------------------------------------------- */
  /*  Actions                                      */
  /* -------------------------------------------- */

  static #onSwitchTab(event, target) {
    const tabId = target.dataset.tab;
    if ( !tabId ) return;
    this.#activeTab = tabId;
    this.render();
  }

  static async #onSelectCamp(event, target) {
    if ( !game.user.isGM ) return;
    const id = target.dataset.campId;
    if ( !id ) return;
    await campState.beginCamp(id);
    // Update will trigger re-render via updateSetting hook.
  }

  static async #onOpenCampSheet(event, target) {
    const id = target.dataset.campId ?? campState.getCampState().campActorId;
    if ( !id ) return;
    const actor = game.actors.get(id);
    await actor?.sheet?.render({ force: true });
  }

  /**
   * Create a new camp site from the inline form in the Site tab. Reads the
   * name / type / default-danger selects/inputs, creates the actor, and
   * selects it. Form values are posted via a native submit — we intercept
   * in `_onRender` and dispatch here via a plain click action on the
   * submit button.
   */
  static async #onCreateNewCamp(event, target) {
    if ( !game.user.isGM ) return;
    const form = this.element.querySelector("form.camp-new-camp-form");
    if ( !form ) return;
    const fd = new FormData(form);
    const name = (fd.get("name")?.toString() ?? "").trim();
    if ( !name ) {
      form.querySelector("input[name='name']")?.focus();
      return;
    }
    const type = fd.get("type")?.toString() || "wilderness";
    const defaultDanger = fd.get("defaultDanger")?.toString() || "typical";
    await campState.createAndBeginCamp({ name, type, defaultDanger });
  }

  static async #onAdvanceTo(event, target) {
    if ( !game.user.isGM ) return;
    const phase = target.dataset.phase;
    if ( !phase ) return;
    this.#activeTab = phase;
    await campState.setPhase(phase);
  }

  static async #onSetDanger(event, target) {
    if ( !game.user.isGM ) return;
    const value = target.value || target.dataset.danger;
    if ( !value ) return;
    await campState.setDanger(value);
  }

  static async #onToggleSurvey(event, target) {
    if ( !game.user.isGM ) return;
    const key = target.dataset.key;
    if ( !key ) return;
    await campState.toggleSurvey(key);
  }

  static async #onSetFire(event, target) {
    if ( !game.user.isGM ) return;
    const value = target.value || target.dataset.fire;
    if ( !value ) return;
    await campState.setFire(value);
  }

  static async #onToggleWatcher(event, target) {
    if ( !game.user.isGM ) return;
    const id = target.dataset.actorId;
    if ( !id ) return;
    await campState.toggleWatcher(id);
  }

  static async #onAdjustGmSit(event, target) {
    if ( !game.user.isGM ) return;
    const delta = Number(target.dataset.delta) || 0;
    const state = campState.getCampState();
    await campState.setGmSituational((state.events?.gmSituational ?? 0) + delta);
  }

  static async #onRollEvents(event, target) {
    if ( !game.user.isGM ) return;
    await campState.rollEvents();
  }

  static async #onMarkAvert(event, target) {
    if ( !game.user.isGM ) return;
    const success = target.dataset.success === "true";
    const actorId = target.dataset.actorId || null;
    await campState.markAvertAttempt({ success, actorId });
  }

  static async #onToggleUnavertable(event, target) {
    if ( !game.user.isGM ) return;
    const state = campState.getCampState();
    state.events.isUnavertable = !state.events.isUnavertable;
    await game.settings.set("tb2e", "campState", state);
  }

  /**
   * Open the roll dialog pre-filled with the avert config from the drawn
   * event result (skill/ability + Ob). The player then completes the test
   * normally and reports the outcome via the "Mark averted / failed"
   * buttons. This is available to both GM and watcher players.
   */
  static async #onRollAvertTest(event, target) {
    const actorId = target.dataset.actorId;
    const actor = game.actors.get(actorId);
    if ( !actor ) return;
    const state = campState.getCampState();
    if ( !state.events.resultUuid ) return;
    let resultDoc;
    try { resultDoc = await fromUuid(state.events.resultUuid); }
    catch ( _err ) { return; }
    const avert = resultDoc?.flags?.tb2e?.campEvents?.avert;
    if ( !avert || avert.allowed === false || !avert.skill ) return;
    const { rollTest } = await import("../../dice/tb2e-roll.mjs");
    await rollTest({
      actor,
      type: avert.type || "skill",
      key: avert.skill,
      testContext: { obstacle: avert.ob ?? 4 }
    });
  }

  /**
   * Spend 1 check on a generic test (SG p. 94).
   * GM-side for v1 — player → GM mailbox arrives in Phase L.
   */
  static async #onSpendCheck(event, target) {
    if ( !game.user.isGM ) return;
    const actorId = target.dataset.actorId;
    const purpose = target.dataset.purpose || "test";
    if ( !actorId ) return;
    const pc = game.actors.get(actorId);
    if ( !pc ) return;
    if ( (pc.system.checks ?? 0) <= 0 ) return;
    await pc.update({ "system.checks": pc.system.checks - 1 });
    await campState.recordTest({ actorId, kind: purpose, detail: "" });
  }

  /** Memorize a spell (SG p. 95). Once per camp per actor. */
  static async #onRecordMemorize(event, target) {
    if ( !game.user.isGM ) return;
    const actorId = target.dataset.actorId;
    const pc = game.actors.get(actorId);
    if ( !pc || (pc.system.checks ?? 0) <= 0 ) return;
    const state = campState.getCampState();
    if ( state.memorizedBy?.includes(actorId) ) return;
    await pc.update({ "system.checks": pc.system.checks - 1 });
    await campState.recordTest({ actorId, kind: "memorize", detail: "Memorized a spell" });
  }

  /** Purify Immortal burden (SG p. 95). Once per camp per actor. */
  static async #onRecordPurify(event, target) {
    if ( !game.user.isGM ) return;
    const actorId = target.dataset.actorId;
    const pc = game.actors.get(actorId);
    if ( !pc || (pc.system.checks ?? 0) <= 0 ) return;
    const state = campState.getCampState();
    if ( state.purifiedBy?.includes(actorId) ) return;
    await pc.update({ "system.checks": pc.system.checks - 1 });
    await campState.recordTest({ actorId, kind: "purify", detail: "Purified burden" });
  }

  /**
   * Peer-to-peer check share (DH p. 81). The giver's actor loses 1 check
   * and the receiver's actor gains 1. GM client processes without approval.
   */
  static async #onShareCheck(event, target) {
    if ( !game.user.isGM ) return;
    const fromId = target.dataset.fromActorId;
    const toId = target.dataset.toActorId;
    if ( !fromId || !toId ) return;
    const giver = game.actors.get(fromId);
    const receiver = game.actors.get(toId);
    if ( !giver || !receiver ) return;
    if ( (giver.system.checks ?? 0) <= 0 ) return;
    await giver.update({ "system.checks": giver.system.checks - 1 });
    await receiver.update({ "system.checks": (receiver.system.checks ?? 0) + 1 });
    await campState.recordTest({
      actorId: fromId,
      kind: "share",
      toActorId: toId,
      detail: ""
    });
  }

  /** End the camp visit. Writes back to the camp actor, discards unspent
   *  checks (SG p. 95), resets grindTurn/phase (SG p. 96). */
  static async #onEndCamp(event, target) {
    if ( !game.user.isGM ) return;
    // Read the "Discard unspent checks" toggle from the Break tab. Default
    // (checked) follows SG p. 95; unchecked is the GM-controlled deviation.
    const discardEl = this.element.querySelector("input.camp-break-discard-toggle");
    const discardChecks = discardEl ? !!discardEl.checked : true;
    await campState.endCamp({ discardChecks });
    await this.close();
  }

  /**
   * Reset the panel — clears all session state without writing back to
   * the camp actor (no visit log, no disaster increment, checks not
   * discarded). Use when the GM started a camp by mistake.
   */
  static async #onCancelCamp(event, target) {
    if ( !game.user.isGM ) return;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("TB2E.Camp.Reset.Title") },
      content: `<p>${game.i18n.localize("TB2E.Camp.Reset.Confirm")}</p>`,
      rejectClose: false
    }).catch(() => false);
    if ( !confirmed ) return;
    await campState.cancelCamp();
  }

  /** Use an instinct in camp (SG p. 95). Free unless exhausted. */
  static async #onUseInstinct(event, target) {
    if ( !game.user.isGM ) return;
    const actorId = target.dataset.actorId;
    const pc = game.actors.get(actorId);
    if ( !pc ) return;
    const exhausted = !!pc.system.conditions?.exhausted;
    if ( exhausted ) {
      if ( (pc.system.checks ?? 0) <= 0 ) return;
      await pc.update({ "system.checks": pc.system.checks - 1 });
    }
    await campState.recordTest({
      actorId,
      kind: "instinct",
      detail: exhausted ? "Used instinct (exhausted — 1 ✓)" : "Used instinct (free)"
    });
  }
}
