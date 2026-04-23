import TB2E from "./module/config.mjs";
import * as dataModels from "./module/data/_module.mjs";
import * as documents from "./module/documents/_module.mjs";
import * as applications from "./module/applications/_module.mjs";
import * as dice from "./module/dice/_module.mjs";
import { PendingVersusRegistry, resolveVersus, processVersusFinalize, handleTraitBreakTie, handleLevel3TraitBreakTie } from "./module/dice/versus.mjs";
import { activatePostRollListeners, activateNatureCrisisListeners, activateWiseAdvancementListeners, processSynergyMailbox, processWiseAdvancementMailbox } from "./module/dice/post-roll.mjs";
import { activateSpellSourceListeners } from "./module/dice/spell-casting.mjs";
import { activateBurdenListeners } from "./module/dice/invocation-casting.mjs";
import { activateGrindConditionListeners, processGrindApplyMailbox } from "./module/applications/grind-tracker.mjs";
import WizardCompendiumsConfig from "./module/applications/settings/wizard-compendiums-config.mjs";

Hooks.once("init", function() {
  globalThis.tb2e = game.tb2e = { dice, conflictPanel: null, grindTracker: null };

  // Register grind tracker world settings.
  game.settings.register("tb2e", "grindPhase", { scope: "world", config: false, type: String, default: "adventure" });
  game.settings.register("tb2e", "grindTurn", { scope: "world", config: false, type: Number, default: 1 });
  game.settings.register("tb2e", "grindExtreme", { scope: "world", config: false, type: Boolean, default: false });

  // Register wizard compendium pack overrides.
  game.settings.register("tb2e", "wizardCompendiums", {
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });
  game.settings.registerMenu("tb2e", "wizardCompendiums", {
    name: "TB2E.Settings.WizardCompendiums.Name",
    label: "TB2E.Settings.WizardCompendiums.Label",
    hint: "TB2E.Settings.WizardCompendiums.Hint",
    icon: "fa-solid fa-book",
    type: WizardCompendiumsConfig,
    restricted: true
  });

  CONFIG.TB2E = TB2E;

  // Assign document classes.
  CONFIG.Actor.documentClass = documents.TB2EActor;
  CONFIG.Combat.documentClass = documents.TB2ECombat;
  CONFIG.RollTable.documentClass = documents.TB2ELootTable;

  // Assign data models.
  CONFIG.Actor.dataModels = dataModels.actor.config;
  CONFIG.Item.dataModels = dataModels.item.config;
  CONFIG.Combat.dataModels = dataModels.combat.config;
  CONFIG.Combatant.dataModels = dataModels.combat.combatantConfig;

  // Configure trackable token bar attributes.
  CONFIG.Actor.trackableAttributes = {
    character: {
      bar: ["conflict.hp"],
      value: []
    },
    monster: {
      bar: ["conflict.hp"],
      value: []
    },
    npc: {
      bar: ["conflict.hp"],
      value: []
    }
  };

  // Replace the combat tracker sidebar with the conflict tracker.
  CONFIG.ui.combat = applications.conflict.ConflictTracker;

  // Register sheets.
  const DSC = foundry.applications.apps.DocumentSheetConfig;
  DSC.unregisterSheet(Actor, "core", foundry.appv1.sheets.ActorSheet);
  DSC.registerSheet(Actor, "tb2e", applications.actor.CharacterSheet, {
    types: ["character"],
    makeDefault: true,
    label: "TB2E.SheetCharacter"
  });
  DSC.registerSheet(Actor, "tb2e", applications.actor.MonsterSheet, {
    types: ["monster"],
    makeDefault: true,
    label: "TB2E.SheetMonster"
  });
  DSC.registerSheet(Actor, "tb2e", applications.actor.NPCSheet, {
    types: ["npc"],
    makeDefault: true,
    label: "TB2E.SheetNPC"
  });
  DSC.unregisterSheet(Item, "core", foundry.appv1.sheets.ItemSheet);
  DSC.registerSheet(Item, "tb2e", applications.item.GearSheet, {
    types: ["weapon", "armor", "container", "gear", "supply", "spellbook", "scroll", "relic"],
    makeDefault: true,
    label: "TB2E.SheetGear"
  });
  DSC.registerSheet(Item, "tb2e", applications.item.SpellSheet, {
    types: ["spell"],
    makeDefault: true,
    label: "TB2E.SheetSpell"
  });
  DSC.registerSheet(Item, "tb2e", applications.item.InvocationSheet, {
    types: ["invocation"],
    makeDefault: true,
    label: "TB2E.SheetInvocation"
  });

  // Preload grind tracker template.
  foundry.applications.handlebars.loadTemplates(["systems/tb2e/templates/grind-tracker.hbs"]);

  // Preload templates.
  foundry.applications.handlebars.loadTemplates([
    "systems/tb2e/templates/dice/roll-dialog.hbs",
    "systems/tb2e/templates/chat/roll-result.hbs",
    "systems/tb2e/templates/chat/versus-pending.hbs",
    "systems/tb2e/templates/chat/versus-resolution.hbs",
    "systems/tb2e/templates/chat/advancement-result.hbs",
    "systems/tb2e/templates/chat/nature-crisis.hbs",
    "systems/tb2e/templates/chat/versus-tied.hbs",
    "systems/tb2e/templates/chat/wise-advancement.hbs",
    "systems/tb2e/templates/items/gear-sheet.hbs",
    "systems/tb2e/templates/items/spell-sheet.hbs",
    "systems/tb2e/templates/items/invocation-sheet.hbs",
    "systems/tb2e/templates/dice/spell-factors.hbs",
    "systems/tb2e/templates/chat/spell-source.hbs",
    "systems/tb2e/templates/chat/burden-exceeded.hbs",
    "systems/tb2e/templates/chat/conflict-declaration.hbs",
    "systems/tb2e/templates/chat/conflict-action-reveal.hbs",
    "systems/tb2e/templates/chat/conflict-round-summary.hbs",
    "systems/tb2e/templates/chat/conflict-compromise.hbs",
    "systems/tb2e/templates/chat/torch-expired.hbs",
    "systems/tb2e/templates/chat/grind-tick.hbs",
    "systems/tb2e/templates/chat/grind-condition.hbs",
    "systems/tb2e/templates/chat/grind-consolidated.hbs",
    "systems/tb2e/templates/chat/loot-draw.hbs"
  ]);

  console.log("Torchbearer 2E | System initialized.");
});

