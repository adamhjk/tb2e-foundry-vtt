import { advancementNeeded, conditions, abilities, skills, levelRequirements, stocks, classes, containerTypes } from "../../config.mjs";
import { resolveSlotOptionKey, getSlotCost, getMinSlotCost, getCacheCost, formatSlotOptions } from "../../data/item/_fields.mjs";
import { rollTest, showAdvancementDialog, castSpell, performInvocation } from "../../dice/_module.mjs";
import { evaluateRoll, gatherHelpModifiers } from "../../dice/tb2e-roll.mjs";
import { getEligibleHelpers } from "../../dice/help.mjs";
import { _checkWiseAdvancement } from "../../dice/post-roll.mjs";
import { resetTraitsForSession } from "../../session.mjs";
import CharacterWizard from "./character-wizard.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

export default class CharacterSheet extends HandlebarsApplicationMixin(ActorSheetV2) {

  static #FIXED_SLOTS = new Set(["head", "neck", "hand-L", "hand-R", "torso", "belt", "feet", "pocket"]);

  static DEFAULT_OPTIONS = {
    classes: ["tb2e", "sheet", "actor", "character"],
    position: { width: 800, height: 750 },
    actions: {
      toggleCondition: CharacterSheet.#onToggleCondition,
      toggleBubble: CharacterSheet.#onToggleBubble,
      setTraitLevel: CharacterSheet.#onSetTraitLevel,
      addTrait: CharacterSheet.#onAddTrait,
      deleteTrait: CharacterSheet.#onDeleteTrait,
      addRow: CharacterSheet.#onAddRow,
      deleteRow: CharacterSheet.#onDeleteRow,
      rollTest: CharacterSheet.#onRollTest,
      advance: CharacterSheet.#onAdvance,
      toggleTeam: CharacterSheet.#onToggleTeam,
      conserveNature: CharacterSheet.#onConserveNature,
      recoverNature: CharacterSheet.#onRecoverNature,
      addDescriptor: CharacterSheet.#onAddDescriptor,
      removeDescriptor: CharacterSheet.#onRemoveDescriptor,
      toggleClassTrait: CharacterSheet.#onToggleClassTrait,
      resetSession: CharacterSheet.#onResetSession,
      removeFromSlot: CharacterSheet.#onRemoveFromSlot,
      dropItem: CharacterSheet.#onDropItem,
      pickUpItem: CharacterSheet.#onPickUpItem,
      toggleDamaged: CharacterSheet.#onToggleDamaged,
      consumePortion: CharacterSheet.#onConsumePortion,
      drinkDraught: CharacterSheet.#onDrinkDraught,
      consumeLight: CharacterSheet.#onConsumeLight,
      lightSource: CharacterSheet.#onLightSource,
      moveToHand: CharacterSheet.#onMoveToHand,
      placeItem: CharacterSheet.#onPlaceItem,
      editItem: CharacterSheet.#onEditItem,
      deleteItem: CharacterSheet.#onDeleteItem,
      createItem: CharacterSheet.#onCreateItem,
      toggleLiquidType: CharacterSheet.#onToggleLiquidType,
      splitBundle: CharacterSheet.#onSplitBundle,
      toggleSpellField: CharacterSheet.#onToggleSpellField,
      addSpell: CharacterSheet.#onAddSpell,
      deleteSpell: CharacterSheet.#onDeleteSpell,
      castSpell: CharacterSheet.#onCastSpell,
      addSpellbook: CharacterSheet.#onAddSpellbook,
      deleteSpellbook: CharacterSheet.#onDeleteSpellbook,
      addScroll: CharacterSheet.#onAddScroll,
      deleteScroll: CharacterSheet.#onDeleteScroll,
      addInvocation: CharacterSheet.#onAddInvocation,
      deleteInvocation: CharacterSheet.#onDeleteInvocation,
      performInvocation: CharacterSheet.#onPerformInvocation,
      addRelic: CharacterSheet.#onAddRelic,
      deleteRelic: CharacterSheet.#onDeleteRelic,
      setLightLevel: CharacterSheet.#onSetLightLevel,
      openWizard: CharacterSheet.#onOpenWizard
    },
    form: { submitOnChange: true },
    window: { resizable: true, minimizable: true }
  };

  /* -------------------------------------------- */
  /** @type {number|null} */
  #updateCombatHookId = null;

  /** @type {number|null} */
  #updateCombatantHookId = null;

