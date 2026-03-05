import TB2E from "./module/config.mjs";
import * as dataModels from "./module/data/_module.mjs";
import * as documents from "./module/documents/_module.mjs";
import * as applications from "./module/applications/_module.mjs";
import * as dice from "./module/dice/_module.mjs";
import { PendingVersusRegistry, resolveVersus, processVersusFinalize, handleTraitBreakTie, handleLevel3TraitBreakTie } from "./module/dice/versus.mjs";
import { activatePostRollListeners, activateNatureCrisisListeners, activateWiseAdvancementListeners, processSynergyMailbox, processWiseAdvancementMailbox } from "./module/dice/post-roll.mjs";

Hooks.once("init", function() {
  globalThis.tb2e = game.tb2e = { dice };

  CONFIG.TB2E = TB2E;

  // Assign document classes.
  CONFIG.Actor.documentClass = documents.TB2EActor;
  CONFIG.Combat.documentClass = documents.TB2ECombat;

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

  // Preload templates.
  loadTemplates([
    "systems/tb2e/templates/dice/roll-dialog.hbs",
    "systems/tb2e/templates/chat/roll-result.hbs",
    "systems/tb2e/templates/chat/versus-pending.hbs",
    "systems/tb2e/templates/chat/versus-resolution.hbs",
    "systems/tb2e/templates/chat/advancement-result.hbs",
    "systems/tb2e/templates/conflict/conflict-window.hbs",
    "systems/tb2e/templates/chat/nature-crisis.hbs",
    "systems/tb2e/templates/chat/versus-tied.hbs",
    "systems/tb2e/templates/chat/wise-advancement.hbs"
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

// Activate post-roll action buttons on chat cards.
Hooks.on("renderChatMessageHTML", (message, html) => {
  activatePostRollListeners(message, html);
  activateNatureCrisisListeners(message, html);
  activateWiseAdvancementListeners(message, html);

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
});

// Auto-assign combatants to the correct team group when added to a conflict.
Hooks.on("preCreateCombatant", (combatant, data, options, userId) => {
  const combat = combatant.parent;
  if ( !combat?.isConflict ) return;

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