// Rebuild versus registry after world data is ready.
Hooks.once("ready", () => {
  PendingVersusRegistry.rebuild();
});

// Auto-resolve versus tests when opponent's roll message is created (GM-only).
Hooks.on("createChatMessage", (message) => {
  if ( !game.user.isGM ) return;
  resolveVersus(message);
});

// Sync versus challenges to all clients so opponents can see them in the roll dialog.
Hooks.on("createChatMessage", (message) => {
  const vs = message.getFlag("tb2e", "versus");
  if ( vs?.type === "initiator" && !vs.resolved ) {
    PendingVersusRegistry.register(message.id);
  }
});

// Activate post-roll action buttons on chat cards.
Hooks.on("renderChatMessageHTML", (message, html) => {
  activatePostRollListeners(message, html);
  activateNatureCrisisListeners(message, html);
  activateWiseAdvancementListeners(message, html);
  activateSpellSourceListeners(message, html);
  activateBurdenListeners(message, html);
  activateGrindConditionListeners(message, html);

  // Versus tied card actions
  const vs = message.getFlag("tb2e", "versus");
  if ( vs?.type === "tied" && !message.getFlag("tb2e", "tiedResolved") ) {
    for ( const btn of html.querySelectorAll("[data-action='trait-break-tie']") ) {
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        handleTraitBreakTie(message, btn.dataset.actorId, btn.dataset.traitId);
      });
    }
    for ( const btn of html.querySelectorAll("[data-action='level3-break-tie']") ) {
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        handleLevel3TraitBreakTie(message, btn.dataset.actorId, btn.dataset.traitId);
      });
    }
  }
});