  /** @override */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    // Re-render conflict part when combat state or combatant data changes.
    this.#updateCombatHookId = Hooks.on("updateCombat", () => {
      this.render({ parts: ["conflict"] });
    });
    this.#updateCombatantHookId = Hooks.on("updateCombatant", (combatant) => {
      if ( combatant.actorId === this.document.id || combatant.parent?.combatants.some(c => c.actorId === this.document.id) ) {
        this.render({ parts: ["conflict"] });
      }
    });
  }

  /** @override */
  async _onClose(options) {
    if ( this.#updateCombatHookId != null ) {
      Hooks.off("updateCombat", this.#updateCombatHookId);
      this.#updateCombatHookId = null;
    }
    if ( this.#updateCombatantHookId != null ) {
      Hooks.off("updateCombatant", this.#updateCombatantHookId);
      this.#updateCombatantHookId = null;
    }
    await super._onClose(options);
  }

  /*  Parts & Tabs                                */
  /* -------------------------------------------- */

  static PARTS = {
    header: {
      template: "systems/tb2e/templates/actors/character-header.hbs"
    },
    referenceBar: {
      template: "systems/tb2e/templates/actors/character-reference-bar.hbs"
    },
    conditions: {
      template: "systems/tb2e/templates/actors/character-conditions.hbs"
    },
    conflict: {
      template: "systems/tb2e/templates/actors/character-conflict.hbs"
    },
    tabs: {
      template: "templates/generic/tab-navigation.hbs"
    },
    identity: {
      template: "systems/tb2e/templates/actors/tabs/character-identity.hbs",
      scrollable: [""]
    },
    abilities: {
      template: "systems/tb2e/templates/actors/tabs/character-abilities.hbs",
      scrollable: [""]
    },
    skills: {
      template: "systems/tb2e/templates/actors/tabs/character-skills.hbs",
      scrollable: [""]
    },
    traits: {
      template: "systems/tb2e/templates/actors/tabs/character-traits.hbs",
      scrollable: [""]
    },
    inventory: {
      template: "systems/tb2e/templates/actors/tabs/character-inventory.hbs",
      scrollable: [""]
    },
    magic: {
      template: "systems/tb2e/templates/actors/tabs/character-magic.hbs",
      scrollable: [""]
    },
    biography: {
      template: "systems/tb2e/templates/actors/tabs/character-biography.hbs",
      scrollable: [""]
    }
  };

  static TABS = {
    sheet: {
      tabs: [
        { id: "identity",  icon: "fa-solid fa-scroll",      label: "TB2E.Tab.identity" },
        { id: "abilities", icon: "fa-solid fa-dice-d20",    label: "TB2E.Tab.abilities" },
        { id: "skills",    icon: "fa-solid fa-hammer",      label: "TB2E.Tab.skills" },
        { id: "traits",    icon: "fa-solid fa-fingerprint",  label: "TB2E.Tab.traits" },
        { id: "inventory", icon: "fa-solid fa-bag-shopping", label: "TB2E.Tab.inventory" },
        { id: "magic",     icon: "fa-solid fa-hat-wizard",  label: "TB2E.Tab.magic" },
        { id: "biography", icon: "fa-solid fa-book-open",   label: "TB2E.Tab.biography" }
      ],
      initial: "abilities",
      labelPrefix: "TB2E.Tab"
    }
  };

  /* -------------------------------------------- */
  /*  Partials                                    */
  /* -------------------------------------------- */

  static PARTIALS = [
    "systems/tb2e/templates/actors/parts/advancement-bubbles.hbs",
    "systems/tb2e/templates/actors/parts/learning-bubbles.hbs",
    "systems/tb2e/templates/actors/parts/point-boxes.hbs"
  ];

  static {
    Hooks.once("init", () => {
      loadTemplates(CharacterSheet.PARTIALS);
    });
  }

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
    if ( partId in partContext.tabs ) partContext.tab = partContext.tabs[partId];

    switch ( partId ) {
      case "header":
        this.#prepareHeaderContext(partContext);
        break;
      case "referenceBar":
        partContext.placeholderText = game.i18n.localize("TB2E.Reference.Placeholder");
        break;
      case "conditions":
        this.#prepareConditionsContext(partContext);
        break;
      case "conflict":
        this.#prepareConflictContext(partContext);
        break;
      case "identity":
        partContext.whoYouAreFields = this._prepareWhoYouAreFields();
        partContext.convictionFields = this._prepareConvictionFields();
        break;
      case "abilities":
        this.#prepareAbilitiesContext(partContext);
        break;
      case "skills":
        this.#prepareSkillsContext(partContext);
        break;
      case "traits":
        this.#prepareTraitsContext(partContext);
        break;
      case "inventory":
        this.#prepareInventoryContext(partContext);
        break;
      case "magic":
        this.#prepareMagicContext(partContext);
        break;
      case "biography":
        this.#prepareBiographyContext(partContext);
        break;
    }
    return partContext;
  }

  /* -------------------------------------------- */

  #prepareHeaderContext(context) {
    const sys = this.document.system;
    context.fateLabel = game.i18n.localize("TB2E.Fields.Fate");
    context.personaLabel = game.i18n.localize("TB2E.Fields.Persona");
    context.checksLabel = game.i18n.localize("TB2E.Fields.Checks");

    // Localized stock/class labels for the header summary.
    context.stockLabel = stocks[sys.stock] ? game.i18n.localize(stocks[sys.stock].label) : sys.stock;
    context.classLabel = classes[sys.class] ? game.i18n.localize(classes[sys.class].label) : sys.class;

    // Team toggle display.
    const team = sys.conflict.team || "party";
    context.teamClass = `team-${team}`;
    context.teamIcon = team === "party" ? "fa-solid fa-users" : "fa-solid fa-dragon";
    context.teamLabel = game.i18n.localize(
      team === "party" ? "TB2E.Conflict.TeamParty" : "TB2E.Conflict.TeamGM"
    );

    // Conflict disposition display.
    const disp = sys.conflict.hp;
    context.inConflict = disp.max > 0;
    if ( context.inConflict ) {
      // Derive the conflict label from the active combat.
      const combat = game.combats?.find(c =>
        c.isConflict && c.combatants.some(cb => cb.actorId === this.document.id)
      );
      const conflictType = combat?.system.conflictType || "capture";
      const cfg = CONFIG.TB2E.conflictTypes[conflictType];
      context.conflictLabel = game.i18n.localize(cfg?.label || "TB2E.Conflict.Title");
      context.dispositionPercent = Math.round((disp.value / disp.max) * 100);
    }

    // Light level toggle.
    const LIGHT_LEVELS = [
      { level: "full", icon: "fa-sun",                label: game.i18n.localize("TB2E.Light.Full") },
      { level: "dim",  icon: "fa-circle-half-stroke", label: game.i18n.localize("TB2E.Light.Dim")  },
      { level: "dark", icon: "fa-moon",               label: game.i18n.localize("TB2E.Light.Dark") }
    ];
    context.lightLevels = LIGHT_LEVELS.map(l => ({
      ...l,
      active: sys.lightLevel === l.level
    }));
  }

  /* -------------------------------------------- */

  #prepareConditionsContext(context) {
    const sys = this.document.system;
    context.conditions = Object.entries(conditions).map(([key, cfg]) => ({
      key,
      label: game.i18n.localize(cfg.label),
      icon: cfg.icon,
      color: cfg.color,
      active: sys.conditions[key],
      page: cfg.page
    }));
  }

  /* -------------------------------------------- */

  #prepareAbilitiesContext(context) {
    const sys = this.document.system;
    context.rawAbilities = [];
    context.townAbilities = [];

    for ( const [key, cfg] of Object.entries(abilities) ) {
      if ( cfg.rollable === false ) {
        const inAbilities = key in sys.abilities;
        const path = inAbilities ? `system.abilities.${key}` : `system.${key}`;
        const value = inAbilities ? sys.abilities[key] : sys[key];
        const entry = { key, label: game.i18n.localize(cfg.label), rollable: false, page: cfg.page, path, value };
        if ( cfg.group === "raw" ) context.rawAbilities.push(entry);
        else context.townAbilities.push(entry);
        continue;
      }
      const data = sys.abilities[key];
      const rating = key === "nature" ? data.max : data.rating;
      const adv = advancementNeeded(rating);
      const entry = {
        key,
        label: game.i18n.localize(cfg.label),
        path: `system.abilities.${key}`,
        rating: data.rating,
        pass: data.pass,
        fail: data.fail,
        passArray: this.#buildBubbles(data.pass, adv.pass),
        failArray: this.#buildBubbles(data.fail, adv.fail),
        canAdvance: data.pass >= adv.pass && data.fail >= adv.fail && adv.pass > 0,
        page: cfg.page
      };
      if ( cfg.group === "raw" ) context.rawAbilities.push(entry);
      else context.townAbilities.push(entry);
    }

    // Nature sub-system data
    const nature = sys.abilities.nature;
    context.nature = {
      rating: nature.rating,
      max: nature.max,
      isTaxed: nature.rating < nature.max,
      canRecover: nature.rating < nature.max,
      canConserve: nature.max > 1,
      stockLabel: game.i18n.format("TB2E.Nature.StockLabel", {
        stock: stocks[sys.stock] ? game.i18n.localize(stocks[sys.stock].label) : (sys.stock || "?")
      }),
      descriptors: sys.natureDescriptors || [],
      defaultDescriptors: stocks[sys.stock]?.natureDescriptors || []
    };
  }

  /* -------------------------------------------- */

  #prepareSkillsContext(context) {
    const sys = this.document.system;
    context.skills = Object.entries(skills).map(([key, cfg]) => {
      const data = sys.skills[key];
      const adv = advancementNeeded(data.rating);
      const isLearning = data.rating === 0 && (data.learning ?? 0) > 0;
      return {
        key,
        label: game.i18n.localize(cfg.label),
        bl: cfg.bl,
        path: `system.skills.${key}`,
        rating: data.rating,
        hasRating: data.rating > 0,
        pass: data.pass,
        fail: data.fail,
        passArray: this.#buildBubbles(data.pass, adv.pass),
        failArray: this.#buildBubbles(data.fail, adv.fail),
        canAdvance: data.pass >= adv.pass && data.fail >= adv.fail && adv.pass > 0,
        learning: data.learning ?? 0,
        isLearning,
        learningArray: isLearning ? this.#buildBubbles(data.learning ?? 0, sys.abilities.nature.max) : [],
        page: cfg.page,
        isSpecialty: key === sys.specialty
      };
    });
  }

  /* -------------------------------------------- */

  #prepareTraitsContext(context) {
    const sys = this.document.system;
    context.traits = (this.document.itemTypes.trait || []).map(item => ({
      itemId: item.id,
      name: item.name,
      level: item.system.level,
      isClass: item.system.isClass,
      beneficial: item.system.beneficial,
      maxBeneficial: item.system.maxBeneficial,
      usedAgainst: item.system.usedAgainst,
      checks: item.system.checks,
      levels: [1, 2, 3].map(l => ({ value: l, active: l === item.system.level }))
    }));
    context.wises = sys.wises;
    context.canAddWise = (sys.wises || []).length < 4;
  }

  /* -------------------------------------------- */

  #prepareInventoryContext(context) {
    const sys = this.document.system;
    const actor = this.document;

    // Gather all inventory items (everything except traits).
    const allItems = [...(actor.itemTypes.weapon || []), ...(actor.itemTypes.armor || []),
      ...(actor.itemTypes.container || []), ...(actor.itemTypes.gear || []),
      ...(actor.itemTypes.supply || []), ...(actor.itemTypes.spellbook || []),
      ...(actor.itemTypes.scroll || []), ...(actor.itemTypes.relic || [])];

    // Build fixed body slot groups.
    const fixedSlots = [
      { key: "head",    label: "TB2E.Inventory.Head",    count: 1, column: "left" },
      { key: "neck",    label: "TB2E.Inventory.Neck",    count: 1, column: "left" },
      { key: "hand-L",  label: "TB2E.Inventory.HandL",   count: 2, column: "left", sublabels: ["TB2E.Inventory.Worn", "TB2E.Inventory.Carried"] },
      { key: "hand-R",  label: "TB2E.Inventory.HandR",   count: 2, column: "left", sublabels: ["TB2E.Inventory.Worn", "TB2E.Inventory.Carried"] },
      { key: "feet",    label: "TB2E.Inventory.Feet",    count: 1, column: "left" },
      { key: "pocket",  label: "TB2E.Inventory.Pocket",  count: 1, column: "left" },
      { key: "torso",   label: "TB2E.Inventory.Torso",   count: 3, column: "right" },
      { key: "belt",    label: "TB2E.Inventory.Belt",    count: 3, column: "right" }
    ];

    // Build dynamic container slot groups from equipped container items.
    const containerGroups = [];
    const containers = (actor.itemTypes.container || []).filter(c =>
      CharacterSheet.#FIXED_SLOTS.has(c.system.slot) && !c.system.dropped && !c.system.lost && (c.system.quantityMax ?? 1) === 1
    );
    for ( const c of containers ) {
      // Liquid containers don't provide inventory slot groups.
      const cType = CONFIG.TB2E.containerTypes[c.system.containerType];
      if ( cType?.liquid ) continue;
      const cKey = c.system.containerKey || c.id;
      containerGroups.push({
        key: cKey,
        label: c.name,
        count: c.system.containerSlots,
        column: "right",
        containerId: c.id,
        containerType: c.system.containerType,
        isContainer: true
      });
    }

    // Append cache slot group (12 slots, pack costs).
    const cacheOccupants = this.document.items.filter(i => i.system.slot === "cache").length;
    containerGroups.push({
      key: "cache", label: "TB2E.Inventory.Cache", count: 12, column: "right", isCache: true, occupiedCount: cacheOccupants
    });

    // Combine all slot groups.
    const allSlotDefs = [...fixedSlots, ...containerGroups];

    // Index items by slot.
    const slotMap = new Map();
    for ( const def of allSlotDefs ) slotMap.set(def.key, []);

    // Build a lookup from slot key to slot group definition.
    const slotDefMap = new Map();
    for ( const def of allSlotDefs ) slotDefMap.set(def.key, def);

    const unassigned = [];
    const dropped = [];
    for ( const item of allItems ) {
      if ( item.system.dropped ) {
        dropped.push(this.#itemSummary(item));
        continue;
      }
      if ( !item.system.slot ) {
        unassigned.push(this.#itemSummary(item));
        continue;
      }
      const bucket = slotMap.get(item.system.slot);
      const def = slotDefMap.get(item.system.slot);
      if ( bucket ) bucket.push(this.#itemSummary(item, def));
      else unassigned.push(this.#itemSummary(item));
    }

    // Build slot group context with item placement.
    const leftSlots = [];
    const rightSlots = [];
    for ( const def of allSlotDefs ) {
      const items = slotMap.get(def.key) || [];
      items.sort((a, b) => a.slotIndex - b.slotIndex);
      const slots = Array.from({ length: def.count }, (_, i) => {
        const item = items.find(it => it.slotIndex === i);
        if ( item ) return { occupied: true, ...item, isSpanStart: true };
        const spanning = items.find(it => i > it.slotIndex && i < it.slotIndex + it.resolvedSlotCost);
        if ( spanning ) return { occupied: true, ...spanning, isSpanContinuation: true };
        return { occupied: false, index: i };
      });
      const group = {
        key: def.key,
        label: game.i18n.localize(def.label),
        count: def.count,
        slots,
        isContainer: def.isContainer || false,
        isCache: def.isCache || false,
        containerId: def.containerId || null,
        sublabels: def.sublabels?.map(l => game.i18n.localize(l)) || null,
        occupiedCount: def.occupiedCount ?? null
      };
      if ( def.column === "left" ) leftSlots.push(group);
      else rightSlots.push(group);
    }

    // Build grouped dropped containers: containers whose children still
    // reference their containerKey (items that stayed "inside" when dropped).
    const droppedContainerGroups = [];
    const droppedGroupedIds = new Set();
    for ( const summary of dropped ) {
      if ( summary.type !== "container" || summary.isLiquidContainer || summary.isSplittableBundle ) continue;
      const containerItem = actor.items.get(summary.itemId);
      if ( !containerItem ) continue;
      const containerKey = containerItem.system.containerKey || containerItem.id;
      const children = dropped.filter(d =>
        d.itemId !== summary.itemId && actor.items.get(d.itemId)?.system.slot === containerKey
      );
      if ( !children.length ) continue;
      droppedContainerGroups.push({
        ...summary, containerKey, containerSlots: containerItem.system.containerSlots,
        children: children.sort((a, b) => a.slotIndex - b.slotIndex)
      });
      droppedGroupedIds.add(summary.itemId);
      for ( const ch of children ) droppedGroupedIds.add(ch.itemId);
    }
    const flatDropped = dropped.filter(d => !droppedGroupedIds.has(d.itemId));

    // Build grouped unassigned containers: unequipped containers whose
    // children still reference their containerKey.
    const unassignedContainerGroups = [];
    const unassignedGroupedIds = new Set();
    for ( const summary of unassigned ) {
      if ( summary.type !== "container" || summary.isLiquidContainer || summary.isSplittableBundle ) continue;
      const containerItem = actor.items.get(summary.itemId);
      if ( !containerItem ) continue;
      const containerKey = containerItem.system.containerKey || containerItem.id;
      const children = unassigned.filter(u =>
        u.itemId !== summary.itemId && actor.items.get(u.itemId)?.system.slot === containerKey
      );
      if ( !children.length ) continue;
      unassignedContainerGroups.push({
        ...summary, containerKey, containerSlots: containerItem.system.containerSlots,
        children: children.sort((a, b) => a.slotIndex - b.slotIndex)
      });
      unassignedGroupedIds.add(summary.itemId);
      for ( const ch of children ) unassignedGroupedIds.add(ch.itemId);
    }
    const flatUnassigned = unassigned.filter(u => !unassignedGroupedIds.has(u.itemId));

    // Enrich flat and grouped items with placement buttons.
    for ( const summary of flatUnassigned ) {
      const item = actor.items.get(summary.itemId);
      summary.placements = item ? this.#getAvailablePlacements(item) : [];
    }
    for ( const summary of flatDropped ) {
      const item = actor.items.get(summary.itemId);
      summary.placements = item ? this.#getAvailablePlacements(item) : [];
    }
    for ( const group of droppedContainerGroups ) {
      const item = actor.items.get(group.itemId);
      group.placements = item ? this.#getAvailablePlacements(item) : [];
    }
    for ( const group of unassignedContainerGroups ) {
      const item = actor.items.get(group.itemId);
      group.placements = item ? this.#getAvailablePlacements(item) : [];
    }

    context.leftSlots = leftSlots;
    context.rightSlots = rightSlots;
    context.unassigned = flatUnassigned;
    context.dropped = flatDropped;
    context.droppedContainerGroups = droppedContainerGroups;
    context.unassignedContainerGroups = unassignedContainerGroups;
    context.hasDropped = flatDropped.length > 0 || droppedContainerGroups.length > 0;
    context.hasUnassigned = flatUnassigned.length > 0 || unassignedContainerGroups.length > 0;
    // Attach checkbox values to relevant slot groups
    for ( const group of leftSlots ) {
      if ( group.key === "head" ) group.headDamage = sys.inventory.headDamage;
    }
    for ( const group of rightSlots ) {
      if ( group.key === "torso" ) {
        group.torsoDamage = sys.inventory.torsoDamage;
        group.torsoWeariness = sys.inventory.torsoWeariness;
      }
    }
  }

  /**
   * Build a summary object for an inventory item.
   * @param {Item} item
   * @returns {object}
   */
  #itemSummary(item, slotGroupDef = null) {
    const so = item.system.slotOptions;
    // Resolve the slot cost for the item's current position.
    let resolvedSlotCost = getMinSlotCost(so);
    if ( item.system.slot && slotGroupDef ) {
      const optKey = resolveSlotOptionKey(slotGroupDef.key, item.system.slotIndex ?? 0, slotGroupDef.isContainer || false, slotGroupDef.containerType ?? null);
      resolvedSlotCost = getSlotCost(so, optKey) ?? resolvedSlotCost;
    }
    const notation = formatSlotOptions(so);
    const canCarry = so?.carried != null;
    const isInHand = (item.system.slot === "hand-L" || item.system.slot === "hand-R")
      && (item.system.slotIndex ?? 0) === 1;
    return {
      itemId: item.id,
      name: item.name,
      type: item.type,
      img: item.img,
      slotIndex: item.system.slotIndex ?? 0,
      resolvedSlotCost,
      notation,
      canCarry,
      isInHand,
      damaged: item.system.damaged ?? false,
      dropped: item.system.dropped ?? false,
      quantity: item.system.quantity ?? 1,
      quantityMax: item.system.quantityMax ?? 1,
      isContainer: item.type === "container",
      isLiquidContainer: item.type === "container" && !!CONFIG.TB2E.containerTypes[item.system.containerType]?.liquid,
      isSplittableBundle: item.type === "container" && (item.system.quantityMax ?? 1) > 1,
      liquidType: item.system.liquidType ?? "water",
      liquidTypeLabel: game.i18n.localize(CONFIG.TB2E.liquidTypes[item.system.liquidType]?.label ?? "TB2E.Liquid.Water"),
      isSupply: item.type === "supply",
      isLight: item.type === "supply" && item.system.supplyType === "light",
      isFood: item.type === "supply" && item.system.supplyType === "food",
      lit: item.type === "supply" && item.system.supplyType === "light" && item.system.lit,
      depleted: item.type === "supply" && item.system.supplyType === "light" && !item.system.lit && (item.system.turnsRemaining ?? 0) <= 0,
      nameSingular: item.system.nameSingular || "",
      turnsRemaining: item.system.turnsRemaining ?? 0,
      hasQuantity: (item.system.quantityMax ?? 1) > 1,
      valueLabel: (() => {
        const val = item.system.value ?? {};
        if ( (val.dice ?? 0) > 0 ) return `${val.dice}D`;
        if ( val.negotiated ) return "X";
        return "";
      })()
    };
  }

  /* -------------------------------------------- */

  #prepareBiographyContext(context) {
    const sys = this.document.system;
    context.allies = sys.allies;
    context.currentLevel = sys.level;
    context.fateSpent = sys.fate.spent;
    context.personaSpent = sys.persona.spent;

    // Class-specific level benefits.
    const classCfg = classes[sys.class];
    context.hasClassBenefits = !!classCfg;
    if ( classCfg ) {
      context.classLabel = game.i18n.localize(classCfg.label);
      context.classBenefitPage = classCfg.levelBenefitPage;
    }

    // Find the next target level (first level whose requirements aren't both met).
    let nextTarget = null;
    for ( const [lvl, req] of Object.entries(levelRequirements) ) {
      if ( sys.fate.spent < req.fate || sys.persona.spent < req.persona ) {
        nextTarget = Number(lvl);
        break;
      }
    }

    context.levelRequirements = Object.entries(levelRequirements).map(([lvl, req]) => {
      const level = Number(lvl);
      const fateMet = sys.fate.spent >= req.fate;
      const personaMet = sys.persona.spent >= req.persona;
      const classBenefitKey = classCfg?.levelBenefits?.[level];
      return {
        level,
        fate: req.fate,
        persona: req.persona,
        benefit: game.i18n.localize(req.benefit),
        classBenefit: classBenefitKey ? game.i18n.localize(classBenefitKey) : null,
        levelChoice: sys.levelChoices?.[level] || "",
        fateMet,
        personaMet,
        bothMet: fateMet && personaMet,
        isNextTarget: level === nextTarget
      };
    });
  }

  /* -------------------------------------------- */

  #prepareMagicContext(context) {
    const actor = this.document;
    const sys = actor.system;

    // Gather spell, spellbook, and scroll items
    const spellItems = actor.itemTypes.spell || [];
    const spellbookItems = actor.itemTypes.spellbook || [];
    const scrollItems = actor.itemTypes.scroll || [];

    // Build spellbook choices for the spell table dropdown
    const spellbookChoices = spellbookItems.map(b => ({ id: b.id, name: b.name }));

    context.spells = spellItems.map(item => {
      let obstacleDisplay;
      switch ( item.system.castingType ) {
        case "fixed":
          obstacleDisplay = item.system.obstacleNote || String(item.system.fixedObstacle);
          break;
        case "factors":
          obstacleDisplay = game.i18n.localize("TB2E.Spell.ObFactors");
          break;
        case "versus":
          obstacleDisplay = game.i18n.localize("TB2E.Spell.ObVs");
          break;
        case "skillSwap":
          obstacleDisplay = game.i18n.localize("TB2E.Spell.ObSwap");
          break;
        default:
          obstacleDisplay = "?";
      }
      const scrollCount = scrollItems.filter(s => s.system.spellId === item.id).length;
      const inSpellbook = !!item.system.spellbookId;
      const canCast = item.system.castingType === "skillSwap"
        || item.system.memorized || scrollCount > 0 || inSpellbook;
      return {
        itemId: item.id,
        name: item.name,
        circle: item.system.circle,
        obstacleDisplay,
        library: item.system.library,
        spellbookId: item.system.spellbookId,
        spellbookChoices: spellbookChoices.map(b => ({
          ...b,
          selected: b.id === item.system.spellbookId
        })),
        memorized: item.system.memorized,
        cast: item.system.cast,
        scrollCount,
        canCast,
        castingType: item.system.castingType
      };
    });

    // Memory palace
    const memorizedSpells = spellItems.filter(i => i.system.memorized);
    const memoryUsed = memorizedSpells.reduce((sum, i) => sum + i.system.circle, 0);
    const memoryTotal = sys.memoryPalaceSlots;
    const memorySpells = memorizedSpells.map(spell => ({
      name: spell.name,
      circle: spell.system.circle,
      pips: Array(spell.system.circle).fill(true),
      id: spell.id
    }));
    const emptySlots = Math.max(0, memoryTotal - memoryUsed);
    context.memoryPalace = {
      used: memoryUsed,
      total: memoryTotal,
      spells: memorySpells,
      emptyPips: Array(emptySlots).fill(true)
    };

    // Spellbooks
    context.spellbooks = spellbookItems.map(book => {
      const spells = spellItems.filter(s => s.system.spellbookId === book.id);
      const used = spells.reduce((sum, s) => sum + s.system.circle, 0);
      const empty = Math.max(0, book.system.folios - used);
      return {
        id: book.id,
        name: book.name,
        folios: book.system.folios,
        used,
        carried: !!book.system.slot,
        spells: spells.map(s => ({
          name: s.name,
          circle: s.system.circle,
          pips: Array(s.system.circle).fill(true),
          id: s.id
        })),
        emptyPips: Array(empty).fill(true)
      };
    });

    // Scrolls
    context.scrolls = scrollItems.map(scroll => {
      const spell = spellItems.find(s => s.id === scroll.system.spellId);
      return {
        id: scroll.id,
        name: scroll.name,
        spellName: spell?.name ?? "Unknown",
        circle: spell?.system.circle ?? 0,
        pips: Array(spell?.system.circle ?? 0).fill(true),
        carried: !!scroll.system.slot
      };
    });

    // Invocations
    const invocationItems = actor.itemTypes.invocation || [];
    context.invocations = invocationItems.map(item => {
      let obstacleDisplay;
      switch ( item.system.castingType ) {
        case "fixed":
          obstacleDisplay = item.system.obstacleNote || String(item.system.fixedObstacle);
          break;
        case "factors":
          obstacleDisplay = game.i18n.localize("TB2E.Spell.ObFactors");
          break;
        case "versus":
          obstacleDisplay = game.i18n.localize("TB2E.Spell.ObVs");
          break;
        case "skillSwap":
          obstacleDisplay = game.i18n.localize("TB2E.Spell.ObSwap");
          break;
        default:
          obstacleDisplay = "?";
      }
      const burdenDisplay = item.system.burdenWithRelic
        ? `${item.system.burdenWithRelic}/${item.system.burden}`
        : String(item.system.burden);
      return {
        itemId: item.id,
        name: item.name,
        circle: item.system.circle,
        obstacleDisplay,
        burdenDisplay,
        performed: item.system.performed,
        castingType: item.system.castingType
      };
    });

    // Urðr exceeded check
    context.urdrExceeded = sys.urdr.burden > sys.urdr.capacity && sys.urdr.capacity > 0;

    // Relic items
    context.relics = (actor.itemTypes.relic || []).map(item => ({
      itemId: item.id,
      name: item.name,
      tier: game.i18n.localize(CONFIG.TB2E.relicTiers[item.system.relicTier]?.label ?? ""),
      linkedInvocations: item.system.linkedInvocations,
      linkedCircle: item.system.linkedCircle,
      isPlaced: !!item.system.slot
    }));
  }

  /* -------------------------------------------- */
  /*  Identity Tab Helpers (unchanged)            */
  /* -------------------------------------------- */

  _prepareWhoYouAreFields() {
    const sys = this.document.system;
    const currentClass = sys.class;
    const currentStock = sys.stock;

    // Build stock options, filtering by current class if set.
    const classCfg = classes[currentClass];
    const stockOptions = Object.entries(stocks).map(([key, cfg]) => {
      const allowed = classCfg ? classCfg.stocks.includes(key) : true;
      return { value: key, label: game.i18n.localize(cfg.label), selected: key === currentStock, disabled: !allowed };
    });

    // Build class options, filtering by current stock if set.
    const stockCfg = stocks[currentStock];
    const classOptions = Object.entries(classes).map(([key, cfg]) => {
      const allowed = stockCfg ? cfg.stocks.includes(currentStock) : true;
      return { value: key, label: game.i18n.localize(cfg.label), selected: key === currentClass, disabled: !allowed };
    });

    // Build specialty skill options.
    const specialtyOptions = Object.entries(skills).map(([key, cfg]) => ({
      value: key, label: game.i18n.localize(cfg.label), selected: key === sys.specialty
    }));

    return [
      { name: "stock", label: game.i18n.localize("TB2E.Fields.Stock"), value: currentStock, type: "select", options: stockOptions },
      { name: "class", label: game.i18n.localize("TB2E.Fields.Class"), value: currentClass, type: "select", options: classOptions },
      { name: "specialty", label: game.i18n.localize("TB2E.Fields.Specialty"), value: sys.specialty, type: "select", options: specialtyOptions },
      { name: "age", label: game.i18n.localize("TB2E.Fields.Age"), value: sys.age, type: "text" },
      { name: "home", label: game.i18n.localize("TB2E.Fields.Home"), value: sys.home, type: "text" },
      { name: "raiment", label: game.i18n.localize("TB2E.Fields.Raiment"), value: sys.raiment, type: "text" },
      { name: "parents", label: game.i18n.localize("TB2E.Fields.Parents"), value: sys.parents, type: "text" },
      { name: "mentor", label: game.i18n.localize("TB2E.Fields.Mentor"), value: sys.mentor, type: "text" },
      { name: "friend", label: game.i18n.localize("TB2E.Fields.Friend"), value: sys.friend, type: "text" },
      { name: "enemy", label: game.i18n.localize("TB2E.Fields.Enemy"), value: sys.enemy, type: "text" },
      { name: "level", label: game.i18n.localize("TB2E.Fields.Level"), value: sys.level, type: "number" }
    ];
  }

  /* -------------------------------------------- */

  _prepareConvictionFields() {
    const sys = this.document.system;
    return [
      {
        name: "belief", value: sys.belief,
        label: game.i18n.localize("TB2E.Fields.Belief"),
        hint: game.i18n.localize("TB2E.Fields.BeliefHint")
      },
      {
        name: "creed", value: sys.creed,
        label: game.i18n.localize("TB2E.Fields.Creed"),
        hint: game.i18n.localize("TB2E.Fields.CreedHint")
      },
      {
        name: "goal", value: sys.goal,
        label: game.i18n.localize("TB2E.Fields.Goal"),
        hint: game.i18n.localize("TB2E.Fields.GoalHint")
      },
      {
        name: "instinct", value: sys.instinct,
        label: game.i18n.localize("TB2E.Fields.Instinct"),
        hint: game.i18n.localize("TB2E.Fields.InstinctHint")
      }
    ];
  }

  /* -------------------------------------------- */
  /*  Conflict Panel Context                      */
  /* -------------------------------------------- */

  /**
   * Prepare the conflict panel context for the character sheet.
   * Only populates when this character is part of an active conflict.
   * @param {object} context
   */
  #prepareConflictContext(context) {
    const actor = this.document;
    const combat = game.combats?.find(c =>
      c.isConflict && c.combatants.some(cb => cb.actorId === actor.id)
    );

    if ( !combat ) {
      context.conflict = { active: false };
      return;
    }

    const combatant = combat.combatants.find(c => c.actorId === actor.id);
    if ( !combatant ) {
      context.conflict = { active: false };
      return;
    }

    const groupId = combatant._source.group;
    const gd = combat.system.groupDispositions || {};
    const groupData = gd[groupId] || {};
    const phase = combat.system.phase;
    const conflictCfg = combat.getEffectiveConflictConfig();
    const isCaptain = groupData.captainId === combatant.id;
    const disp = actor.system.conflict.hp;

    const weaponId = combatant.system.weaponId || actor.system.conflict.weaponId || "";
    const usesGear = !!conflictCfg?.usesGear;
    const isUnarmed = weaponId === "__unarmed__";
    const isImprovised = weaponId === "__improvised__";

    const conflictCtx = {
      active: true,
      combatId: combat.id,
      groupId,
      combatantId: combatant.id,
      typeLabel: game.i18n.localize(conflictCfg?.label ?? "TB2E.Conflict.Title"),
      phase,
      isCaptain,
      hp: disp,
      hpPercent: disp.max > 0 ? Math.round((disp.value / disp.max) * 100) : 0,
      weapon: combatant.system.weapon || actor.system.conflict.weapon || "",
      weaponId,
      usesGear,
      isUnarmed,
      isImprovised,
      isDisposition: phase === "disposition",
      isWeapons: phase === "weapons",
      isScriptingOrResolve: phase === "scripting" || phase === "resolve"
    };

    // During weapons phase for gear conflicts, provide weapon choices from inventory.
    if ( phase === "weapons" && usesGear ) {
      const weapons = (actor.itemTypes.weapon || []).filter(w => !w.system.dropped);
      conflictCtx.weaponChoices = [
        { id: "__unarmed__", name: game.i18n.localize("TB2E.Conflict.WeaponUnarmed"), selected: weaponId === "__unarmed__" },
        ...weapons.map(w => ({ id: w.id, name: w.name, selected: weaponId === w.id })),
        { id: "__improvised__", name: game.i18n.localize("TB2E.Conflict.WeaponImprovised"), selected: weaponId === "__improvised__" }
      ];
    }

    context.conflict = conflictCtx;
  }

  /* -------------------------------------------- */
  /*  Utility Helpers                             */
  /* -------------------------------------------- */

  /**
   * Build an array of {filled} objects for advancement bubble rendering.
   * @param {number} current - How many are filled.
   * @param {number} total - How many bubbles to show.
   * @returns {{filled: boolean}[]}
   */
  #buildBubbles(current, total) {
    if ( total <= 0 ) return [];
    return Array.from({ length: total }, (_, i) => ({ filled: i < current }));
  }

  /* -------------------------------------------- */
  /*  Render Hook                                 */
  /* -------------------------------------------- */

  async _preRender(context, options) {
    await super._preRender(context, options);
    // Preserve open/closed state of <details> elements across re-renders.
    this._detailsOpen = {};
    for ( const details of this.element?.querySelectorAll("details[data-slot-group]") ?? [] ) {
      this._detailsOpen[details.dataset.slotGroup] = details.open;
    }
  }

  _onRender(context, options) {
    super._onRender(context, options);
    // Restore <details> open state saved in _preRender.
    if ( this._detailsOpen ) {
      for ( const details of this.element.querySelectorAll("details[data-slot-group]") ) {
        if ( this._detailsOpen[details.dataset.slotGroup] ) details.open = true;
      }
    }

    // Reference bar hover behavior.
    const bar = this.element.querySelector(".reference-bar-text");
    if ( bar ) {
      const placeholder = bar.textContent;
      this.element.querySelectorAll("[data-page]").forEach(el => {
        el.addEventListener("mouseenter", () => {
          const label = el.querySelector(".skill-name, .ability-name, .condition-label, .point-label, .ref-label")?.textContent
            || el.textContent || "";
          bar.textContent = `${label.trim()} \u2014 ${el.dataset.page}`;
          bar.classList.remove("placeholder");
        });
        el.addEventListener("mouseleave", () => {
          bar.textContent = placeholder;
          bar.classList.add("placeholder");
        });
      });
    }

    // Trait name, beneficial, and checks input change handlers (Item updates).
    for ( const input of this.element.querySelectorAll(".trait-name-input") ) {
      input.addEventListener("change", () => {
        const itemId = input.closest("[data-item-id]")?.dataset.itemId;
        const item = this.document.items.get(itemId);
        if ( item ) item.update({ name: input.value });
      });
    }
    for ( const input of this.element.querySelectorAll(".trait-beneficial-input") ) {
      input.addEventListener("change", () => {
        const itemId = input.closest("[data-item-id]")?.dataset.itemId;
        const item = this.document.items.get(itemId);
        if ( item ) item.update({ "system.beneficial": Number(input.value) || 0 });
      });
    }
    for ( const input of this.element.querySelectorAll(".trait-checks-input") ) {
      input.addEventListener("change", () => {
        const itemId = input.closest("[data-item-id]")?.dataset.itemId;
        const item = this.document.items.get(itemId);
        if ( item ) item.update({ "system.checks": Number(input.value) || 0 });
      });
    }

    // Spellbook name input change handlers (Item updates).
    for ( const input of this.element.querySelectorAll(".spellbook-name-input") ) {
      input.addEventListener("change", () => {
        const itemId = input.dataset.itemId;
        const item = this.document.items.get(itemId);
        if ( item ) item.update({ name: input.value });
      });
    }

    // Food quantity input change handlers (Item updates).
    for ( const input of this.element.querySelectorAll(".slot-qty-input") ) {
      input.addEventListener("change", async () => {
        const itemId = input.dataset.itemId;
        const field = input.dataset.field; // "quantity" or "quantityMax"
        const item = this.document.items.get(itemId);
        if ( !item ) return;
        const value = Math.max(field === "quantityMax" ? 1 : 0, parseInt(input.value) || 0);
        const update = { [`system.${field}`]: value };
        // Refueling a depleted light source: setting turns > 0 relights it in place.
        const isDepletedLight = item.type === "supply" && item.system.supplyType === "light"
          && !item.system.lit && (item.system.turnsRemaining ?? 0) <= 0;
        if ( field === "turnsRemaining" && value > 0 && isDepletedLight ) {
          update["system.lit"] = true;
        }
        await item.update(update);
      });
    }

    // Wise checkbox change: detect advancement completion
    for ( const checksDiv of this.element.querySelectorAll(".wise-checks[data-wise-index]") ) {
      const wiseIndex = Number(checksDiv.dataset.wiseIndex);
      for ( const cb of checksDiv.querySelectorAll("input[type='checkbox']") ) {
        cb.addEventListener("change", () => {
          // Wait for the form submit to process, then check advancement
          setTimeout(() => _checkWiseAdvancement(this.document, wiseIndex), 100);
        });
      }
    }

    // Descriptor input: Enter key triggers add.
    const descInput = this.element.querySelector(".descriptor-input");
    if ( descInput ) {
      descInput.addEventListener("keydown", (e) => {
        if ( e.key === "Enter" ) {
          e.preventDefault();
          e.stopPropagation();
          this.element.querySelector(".descriptor-add-btn")?.click();
        }
      });
    }

    // Conflict weapon select (gear conflicts on character sheet).
    const conflictWeaponSelect = this.element.querySelector(".conflict-weapon-select");
    if ( conflictWeaponSelect ) {
      conflictWeaponSelect.addEventListener("change", (event) => {
        const combat = game.combats?.find(c =>
          c.isConflict && c.combatants.some(cb => cb.actorId === this.document.id)
        );
        if ( !combat ) return;
        const combatant = combat.combatants.find(c => c.actorId === this.document.id);
        if ( !combatant ) return;
        const weaponId = event.target.value;
        const improvisedInput = this.element.querySelector(".conflict-weapon-improvised-input");

        if ( weaponId === "__improvised__" ) {
          improvisedInput?.classList.remove("hidden");
          const name = improvisedInput?.value.trim() || game.i18n.localize("TB2E.Conflict.WeaponImprovised");
          combat.setWeapon(combatant.id, name, "__improvised__");
        } else {
          improvisedInput?.classList.add("hidden");
          const selectedOption = event.target.options[event.target.selectedIndex];
          const name = weaponId ? selectedOption.text : "";
          combat.setWeapon(combatant.id, name, weaponId);
        }
      });
    }

    // Conflict improvised weapon name input (gear conflicts on character sheet).
    const conflictImprovisedInput = this.element.querySelector(".conflict-weapon-improvised-input");
    if ( conflictImprovisedInput ) {
      conflictImprovisedInput.addEventListener("change", (event) => {
        const combat = game.combats?.find(c =>
          c.isConflict && c.combatants.some(cb => cb.actorId === this.document.id)
        );
        if ( !combat ) return;
        const combatant = combat.combatants.find(c => c.actorId === this.document.id);
        if ( !combatant ) return;
        const name = event.target.value.trim() || game.i18n.localize("TB2E.Conflict.WeaponImprovised");
        combat.setWeapon(combatant.id, name, "__improvised__");
      });
    }

    // Conflict weapon text input (non-gear conflicts on character sheet).
    const conflictWeaponInput = this.element.querySelector(".conflict-weapon-input");
    if ( conflictWeaponInput ) {
      conflictWeaponInput.addEventListener("change", (event) => {
        const combat = game.combats?.find(c =>
          c.isConflict && c.combatants.some(cb => cb.actorId === this.document.id)
        );
        if ( !combat ) return;
        const combatant = combat.combatants.find(c => c.actorId === this.document.id);
        if ( !combatant ) return;
        combat.setWeapon(combatant.id, event.target.value.trim());
      });
    }

    // Spellbook assignment selects (change event, not click action).
    for ( const select of this.element.querySelectorAll(".spellbook-select") ) {
      select.addEventListener("change", async () => {
        const itemId = select.dataset.itemId;
        const item = this.document.items.get(itemId);
        if ( !item ) return;
        const newBookId = select.value || "";
        if ( newBookId ) {
          const book = this.document.items.get(newBookId);
          if ( !book ) return;
          const currentUsed = (this.document.itemTypes.spell || [])
            .filter(s => s.system.spellbookId === newBookId && s.id !== itemId)
            .reduce((sum, s) => sum + s.system.circle, 0);
          if ( currentUsed + item.system.circle > book.system.folios ) {
            ui.notifications.warn(game.i18n.localize("TB2E.Spell.SpellbookFull"));
            select.value = item.system.spellbookId || "";
            return;
          }
        }
        await item.update({ "system.spellbookId": newBookId });
      });
    }
  }

  /* -------------------------------------------- */
  /*  Action Handlers                             */
  /* -------------------------------------------- */

  /**
   * Toggle a condition on/off. If activating any condition, deactivate Fresh.
   * If deactivating all conditions, reactivate Fresh.
   */
  static #onToggleCondition(event, target) {
    const condition = target.dataset.condition;
    const sys = this.document.system;
    const current = sys.conditions[condition];
    const update = {};

    if ( condition === "fresh" ) {
      // Toggling Fresh on clears all other conditions
      if ( !current ) {
        update["system.conditions.fresh"] = true;
        for ( const key of Object.keys(sys.conditions) ) {
          if ( key !== "fresh" ) update[`system.conditions.${key}`] = false;
        }
      } else {
        update["system.conditions.fresh"] = false;
      }
    } else {
      update[`system.conditions.${condition}`] = !current;
      // Activating a negative condition removes Fresh
      if ( !current ) {
        update["system.conditions.fresh"] = false;
      }
    }
    this.document.update(update);
  }

  /* -------------------------------------------- */

  /**
   * Toggle an advancement bubble. Clicking sets the count to index+1,
   * or if already at that value, sets it to index (toggle off the last filled).
   */
  static #onToggleBubble(event, target) {
    const path = target.dataset.path;
    const index = Number(target.dataset.index);
    const current = foundry.utils.getProperty(this.document, path);
    const newVal = (current === index + 1) ? index : index + 1;
    this.document.update({ [path]: newVal });
  }

  /* -------------------------------------------- */

  /**
   * Set trait level (1/2/3).
   */
  static #onSetTraitLevel(event, target) {
    const itemId = target.dataset.itemId;
    const level = Number(target.dataset.level);
    const item = this.document.items.get(itemId);
    if ( item ) item.update({ "system.level": level });
  }

  /**
   * Toggle the isClass flag on a trait Item.
   */
  static #onToggleClassTrait(event, target) {
    const itemId = target.dataset.itemId;
    const item = this.document.items.get(itemId);
    if ( item ) item.update({ "system.isClass": !item.system.isClass });
  }

  /**
   * Add a new trait Item to the character.
   */
  static async #onAddTrait(event, target) {
    await Item.create({ name: "New Trait", type: "trait" }, { parent: this.document });
  }

  /**
   * Delete a trait Item from the character.
   */
  static async #onDeleteTrait(event, target) {
    const itemId = target.dataset.itemId;
    const item = this.document.items.get(itemId);
    if ( item ) await item.delete();
  }

  /* -------------------------------------------- */

  /**
   * Add a blank row to an array field (spells, relics, allies).
   */
  static #onAddRow(event, target) {
    const arrayName = target.dataset.array;
    const current = foundry.utils.deepClone(this.document.system[arrayName] || []);
    if ( arrayName === "wises" && current.length >= 4 ) return;
    current.push({});
    this.document.update({ [`system.${arrayName}`]: current });
  }

  /* -------------------------------------------- */

  /**
   * Delete a row from an array field.
   */
  static #onDeleteRow(event, target) {
    const arrayName = target.dataset.array;
    const index = Number(target.dataset.index);
    const current = foundry.utils.deepClone(this.document.system[arrayName] || []);
    current.splice(index, 1);
    this.document.update({ [`system.${arrayName}`]: current });
  }

  /* -------------------------------------------- */

  /**
   * Roll an ability or skill test. Ignores clicks on inputs and advancement bubbles
   * so the row acts as a clickable roll trigger only on "dead" space and the label.
   */
  static #onRollTest(event, target) {
    const clicked = event.target;
    if ( clicked.closest("input, button.bubble, .btn-advance") ) return;
    rollTest({
      actor: this.document,
      type: target.dataset.type,
      key: target.dataset.key
    });
  }

  /* -------------------------------------------- */

  /**
   * Trigger the advancement dialog for an ability or skill.
   */
  static #onAdvance(event, target) {
    showAdvancementDialog({
      actor: this.document,
      type: target.dataset.type,
      key: target.dataset.key
    });
  }

  /* -------------------------------------------- */

  /**
   * Toggle team assignment between "party" and "gm".
   */
  static #onToggleTeam(event, target) {
    const current = this.document.system.conflict.team || "party";
    this.document.update({ "system.conflict.team": current === "party" ? "gm" : "party" });
  }

  /* -------------------------------------------- */
  /*  Spell Action Handlers                       */
  /* -------------------------------------------- */

  /**
   * Toggle a boolean field on a spell item (library, spellbook, memorized).
   */
  static async #onToggleSpellField(event, target) {
    event.preventDefault();
    event.stopPropagation();
    const itemId = target.dataset.itemId;
    const field = target.dataset.field;
    const item = this.document.items.get(itemId);
    if ( !item ) return;

    const newValue = !item.system[field];

    // Capacity check for memorized
    if ( field === "memorized" && newValue ) {
      const sys = this.document.system;
      const currentUsed = (this.document.itemTypes.spell || [])
        .filter(s => s.system.memorized && s.id !== itemId)
        .reduce((sum, s) => sum + s.system.circle, 0);
      if ( currentUsed + item.system.circle > sys.memoryPalaceSlots ) {
        ui.notifications.warn(game.i18n.localize("TB2E.Spell.MemoryFull"));
        return;
      }
    }

    await item.update({ [`system.${field}`]: newValue });
  }

  /**
   * Add a new blank spell item to the actor.
   */
  static async #onAddSpell(event, target) {
    await Item.create({
      name: "New Spell",
      type: "spell",
      img: "icons/magic/light/orb-lightning-blue.webp"
    }, { parent: this.document });
  }

  /**
   * Delete a spell item from the actor.
   */
  static async #onDeleteSpell(event, target) {
    const itemId = target.dataset.itemId;
    const item = this.document.items.get(itemId);
    if ( item ) await item.delete();
  }

  /**
   * Create a new spellbook item on the actor.
   */
  static async #onAddSpellbook(event, target) {
    await Item.create({
      name: "Spell Book",
      type: "spellbook",
      img: "icons/sundries/books/book-worn-brown.webp",
      system: {
        folios: 5,
        cost: 1,
        slotOptions: { pack: 2 }
      }
    }, { parent: this.document });
  }

  /**
   * Delete a spellbook item and clear spellbookId from any referencing spells.
   */
  static async #onDeleteSpellbook(event, target) {
    const itemId = target.dataset.itemId;
    const item = this.document.items.get(itemId);
    if ( !item ) return;

    // Clear spellbookId on any spells referencing this spellbook
    const updates = [];
    for ( const spell of (this.document.itemTypes.spell || []) ) {
      if ( spell.system.spellbookId === itemId ) {
        updates.push({ _id: spell.id, "system.spellbookId": "" });
      }
    }
    if ( updates.length ) await this.document.updateEmbeddedDocuments("Item", updates);
    await item.delete();
  }

  /**
   * Add a new scroll item to the actor. Shows a dialog to pick which spell to scribe.
   */
  static async #onAddScroll(event, target) {
    const spellItems = this.document.itemTypes.spell || [];
    if ( !spellItems.length ) {
      ui.notifications.warn(game.i18n.localize("TB2E.Scroll.NoSpells"));
      return;
    }
    const options = spellItems.map(s => `<option value="${s.id}">${s.name}</option>`).join("");
    const content = `<form><div class="form-group"><label>${game.i18n.localize("TB2E.Scroll.ChooseSpell")}</label><select name="spellId">${options}</select></div></form>`;
    const spellId = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize("TB2E.Scroll.AddScroll") },
      content,
      ok: {
        label: game.i18n.localize("TB2E.Scroll.AddScroll"),
        icon: "fa-solid fa-scroll",
        callback: (event, button, dialog) => button.form?.elements.spellId?.value
      }
    });
    if ( !spellId ) return;
    const spell = this.document.items.get(spellId);
    if ( !spell ) return;
    await Item.create({
      name: `Scroll of ${spell.name}`,
      type: "scroll",
      img: "icons/sundries/scrolls/scroll-bound-ruby-red.webp",
      system: { spellId: spell.id, cost: 1, slotOptions: { pack: 1, carried: 1 } }
    }, { parent: this.document });
  }

  /**
   * Delete a scroll item from the actor.
   */
  static async #onDeleteScroll(event, target) {
    const itemId = target.dataset.itemId;
    const item = this.document.items.get(itemId);
    if ( item ) await item.delete();
  }

  /**
   * Add a new blank invocation item to the actor.
   */
  static async #onAddInvocation(event, target) {
    await Item.create({
      name: "New Invocation",
      type: "invocation",
      img: "icons/magic/holy/prayer-hands-glowing-yellow.webp"
    }, { parent: this.document });
  }

  /**
   * Delete an invocation item from the actor.
   */
  static async #onDeleteInvocation(event, target) {
    const itemId = target.dataset.itemId;
    const item = this.document.items.get(itemId);
    if ( item ) await item.delete();
  }

  /**
   * Perform an invocation. Delegates to the invocation-casting flow.
   */
  static async #onPerformInvocation(event, target) {
    const itemId = target.dataset.itemId;
    const item = this.document.items.get(itemId);
    if ( !item ) return;
    return performInvocation(this.document, item);
  }

  static async #onAddRelic(event, target) {
    await Item.create({
      name: "New Relic",
      type: "relic",
      img: "icons/sundries/misc/gem-faceted-round-white.webp"
    }, { parent: this.document });
  }

  static async #onDeleteRelic(event, target) {
    const itemId = target.dataset.itemId;
    const item = this.document.items.get(itemId);
    if ( item ) await item.delete();
  }

  /**
   * Cast a spell. Determines casting source and delegates to the casting flow.
   */
  static async #onCastSpell(event, target) {
    const itemId = target.dataset.itemId;
    const item = this.document.items.get(itemId);
    if ( !item ) return;

    // Skill-swap spells don't consume a source
    if ( item.system.castingType === "skillSwap" ) {
      return castSpell(this.document, item, "memory");
    }

    // Determine available sources
    const sources = [];
    if ( item.system.memorized ) sources.push({ action: "memory", label: game.i18n.localize("TB2E.Spell.CastFromMemory"), icon: "fa-solid fa-brain" });
    if ( item.system.spellbookId ) sources.push({ action: "spellbook", label: game.i18n.localize("TB2E.Spell.CastFromSpellbook"), icon: "fa-solid fa-book" });
    const scrollsForSpell = (this.document.itemTypes.scroll || []).filter(s => s.system.spellId === item.id);
    if ( scrollsForSpell.length ) sources.push({ action: "scroll", label: game.i18n.localize("TB2E.Spell.CastFromScroll"), icon: "fa-solid fa-scroll" });

    if ( sources.length === 0 ) {
      ui.notifications.warn(game.i18n.localize("TB2E.Spell.NotMemorizedOrScroll"));
      return;
    }

    let source;
    if ( sources.length === 1 ) {
      source = sources[0].action;
    } else {
      source = await foundry.applications.api.DialogV2.wait({
        window: { title: game.i18n.localize("TB2E.Spell.CastSource") },
        content: `<p>${game.i18n.localize("TB2E.Spell.CastSourcePrompt")}</p>`,
        buttons: sources.map(s => ({ action: s.action, label: s.label, icon: s.icon })),
        close: () => null
      });
      if ( !source ) return;
    }

    const opts = {};
    if ( source === "scroll" && scrollsForSpell.length ) opts.scrollItemId = scrollsForSpell[0].id;
    return castSpell(this.document, item, source, opts);
  }

  /* -------------------------------------------- */
  /*  Inventory Action Handlers                   */
  /* -------------------------------------------- */

  /**
   * Remove an item from its current slot (goes to unassigned).
   * If the item is a container, cascade its children to unassigned.
   */
  static async #onRemoveFromSlot(event, target) {
    const itemId = target.dataset.itemId;
    const item = this.document.items.get(itemId);
    if ( !item ) return;

    // Children inside a container keep their slot/slotIndex so they stay
    // associated with the container when it is unequipped.
    await item.update({ "system.slot": "", "system.slotIndex": 0 });
  }

  /**
   * Drop an item on the ground.
   * If container, also drop contents.
   */
  static async #onDropItem(event, target) {
    const itemId = target.dataset.itemId;
    const item = this.document.items.get(itemId);
    if ( !item ) return;

    const updates = [{ _id: item.id, "system.slot": "", "system.slotIndex": 0, "system.dropped": true }];

    // If container, mark children as dropped but preserve their slot/slotIndex
    // so items stay "inside" the dropped container.
    if ( item.type === "container" ) {
      const containerKey = item.system.containerKey || item.id;
      for ( const child of this.document.items ) {
        if ( child.system.slot === containerKey ) {
          updates.push({ _id: child.id, "system.dropped": true });
        }
      }
    }
    await this.document.updateEmbeddedDocuments("Item", updates);
  }

  /**
   * Pick up a dropped item (goes to unassigned).
   * If container, also un-drop children still inside it.
   */
  static async #onPickUpItem(event, target) {
    const itemId = target.dataset.itemId;
    const item = this.document.items.get(itemId);
    if ( !item ) return;

    const updates = [{ _id: item.id, "system.dropped": false }];

    if ( item.type === "container" ) {
      const containerKey = item.system.containerKey || item.id;
      for ( const child of this.document.items ) {
        if ( child.system.slot === containerKey && child.system.dropped ) {
          updates.push({ _id: child.id, "system.dropped": false });
        }
      }
    }
    await this.document.updateEmbeddedDocuments("Item", updates);
  }

  /**
   * Toggle the damaged state of an item.
   */
  static async #onToggleDamaged(event, target) {
    const itemId = target.dataset.itemId;
    const item = this.document.items.get(itemId);
    if ( !item ) return;
    await item.update({ "system.damaged": !item.system.damaged });
  }

  /**
   * Consume a portion of a supply item (food/drink).
   */
  static async #onConsumePortion(event, target) {
    const itemId = target.dataset.itemId;
    const item = this.document.items.get(itemId);
    if ( !item || item.system.quantity <= 0 ) return;
    await item.update({ "system.quantity": item.system.quantity - 1 });
    // Clear Hungry & Thirsty if active
    if ( this.document.system.conditions.hungry ) {
      await this.document.update({ "system.conditions.hungry": false });
    }
  }

  /**
   * Drink a draught from a liquid container.
   */
  static async #onDrinkDraught(event, target) {
    const itemId = target.dataset.itemId;
    const item = this.document.items.get(itemId);
    if ( !item || item.system.quantity <= 0 ) return;

    const liquidType = item.system.liquidType ?? "water";

    // Oil and holy water: just decrement, no condition effect
    if ( liquidType === "oil" || liquidType === "holyWater" ) {
      await item.update({ "system.quantity": item.system.quantity - 1 });
      return;
    }

    // Wine: present a choice dialog
    if ( liquidType === "wine" ) {
      const choice = await foundry.applications.api.DialogV2.wait({
        window: { title: game.i18n.localize("TB2E.Liquid.DrinkWineTitle") },
        content: `<p>${game.i18n.localize("TB2E.Liquid.DrinkWineContent")}</p>`,
        buttons: [
          {
            action: "quench",
            label: game.i18n.localize("TB2E.Liquid.QuenchThirst"),
            icon: "fa-solid fa-droplet"
          },
          {
            action: "bolster",
            label: game.i18n.localize("TB2E.Liquid.BolsterSpirit"),
            icon: "fa-solid fa-wine-glass"
          }
        ],
        close: () => null
      });
      if ( !choice ) return;
      await item.update({ "system.quantity": item.system.quantity - 1 });
      if ( choice === "quench" ) {
        if ( this.document.system.conditions.hungry ) {
          await this.document.update({ "system.conditions.hungry": false });
        }
      } else if ( choice === "bolster" ) {
        await this.document.setFlag("tb2e", "wineBolster", true);
        ui.notifications.info(`${this.document.name} is bolstered by wine (+1D to recover from Angry or Afraid).`);
      }
      return;
    }

    // Water (default): clear Hungry & Thirsty
    await item.update({ "system.quantity": item.system.quantity - 1 });
    if ( this.document.system.conditions.hungry ) {
      await this.document.update({ "system.conditions.hungry": false });
    }
  }

  /**
   * Toggle the liquid type of a container between water and wine.
   */
  static async #onToggleLiquidType(event, target) {
    const itemId = target.dataset.itemId;
    const item = this.document.items.get(itemId);
    if ( !item ) return;
    const current = item.system.liquidType ?? "water";
    const next = current === "water" ? "wine" : "water";
    await item.update({ "system.liquidType": next });
  }

  /**
   * Consume a turn of a lit light source.
   */
  static async #onConsumeLight(event, target) {
    const itemId = target.dataset.itemId;
    const item = this.document.items.get(itemId);
    if ( !item || item.system.turnsRemaining <= 0 ) return;
    await item.update({ "system.turnsRemaining": item.system.turnsRemaining - 1 });
  }

  /**
   * Light a source from a bundle: decrement bundle quantity, create a lit item, auto-place in hand.
   * For vessels (quantityMax === 1), simply toggle lit in place.
   */
  static async #onLightSource(event, target) {
    const itemId = target.dataset.itemId;
    const item = this.document.items.get(itemId);
    if ( !item || item.system.quantity <= 0 ) return;
    if ( (item.system.turnsRemaining ?? 0) <= 0 ) return;

    // Vessel (quantityMax === 1): light in place, no bundle consumption
    if ( (item.system.quantityMax ?? 1) <= 1 ) {
      await item.update({ "system.lit": true });
      return;
    }

    // Decrement bundle quantity
    await item.update({ "system.quantity": item.system.quantity - 1 });

    // Create lit item
    const singularName = item.system.nameSingular || item.name;
    const [created] = await Item.create([{
      name: singularName,
      type: "supply",
      img: item.img,
      system: {
        description: item.system.description,
        slotOptions: { carried: 1 },
        cost: 0,
        quantity: 1, quantityMax: 1,
        supplyType: "light",
        turnsRemaining: item.system.turnsRemaining,
        lit: true,
        nameSingular: singularName,
        skillBonuses: []
      }
    }], { parent: this.document });

    // Try to auto-place in a hand carried slot
    const carriedCost = getSlotCost(created.system.slotOptions, "carried");
    if ( carriedCost !== null ) {
      for ( const handKey of ["hand-L", "hand-R"] ) {
        const occupants = this.document.items.filter(i =>
          i.system.slot === handKey && i.id !== created.id
        );
        const blocked = occupants.some(i => {
          const start = i.system.slotIndex ?? 0;
          const optKey = resolveSlotOptionKey(handKey, start, false);
          const cost = getSlotCost(i.system.slotOptions, optKey) ?? 1;
          return start < 1 + carriedCost && start + cost > 1;
        });
        if ( !blocked ) {
          await this.#assignSlot(created, handKey, 1);
          return;
        }
      }
    }
    ui.notifications.info(`${singularName} is lit but both hands are full.`);
  }

  /**
   * Split one container off a bundled pair: decrement original, create a free singular clone.
   */
  static async #onSplitBundle(event, target) {
    const itemId = target.dataset.itemId;
    const item = this.document.items.get(itemId);
    if ( !item ) return;
    const qty = item.system.quantity ?? 1;
    if ( qty < 2 ) return;

    // Create one free sack in Unassigned
    const itemData = item.toObject();
    delete itemData._id;
    itemData.system.quantity = 1;
    itemData.system.quantityMax = 1;
    itemData.system.slot = "";
    itemData.system.slotIndex = 0;
    itemData.system.containerKey = "";
    await Item.create([itemData], { parent: this.document });

    // Decrement original
    await item.update({
      "system.quantity": qty - 1,
      "system.quantityMax": item.system.quantityMax - 1
    });
  }

  /**
   * Move an item to the first available hand carried slot.
   */
  static async #onMoveToHand(event, target) {
    const itemId = target.dataset.itemId;
    const item = this.document.items.get(itemId);
    if ( !item ) return;

    // Check item can be carried.
    if ( getSlotCost(item.system.slotOptions, "carried") === null ) {
      ui.notifications.warn("This item cannot be carried in hand.");
      return;
    }

    // Try each hand — check if index 1 is free (no item starts at or spans over it).
    const carriedCost = getSlotCost(item.system.slotOptions, "carried");
    for ( const handKey of ["hand-L", "hand-R"] ) {
      const occupants = this.document.items.filter(i =>
        i.system.slot === handKey && i.id !== item.id
      );
      const blocked = occupants.some(i => {
        const start = i.system.slotIndex ?? 0;
        const optKey = resolveSlotOptionKey(handKey, start, false);
        const cost = getSlotCost(i.system.slotOptions, optKey) ?? 1;
        return start < 1 + carriedCost && start + cost > 1;
      });
      if ( !blocked ) {
        await this.#assignSlot(item, handKey, 1);
        return;
      }
    }
    ui.notifications.warn("Both hands are full.");
  }

  /**
   * Open the item sheet for editing.
   */
  static #onEditItem(event, target) {
    const itemId = target.dataset.itemId;
    const item = this.document.items.get(itemId);
    if ( item ) item.sheet.render(true);
  }

  /**
   * Delete an inventory item after confirmation.
   */
  static async #onDeleteItem(event, target) {
    const itemId = target.dataset.itemId;
    const item = this.document.items.get(itemId);
    if ( !item ) return;
    await item.delete();
  }

  /**
   * Create a new inventory item via dropdown menu.
   */
  static async #onCreateItem(event, target) {
    const type = target.dataset.type || "gear";
    const defaultNames = {
      weapon: "New Weapon", armor: "New Armor", container: "New Container",
      gear: "New Gear", supply: "New Supply"
    };
    await Item.create({
      name: defaultNames[type] || "New Item",
      type
    }, { parent: this.document });
  }

  /* -------------------------------------------- */

  /**
   * Place an unassigned or dropped item into a specific slot via click.
   */
  static async #onPlaceItem(event, target) {
    const itemId = target.dataset.itemId;
    const item = this.document.items.get(itemId);
    if ( !item ) return;
    const slotKey = target.dataset.slotKey;
    const slotIndex = Number(target.dataset.slotIndex);
    await this.#assignSlot(item, slotKey, slotIndex);
  }

  /* -------------------------------------------- */

  /**
   * Compute available placement targets for an item.
   * Returns an array of { slotKey, slotIndex, label } objects.
   * @param {Item} item
   * @returns {object[]}
   */
  #getAvailablePlacements(item) {
    const so = item.system.slotOptions;
    const placements = [];

    // Map each SLOT_OPTION_KEY to concrete slot keys.
    const optionToSlots = {
      head: ["head"],
      neck: ["neck"],
      wornHand: [{ key: "hand-L", index: 0 }, { key: "hand-R", index: 0 }],
      carried: [{ key: "hand-L", index: 1 }, { key: "hand-R", index: 1 }],
      torso: ["torso"],
      belt: ["belt"],
      feet: ["feet"],
      pocket: ["pocket"]
    };

    // Check fixed slots.
    for ( const [optKey, targets] of Object.entries(optionToSlots) ) {
      const cost = getSlotCost(so, optKey);
      if ( cost === null ) continue;

      for ( const target of targets ) {
        const slotKey = typeof target === "string" ? target : target.key;
        const fixedIndex = typeof target === "string" ? null : target.index;
        const slotIndex = fixedIndex ?? this.#findFirstFit(item, slotKey, cost);
        if ( slotIndex === null ) continue;
        placements.push({ slotKey, slotIndex, label: this.#slotLabel(slotKey, fixedIndex), cost });
      }
    }

    // Check container slots (pack, quiver, pouch) — not cache.
    const equippedContainers = (this.document.itemTypes.container || []).filter(c =>
      CharacterSheet.#FIXED_SLOTS.has(c.system.slot) && !c.system.dropped && !c.system.lost && (c.system.quantityMax ?? 1) === 1
    );
    for ( const c of equippedContainers ) {
      const cType = CONFIG.TB2E.containerTypes[c.system.containerType];
      if ( cType?.liquid ) continue;
      const cKey = c.system.containerKey || c.id;
      const ct = c.system.containerType;
      const containerOptKey = ct === "quiver" ? "quiver" : ct === "pouch" ? "pouch" : "pack";
      const cost = getSlotCost(so, containerOptKey);
      if ( cost === null ) continue;
      const slotIndex = this.#findFirstFit(item, cKey, cost);
      if ( slotIndex !== null ) {
        placements.push({ slotKey: cKey, slotIndex, label: c.name, cost });
      }
    }

    // Cache — any item can be stashed.
    const cacheCost = getCacheCost(so);
    const cacheIndex = this.#findFirstFit(item, "cache", cacheCost);
    if ( cacheIndex !== null ) {
      placements.push({ slotKey: "cache", slotIndex: cacheIndex, label: "Cache", cost: cacheCost });
    }

    return placements;
  }

  /**
   * Look up the containerType for an equipped container by its slot key.
   * @param {string} slotKey
   * @returns {string|null}
   */
  #containerTypeForSlot(slotKey) {
    const container = this.document.items.find(i =>
      i.type === "container" && (i.system.containerKey || i.id) === slotKey
    );
    return container?.system.containerType ?? null;
  }

  /**
   * Find the first slot index in a group where an item of the given cost fits.
   * @param {Item} item - The item to place (excluded from occupant checks).
   * @param {string} slotKey - The slot group key.
   * @param {number} cost - Number of slots needed.
   * @returns {number|null} The first valid slot index, or null if none fits.
   */
  #findFirstFit(item, slotKey, cost) {
    const capacity = this.#getSlotCapacity(slotKey);
    if ( capacity === null ) return null;
    const isContainer = !["head", "neck", "hand-L", "hand-R", "torso", "belt", "feet", "pocket"].includes(slotKey)
      && slotKey !== "cache";
    const containerType = isContainer ? this.#containerTypeForSlot(slotKey) : null;

    const occupants = this.document.items.filter(i =>
      i.system.slot === slotKey && i.id !== item.id
    );

    // Build an occupied-ranges array.
    const occupied = occupants.map(i => {
      const start = i.system.slotIndex ?? 0;
      const occOptKey = resolveSlotOptionKey(slotKey, start, isContainer, containerType);
      const occCost = getSlotCost(i.system.slotOptions, occOptKey) ?? 1;
      return { start, end: start + occCost };
    });

    for ( let idx = 0; idx + cost <= capacity; idx++ ) {
      const end = idx + cost;
      const blocked = occupied.some(o => idx < o.end && end > o.start);
      if ( !blocked ) return idx;
    }
    return null;
  }

  /**
   * Human-readable label for a concrete slot key.
   * @param {string} slotKey
   * @param {number|null} fixedIndex - If provided, refines the label (e.g. worn vs carried).
   * @returns {string}
   */
  #slotLabel(slotKey, fixedIndex = null) {
    if ( slotKey === "hand-L" ) return fixedIndex === 0 ? "Worn L" : "L Hand";
    if ( slotKey === "hand-R" ) return fixedIndex === 0 ? "Worn R" : "R Hand";
    const fixed = {
      head: "Head", neck: "Neck", torso: "Torso",
      belt: "Belt", feet: "Feet", pocket: "Pocket", cache: "Cache"
    };
    if ( fixed[slotKey] ) return fixed[slotKey];
    const container = this.document.items.find(i =>
      i.type === "container" && (i.system.containerKey || i.id) === slotKey
    );
    return container?.name ?? slotKey;
  }

  /* -------------------------------------------- */

  /**
   * Assign an item to a slot. Validates capacity.
   * @param {Item} item
   * @param {string} slotKey
   * @param {number} slotIndex
   */
  async #assignSlot(item, slotKey, slotIndex) {
    // Determine whether this is a container slot.
    const isContainer = !["head", "neck", "hand-L", "hand-R", "torso", "belt", "feet", "pocket"].includes(slotKey);
    const containerType = isContainer && slotKey !== "cache" ? this.#containerTypeForSlot(slotKey) : null;

    // Resolve which slotOptions key applies and check placement is allowed.
    const optionKey = resolveSlotOptionKey(slotKey, slotIndex, isContainer, containerType);
    let needed = getSlotCost(item.system.slotOptions, optionKey);
    if ( needed === null && slotKey === "cache" ) {
      needed = getCacheCost(item.system.slotOptions);
    }
    if ( needed === null ) {
      ui.notifications.warn(`This item cannot be placed in ${slotKey}.`);
      return;
    }

    // Find how many slots are already occupied in this group.
    const occupants = this.document.items.filter(i =>
      i.system.slot === slotKey && i.id !== item.id
    );

    // Find the slot group definition to determine capacity.
    const groupCapacity = this.#getSlotCapacity(slotKey);
    if ( groupCapacity === null ) return;

    // Check available space — resolve each occupant's cost at this location.
    const usedSlots = occupants.reduce((sum, i) => {
      const occOptKey = resolveSlotOptionKey(slotKey, i.system.slotIndex ?? 0, isContainer, containerType);
      return sum + (getSlotCost(i.system.slotOptions, occOptKey) ?? 1);
    }, 0);
    if ( usedSlots + needed > groupCapacity ) {
      ui.notifications.warn("Not enough room in that slot.");
      return;
    }

    // Check positional fit: item must not overflow past the end of the group.
    if ( slotIndex + needed > groupCapacity ) {
      ui.notifications.warn("Not enough room at that position.");
      return;
    }

    // Check positional fit: item must not overlap with existing occupants.
    for ( const occ of occupants ) {
      const occStart = occ.system.slotIndex ?? 0;
      const occOptKey = resolveSlotOptionKey(slotKey, occStart, isContainer, containerType);
      const occEnd = occStart + (getSlotCost(occ.system.slotOptions, occOptKey) ?? 1);
      if ( slotIndex < occEnd && slotIndex + needed > occStart ) {
        ui.notifications.warn("Not enough room at that position.");
        return;
      }
    }

    // Belt restriction: no bundled items.
    if ( slotKey === "belt" && (item.system.quantityMax ?? 1) > 1 ) {
      ui.notifications.warn("Belt slots cannot hold bundled items.");
      return;
    }

    const updates = [{ _id: item.id, "system.slot": slotKey, "system.slotIndex": slotIndex, "system.dropped": false }];

    // If placing a container, un-drop any children still referencing it.
    if ( item.type === "container" ) {
      const containerKey = item.system.containerKey || item.id;
      for ( const child of this.document.items ) {
        if ( child.system.slot === containerKey && child.system.dropped ) {
          updates.push({ _id: child.id, "system.dropped": false });
        }
      }
    }
    await this.document.updateEmbeddedDocuments("Item", updates);
  }

  /**
   * Get the capacity of a slot group by key.
   * @param {string} slotKey
   * @returns {number|null}
   */
  #getSlotCapacity(slotKey) {
    const fixedCapacities = {
      head: 1, neck: 1, "hand-L": 2, "hand-R": 2,
      torso: 3, belt: 3, feet: 1, pocket: 1, cache: 12
    };
    if ( slotKey in fixedCapacities ) return fixedCapacities[slotKey];

    // Check container-provided slots.
    for ( const item of this.document.items ) {
      if ( item.type !== "container" ) continue;
      const cKey = item.system.containerKey || item.id;
      if ( cKey === slotKey ) return item.system.containerSlots;
    }
    return null;
  }

  /* -------------------------------------------- */
  /*  Drag-and-Drop                               */
  /* -------------------------------------------- */

  /** @override */
  async _onDropItem(event, item) {
    // Find the drop target slot.
    const dropTarget = event.target.closest("[data-slot-key]");

    // If the item is from another source, create it on this actor first.
    let ownedItem;
    if ( this.actor.uuid === item.parent?.uuid ) {
      ownedItem = item;
    } else {
      const result = await super._onDropItem(event, item);
      ownedItem = result;
    }
    if ( !ownedItem ) return null;

    // If dropped onto a slot, assign it.
    if ( dropTarget ) {
      const slotKey = dropTarget.dataset.slotKey;
      const slotIndex = Number(dropTarget.dataset.slotIndex ?? 0);
      await this.#assignSlot(ownedItem, slotKey, slotIndex);
    }
    return ownedItem;
  }

  /* -------------------------------------------- */
  /*  Nature Action Handlers                      */
  /* -------------------------------------------- */

  /**
   * Conserve Nature: reduce max by 1, restore current to new max, clear advancement.
   */
  static async #onConserveNature(event, target) {
    const sys = this.document.system;
    if ( sys.abilities.nature.max <= 1 ) return;

    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("TB2E.Nature.Conserve") },
      content: `<p>${game.i18n.localize("TB2E.Nature.ConserveConfirm")}</p>`,
      yes: { default: true }
    });
    if ( !confirmed ) return;

    const newMax = sys.abilities.nature.max - 1;
    await this.document.update({
      "system.abilities.nature.max": newMax,
      "system.abilities.nature.rating": newMax,
      "system.abilities.nature.pass": 0,
      "system.abilities.nature.fail": 0
    });
  }

  /**
   * Recover 1 point of taxed Nature (up to max).
   */
  static #onRecoverNature(event, target) {
    const sys = this.document.system;
    if ( sys.abilities.nature.rating >= sys.abilities.nature.max ) return;
    this.document.update({
      "system.abilities.nature.rating": sys.abilities.nature.rating + 1
    });
  }

  /**
   * Add a nature descriptor.
   */
  static #onAddDescriptor(event, target) {
    const section = target.closest(".nature-descriptors");
    const input = section?.querySelector(".descriptor-input");
    const value = input?.value?.trim();
    if ( !value ) return;
    const descriptors = [...(this.document.system.natureDescriptors || []), value];
    input.value = "";
    this.document.update({ "system.natureDescriptors": descriptors });
  }

  /* -------------------------------------------- */
  /*  Session Reset                                */
  /* -------------------------------------------- */

  /**
   * Reset trait uses for a new session after confirmation.
   */
  static #onSetLightLevel(event, target) {
    const level = target.dataset.level;
    this.document.update({ "system.lightLevel": level });
  }

  static async #onResetSession(event, target) {
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("TB2E.Session.Reset") },
      content: `<p>${game.i18n.localize("TB2E.Session.ResetConfirm")}</p>`,
      yes: { default: true }
    });
    if ( !confirmed ) return;
    await resetTraitsForSession(this.document);
    ui.notifications.info(game.i18n.localize("TB2E.Session.ResetDone"));
  }

  /**
   * Remove a nature descriptor by index.
   */
  static #onRemoveDescriptor(event, target) {
    const index = Number(target.dataset.index);
    const descriptors = [...(this.document.system.natureDescriptors || [])];
    descriptors.splice(index, 1);
    this.document.update({ "system.natureDescriptors": descriptors });
  }

  /**
   * Open the character creation wizard.
   * @this {CharacterSheet}
   */
  static #onOpenWizard() {
    new CharacterWizard(this.document).render(true);
  }
}
