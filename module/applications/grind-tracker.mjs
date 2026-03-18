const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

const GRIND_ORDER = ["hungry", "exhausted", "angry", "sick", "injured", "afraid", "dead"];

const COND_LABELS = {
  hungry: "H&T",
  exhausted: "Exhausted",
  angry: "Angry",
  afraid: "Afraid",
  injured: "Injured",
  sick: "Sick",
  dead: "Dead"
};

/**
 * Persistent GM-only HUD showing adventure turn counter, phase, and per-character status.
 * Singleton — access via GrindTracker.getInstance().
 */
export default class GrindTracker extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @type {Object<string, number>} Hook IDs for cleanup. */
  #hookIds = {};

  static DEFAULT_OPTIONS = {
    id: "grind-tracker",
    classes: ["tb2e", "grind-tracker"],
    position: { width: 820, height: "auto" },
    window: {
      title: "TB2E.GrindTracker.Title",
      resizable: true,
      minimizable: true
    },
    actions: {
      advanceTurn: GrindTracker.#onAdvanceTurn,
      setPhase: GrindTracker.#onSetPhase,
      toggleLight: GrindTracker.#onToggleLight,
      setLightLevel: GrindTracker.#onSetLightLevel
    }
  };

  static PARTS = {
    tracker: {
      template: "systems/tb2e/templates/grind-tracker.hbs"
    }
  };

  /* -------------------------------------------- */
  /*  Singleton Pattern                            */
  /* -------------------------------------------- */

  static getInstance() {
    return game.tb2e.grindTracker ??= new GrindTracker();
  }

  /* -------------------------------------------- */
  /*  Rendering Guard                              */
  /* -------------------------------------------- */

  /** @override */
  _canRender(options) {
    if ( !game.user.isGM ) return false;
  }

  /* -------------------------------------------- */
  /*  Lifecycle                                    */
  /* -------------------------------------------- */

  /** @override */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this.#hookIds.updateActor = Hooks.on("updateActor", () => this.render());
    this.#hookIds.updateItem = Hooks.on("updateItem", () => this.render());
  }

  /** @override */
  async _onClose(options) {
    if ( this.#hookIds.updateActor != null ) Hooks.off("updateActor", this.#hookIds.updateActor);
    if ( this.#hookIds.updateItem != null ) Hooks.off("updateItem", this.#hookIds.updateItem);
    this.#hookIds = {};
    await super._onClose(options);
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);

    // Turn number input: commit on blur or Enter
    const turnInput = this.element.querySelector(".turn-number-input");
    if ( turnInput ) {
      turnInput.addEventListener("change", (e) => this.#setTurn(e.target.value));
      turnInput.addEventListener("keydown", (e) => {
        if ( e.key === "Enter" ) e.target.blur();
      });
    }

    // Extreme toggle checkbox
    const extremeCheckbox = this.element.querySelector(".extreme-checkbox");
    if ( extremeCheckbox ) {
      extremeCheckbox.addEventListener("change", () => this.#toggleExtreme());
    }

    // Covered-by dropdowns
    for ( const select of this.element.querySelectorAll(".covered-by-select") ) {
      select.addEventListener("change", (e) => {
        const actorId = e.target.dataset.coveredByActor;
        const holderId = e.target.value || null;
        this.#setCoveredBy(actorId, holderId);
      });
    }
  }

  /* -------------------------------------------- */
  /*  Context                                      */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const turn = game.settings.get("tb2e", "grindTurn");
    const phase = game.settings.get("tb2e", "grindPhase");
    const extreme = game.settings.get("tb2e", "grindExtreme");
    const maxTurns = extreme ? 3 : 4;
    const cyclePos = ((turn - 1) % maxTurns) + 1;
    const isGrindTurn = cyclePos === maxTurns;

    const pips = Array.from({ length: maxTurns }, (_, i) => ({ filled: i < cyclePos }));

    const phaseLabels = { adventure: "Adventure", camp: "Camp", town: "Town" };
    const phaseLabel = phaseLabels[phase] ?? phase;

    const characters = this.#prepareCharacters(isGrindTurn);

    return {
      turn,
      phase,
      phaseLabel,
      extreme,
      maxTurns,
      cyclePos,
      isGrindTurn,
      pips,
      characters,
      isAdventurePhase: phase === "adventure"
    };
  }

  /**
   * Gather per-character display data for all player-owned characters.
   * @param {boolean} isGrindTurn - Whether the current turn is a grind turn.
   * @returns {object[]}
   */
  #prepareCharacters(isGrindTurn) {
    const playerActors = game.actors.filter(a => a.type === "character");

    return playerActors.map(actor => {
      const conds = actor.system.conditions;

      // Active condition labels for display
      const activeConditions = Object.entries(COND_LABELS)
        .filter(([k]) => conds[k])
        .map(([, label]) => label);
      const conditionsDisplay = activeConditions.length
        ? activeConditions.join(" · ")
        : "Fresh";

      // Next grind condition
      const nextCondKey = GRIND_ORDER.find(k => !conds[k]) ?? null;
      const nextCondLabel = nextCondKey ? (COND_LABELS[nextCondKey] ?? nextCondKey) : null;

      // Light sources (lit and unlit) — only items held in hand
      const allLightSources = actor.items
        .filter(i =>
          i.type === "supply" &&
          i.system.supplyType === "light" &&
          (i.system.slot === "hand-L" || i.system.slot === "hand-R")
        )
        .map(i => ({
          id: i.id,
          name: i.name,
          turnsRemaining: i.system.turnsRemaining,
          lit: i.system.lit,
          low: i.system.lit && i.system.turnsRemaining <= 1
        }));

      const litSources = allLightSources.filter(s => s.lit);
      const unlitSources = allLightSources.filter(s => !s.lit && s.turnsRemaining > 0);
      const depletedSources = allLightSources.filter(s => !s.lit && s.turnsRemaining <= 0);
      const isHolder = litSources.length > 0;

      // Coverage info
      const coveredById = actor.getFlag("tb2e", "grindCoveredBy") ?? null;
      let coveredByName = null;
      let coveredByLight = null;

      if ( coveredById && !isHolder ) {
        const holder = game.actors.get(coveredById);
        if ( holder ) {
          coveredByName = holder.name;
          const holderLit = holder.items.find(i =>
            i.type === "supply" &&
            i.system.supplyType === "light" &&
            i.system.lit &&
            (i.system.slot === "hand-L" || i.system.slot === "hand-R")
          );
          if ( holderLit ) {
            coveredByLight = {
              name: holderLit.name,
              turnsRemaining: holderLit.system.turnsRemaining,
              low: holderLit.system.turnsRemaining <= 1
            };
          }
        }
      }

      // Covered-by dropdown options
      const coveredByOptions = [
        { id: "", name: "— self / none —", selected: !coveredById },
        ...game.actors
          .filter(a => a.type === "character" && a.id !== actor.id)
          .map(a => ({ id: a.id, name: a.name, selected: a.id === coveredById }))
      ];

      // Containers: backpack or satchel, not dropped, slot assigned
      const containers = actor.items
        .filter(i =>
          i.type === "container" &&
          ["backpack", "satchel"].includes(i.system.containerType) &&
          !i.system.dropped &&
          i.system.slot
        )
        .map(i => ({
          id: i.id,
          name: i.name,
          type: i.system.containerType,
          slots: i.system.containerSlots
        }));

      const LIGHT_ICONS = { full: "fa-sun", dim: "fa-circle-half-stroke", dark: "fa-moon" };
      const lightLevel = actor.system.lightLevel ?? "full";

      return {
        id: actor.id,
        name: actor.name,
        stock: actor.system.stock,
        class: actor.system.class,
        conditionsDisplay,
        hasFresh: !activeConditions.length,
        nextCondKey,
        nextCondLabel,
        isGrindTurn,
        litSources,
        unlitSources,
        depletedSources,
        isHolder,
        coveredById,
        coveredByName,
        coveredByLight,
        coveredByOptions,
        containers,
        lightLevel,
        lightLevelIcon: LIGHT_ICONS[lightLevel]
      };
    });
  }

  /* -------------------------------------------- */
  /*  Private Helpers                              */
  /* -------------------------------------------- */

  async #setTurn(value) {
    const turn = Math.max(1, parseInt(value) || 1);
    await game.settings.set("tb2e", "grindTurn", turn);
    this.render();
  }

  async #toggleExtreme() {
    const current = game.settings.get("tb2e", "grindExtreme");
    await game.settings.set("tb2e", "grindExtreme", !current);
    this.render();
  }

  async #setCoveredBy(actorId, holderId) {
    const actor = game.actors.get(actorId);
    if ( !actor ) return;
    if ( holderId ) {
      await actor.setFlag("tb2e", "grindCoveredBy", holderId);
      await actor.update({ "system.lightLevel": "full" });
    } else {
      await actor.unsetFlag("tb2e", "grindCoveredBy");
      const hasLit = actor.items.some(i =>
        i.type === "supply" &&
        i.system.supplyType === "light" &&
        i.system.lit &&
        (i.system.slot === "hand-L" || i.system.slot === "hand-R")
      );
      if ( !hasLit ) await actor.update({ "system.lightLevel": "dark" });
    }
  }

  /* -------------------------------------------- */
  /*  Actions                                      */
  /* -------------------------------------------- */

  /**
   * Advance the grind turn by 1, decrement lit light sources, post chat cards.
   */
  static async #onAdvanceTurn(event, target) {
    const extreme = game.settings.get("tb2e", "grindExtreme");
    const maxTurns = extreme ? 3 : 4;
    const current = game.settings.get("tb2e", "grindTurn");
    const next = current + 1;
    const cyclePos = ((next - 1) % maxTurns) + 1;

    // Decrement lit light sources; create a card + update for each that expires
    for ( const actor of game.actors ) {
      if ( actor.type !== "character" ) continue;
      for ( const item of actor.items ) {
        if ( item.type !== "supply" || item.system.supplyType !== "light" || !item.system.lit ) continue;
        const newTurns = Math.max(0, item.system.turnsRemaining - 1);
        const update = { "system.turnsRemaining": newTurns };
        if ( newTurns <= 0 ) {
          update["system.lit"] = false;
          // Compute covered characters who will be darkened (query before update fires hooks)
          const affectedNames = game.actors
            .filter(a =>
              a.type === "character" &&
              a.id !== actor.id &&
              a.getFlag("tb2e", "grindCoveredBy") === actor.id &&
              !a.items.some(i =>
                i.type === "supply" && i.system.supplyType === "light" && i.system.lit &&
                (i.system.slot === "hand-L" || i.system.slot === "hand-R")
              )
            )
            .map(a => a.name);
          await GrindTracker.#postTorchExpiredCard(actor, item, affectedNames);
        }
        await item.update(update);
      }
    }

    // On grind turns: announce + post per-character condition cards
    if ( cyclePos === maxTurns ) {
      await GrindTracker.#postGrindTickCard(next);
      const condOrder = ["hungry", "exhausted", "angry", "sick", "injured", "afraid", "dead"];
      for ( const actor of game.actors ) {
        if ( actor.type !== "character" ) continue;
        const conds = actor.system.conditions;
        const nextCondKey = condOrder.find(k => !conds[k]) ?? null;
        if ( !nextCondKey ) continue;
        await GrindTracker.#postGrindConditionCard(actor, nextCondKey);
      }
    }

    await game.settings.set("tb2e", "grindTurn", next);
    this.render();
  }

  /**
   * Post a chat card announcing a light source has burned out.
   */
  static async #postTorchExpiredCard(actor, item, affectedNames) {
    const content = await foundry.applications.handlebars.renderTemplate(
      "systems/tb2e/templates/chat/torch-expired.hbs",
      {
        actorImg: actor.img,
        actorName: actor.name,
        label: game.i18n.localize("TB2E.GrindTracker.LightExpiredTitle"),
        body: game.i18n.format("TB2E.GrindTracker.LightExpiredBody", { item: item.name }),
        affectedLine: affectedNames.length
          ? game.i18n.format("TB2E.GrindTracker.NowInDarkness", { names: affectedNames.join(", ") })
          : ""
      }
    );
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content,
      type: CONST.CHAT_MESSAGE_STYLES.OTHER
    });
  }

  /**
   * Post a single game-level card announcing the Grind has ticked.
   * @param {number} turn  The new (post-advance) turn number.
   */
  static async #postGrindTickCard(turn) {
    const content = await foundry.applications.handlebars.renderTemplate(
      "systems/tb2e/templates/chat/grind-tick.hbs",
      {
        body: game.i18n.format("TB2E.GrindTracker.GrindTicksBody", { turn })
      }
    );
    await ChatMessage.create({
      speaker: { alias: game.i18n.localize("TB2E.GrindTracker.Title") },
      content,
      type: CONST.CHAT_MESSAGE_STYLES.OTHER
    });
  }

  /**
   * Post a per-character card for a grind condition with an Apply button.
   * @param {Actor} actor
   * @param {string} condKey  e.g. "hungry", "exhausted", etc.
   */
  static async #postGrindConditionCard(actor, condKey) {
    const condLabel = game.i18n.localize(
      "TB2E.Condition." + condKey[0].toUpperCase() + condKey.slice(1)
    );
    const content = await foundry.applications.handlebars.renderTemplate(
      "systems/tb2e/templates/chat/grind-condition.hbs",
      {
        actorImg: actor.img,
        actorName: actor.name,
        label: game.i18n.localize("TB2E.GrindTracker.ConditionLabel"),
        body: game.i18n.format("TB2E.GrindTracker.ConditionBody", { name: actor.name }),
        condLabel,
        applyLabel: game.i18n.format("TB2E.GrindTracker.ApplyCondition", { condition: condLabel })
      }
    );
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content,
      type: CONST.CHAT_MESSAGE_STYLES.OTHER,
      flags: { tb2e: { grindCondition: true, actorId: actor.id, condKey } }
    });
  }

  /**
   * Cycle phase: adventure → camp → town → adventure.
   * Resets turn to 1 when switching TO adventure.
   */
  static async #onSetPhase(event, target) {
    const phases = ["adventure", "camp", "town"];
    const current = game.settings.get("tb2e", "grindPhase");
    const idx = phases.indexOf(current);
    const next = phases[(idx + 1) % phases.length];

    if ( next === "adventure" ) {
      await game.settings.set("tb2e", "grindTurn", 1);
    }

    await game.settings.set("tb2e", "grindPhase", next);
    this.render();
  }

  /**
   * Toggle the lit state of a light source item.
   */
  static async #onToggleLight(event, target) {
    const { actorId, itemId } = target.dataset;
    const actor = game.actors.get(actorId);
    if ( !actor ) return;
    const item = actor.items.get(itemId);
    if ( !item ) return;
    await item.update({ "system.lit": !item.system.lit });
  }

  /**
   * Cycle the light level of a covered character: full → dim → dark → full.
   */
  static async #onSetLightLevel(event, target) {
    const { actorId } = target.dataset;
    const actor = game.actors.get(actorId);
    if ( !actor ) return;
    const levels = ["full", "dim", "dark"];
    const current = actor.system.lightLevel ?? "full";
    const next = levels[(levels.indexOf(current) + 1) % levels.length];
    await actor.update({ "system.lightLevel": next });
  }
}

/**
 * Register the "Apply condition" button on grind condition chat cards.
 * Called from the renderChatMessageHTML hook in tb2e.mjs.
 * @param {ChatMessage} message
 * @param {HTMLElement} html
 */
export function activateGrindConditionListeners(message, html) {
  if ( !message.getFlag("tb2e", "grindCondition") ) return;
  const btn = html.querySelector("[data-action='applyGrindCondition']");
  if ( !btn ) return;
  if ( message.getFlag("tb2e", "conditionApplied") ) {
    btn.disabled = true;
    btn.textContent = game.i18n.localize("TB2E.GrindTracker.ConditionApplied");
    return;
  }
  btn.addEventListener("click", async (event) => {
    event.preventDefault();
    const actorId = message.getFlag("tb2e", "actorId");
    const condKey = message.getFlag("tb2e", "condKey");
    const actor = game.actors.get(actorId);
    if ( !actor?.isOwner ) return;
    await actor.update({ [`system.conditions.${condKey}`]: true });
    await message.setFlag("tb2e", "conditionApplied", true);
    btn.disabled = true;
    btn.textContent = game.i18n.localize("TB2E.GrindTracker.ConditionApplied");
  });
}