// Process synergy mailbox: player writes pendingSynergy flag, GM picks it up here.
// Process wise advancement mailbox: player writes pendingWiseAdvancement flag, GM picks it up.
Hooks.on("updateActor", (actor, changes, options, userId) => {
  if ( !game.user.isGM ) return;
  const pending = changes.flags?.tb2e?.pendingSynergy;
  if ( pending?.messageId ) processSynergyMailbox(actor, pending);
  const pendingWise = changes.flags?.tb2e?.pendingWiseAdvancement;
  if ( pendingWise?.field ) processWiseAdvancementMailbox(actor, pendingWise);
  const pendingVersus = changes.flags?.tb2e?.pendingVersusFinalize;
  if ( pendingVersus?.messageId ) processVersusFinalize(actor, pendingVersus);
  const pendingHP = changes.flags?.tb2e?.pendingConflictHP;
  if ( pendingHP?.newValue != null ) {
    // Support targetActorId for captain editing another player's HP.
    // For the targetActorId branch, prefer the synthetic actor from an
    // active conflict combatant (per CLAUDE.md §Unlinked Actors) — if a
    // conflict combat has a combatant wrapping this actor id via a token,
    // `combatant.actor` resolves to the synthetic (unlinked case) or the
    // world actor (linked case). Falling through to `game.actors.get` only
    // when no combatant match exists keeps flat/outside-conflict writes
    // working unchanged.
    let targetActor = actor;
    if ( pendingHP.targetActorId ) {
      targetActor = null;
      for ( const combat of game.combats ?? [] ) {
        if ( !combat.isConflict ) continue;
        for ( const cmb of combat.combatants ) {
          if ( cmb.actorId === pendingHP.targetActorId && cmb.actor ) {
            targetActor = cmb.actor;
            break;
          }
        }
        if ( targetActor ) break;
      }
      if ( !targetActor ) targetActor = game.actors.get(pendingHP.targetActorId);
    }
    if ( targetActor ) {
      const max = targetActor.system.conflict?.hp?.max || 0;
      const newVal = Math.max(0, Math.min(pendingHP.newValue, max));
      targetActor.update({ "system.conflict.hp.value": newVal }).then(() => {
        actor.unsetFlag("tb2e", "pendingConflictHP");
      });
    }
  }

  // Flip Combatant.system.knockedOut when HP crosses 0 in either direction.
  // This observes any `system.conflict.hp.value` change (including the
  // pendingConflictHP mailbox's inner update above, the versus.mjs
  // auto-damage path, and direct actor.update calls from roster inputs or
  // initial disposition). Mirrors the help-blocking predicate at
  // module/dice/help.mjs L57 (`hp.value <= 0 && hp.max > 0`) so combatant-
  // level `.knockedOut` stays coherent with the HP predicate that consumers
  // (conflict-panel, conflict-tracker, swap eligibility, etc.) rely on.
  const hpChange = changes.system?.conflict?.hp;
  if ( hpChange !== undefined && (hpChange.value !== undefined || hpChange.max !== undefined) ) {
    const newHp = actor.system.conflict?.hp;
    const ko = (newHp?.max ?? 0) > 0 && (newHp?.value ?? 0) <= 0;
    for ( const combat of game.combats ?? [] ) {
      if ( !combat.isConflict ) continue;
      for ( const cmb of combat.combatants ) {
        if ( cmb.actorId !== actor.id ) continue;
        if ( cmb.system.knockedOut !== ko ) {
          cmb.update({ "system.knockedOut": ko });
        }
      }
    }
  }

  const pendingCaptain = changes.flags?.tb2e?.pendingCaptainReassign;
  if ( pendingCaptain?.newCaptainId ) {
    const combat = game.combats?.find(c => c.isConflict);
    if ( combat ) {
      const newCaptain = combat.combatants.get(pendingCaptain.newCaptainId);
      if ( newCaptain && newCaptain._source.group === pendingCaptain.groupId && !newCaptain.system.knockedOut ) {
        combat.setCaptain(pendingCaptain.groupId, pendingCaptain.newCaptainId).then(() => {
          actor.unsetFlag("tb2e", "pendingCaptainReassign");
        });
      }
    }
  }

  const pendingSkill = changes.flags?.tb2e?.pendingChosenSkill;
  if ( pendingSkill?.skillKey ) {
    const combat = game.combats?.find(c => c.isConflict);
    if ( combat ) {
      const gd = foundry.utils.deepClone(combat.system.groupDispositions || {});
      if ( !gd[pendingSkill.groupId] ) gd[pendingSkill.groupId] = {};
      gd[pendingSkill.groupId].chosenSkill = pendingSkill.skillKey;
      combat.update({ "system.groupDispositions": gd }).then(() => {
        actor.unsetFlag("tb2e", "pendingChosenSkill");
      });
    }
  }

  const pendingExtinguish = changes.flags?.tb2e?.pendingLightExtinguish;
  if ( pendingExtinguish ) {
    const extSceneActorIds = new Set((canvas?.scene?.tokens ?? []).map(t => t.actorId).filter(Boolean));
    const covered = game.actors.filter(a =>
      a.type === "character" &&
      extSceneActorIds.has(a.id) &&
      a.getFlag("tb2e", "grindCoveredBy") === actor.id
    );
    Promise.all(covered.map(a => a.update({ "system.lightLevel": "dark" }))).then(() => {
      actor.unsetFlag("tb2e", "pendingLightExtinguish");
    });
  }

  const pendingGrindApply = changes.flags?.tb2e?.pendingGrindApply;
  if ( pendingGrindApply ) processGrindApplyMailbox(actor, pendingGrindApply);

});

// When a light source goes out, set covered characters to darkness.
Hooks.on("updateItem", async (item, changes) => {
  if (
    item.type !== "supply" ||
    item.system?.supplyType !== "light" ||
    changes.system?.lit !== false
  ) return;
  const holder = item.parent;
  if ( !holder ) return;

  if ( game.user.isGM ) {
    const itemSceneActorIds = new Set((canvas?.scene?.tokens ?? []).map(t => t.actorId).filter(Boolean));
    const covered = game.actors.filter(a =>
      a.type === "character" &&
      itemSceneActorIds.has(a.id) &&
      a.getFlag("tb2e", "grindCoveredBy") === holder.id
    );
    for ( const a of covered ) await a.update({ "system.lightLevel": "dark" });
  } else if ( holder.isOwner ) {
    await holder.setFlag("tb2e", "pendingLightExtinguish", true);
  }
});

// Auto-open ConflictPanel when conflict transitions to disposition phase.
Hooks.on("updateCombat", (combat, changes) => {
  if ( !combat.isConflict ) return;
  if ( changes.system?.phase === "disposition" ) {
    const panel = applications.conflict.ConflictPanel.getInstance();
    if ( !panel.rendered ) panel.render({ force: true });
  }
});

// Add Grind Tracker button to the tokens scene controls toolbar (GM only).
Hooks.on("getSceneControlButtons", (controls) => {
  const tokens = controls["tokens"];
  if ( !tokens ) return;
  tokens.tools["grind-tracker"] = {
    name: "grind-tracker",
    title: "TB2E.GrindTracker.Title",
    icon: "fa-solid fa-hourglass-half",
    button: true,
    visible: true,
    onChange: () => {
      const tracker = applications.GrindTracker.getInstance();
      if ( tracker.rendered ) tracker.close();
      else tracker.render({ force: true });
    }
  };
});

// Auto-assign combatants to the correct team group when added to a conflict.
Hooks.on("preCreateCombatant", (combatant, data, options, userId) => {
  const combat = combatant.parent;
  if ( !combat?.isConflict ) return;

  // Prevent duplicate combatants for the same actor (safety net for all creation paths).
  if ( data.actorId && combat.combatants.find(c => c.actorId === data.actorId) ) {
    return false;
  }

  // If a group is already set, keep it.
  if ( data.group ) return;

  // Resolve team from actor disposition or token disposition.
  const actor = game.actors.get(data.actorId);
  let team = actor?.system?.conflict?.team;

  // Fallback: derive from token disposition.
  if ( !team && data.tokenId ) {
    const token = canvas.tokens?.get(data.tokenId);
    if ( token ) {
      team = token.document.disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY ? "party" : "gm";
    }
  }

  if ( !team ) team = "gm";

  // Map team to group ID: first group = party, second group = gm.
  const groups = Array.from(combat.groups);
  if ( groups.length < 2 ) return;
  const targetGroupId = team === "party" ? groups[0].id : groups[1].id;
  combatant.updateSource({ group: targetGroupId });
});
