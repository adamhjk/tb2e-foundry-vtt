import TB2E from "./module/config.mjs";
import * as dataModels from "./module/data/_module.mjs";
import * as documents from "./module/documents/_module.mjs";
import * as applications from "./module/applications/_module.mjs";
import * as dice from "./module/dice/_module.mjs";
import { PendingVersusRegistry, resolveVersus } from "./module/dice/versus.mjs";

Hooks.once("init", function() {
  globalThis.tb2e = game.tb2e = { dice };

  CONFIG.TB2E = TB2E;

  // Assign document classes.
  CONFIG.Actor.documentClass = documents.TB2EActor;
  CONFIG.Combat.documentClass = documents.TB2ECombat;

  // Assign data models.
  CONFIG.Actor.dataModels = dataModels.actor.config;
  CONFIG.Combat.dataModels = dataModels.combat.config;
  CONFIG.Combatant.dataModels = dataModels.combat.combatantConfig;

  // Configure trackable token bar attributes.
  CONFIG.Actor.trackableAttributes = {
    character: {
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

  // Preload templates.
  loadTemplates([
    "systems/tb2e/templates/dice/roll-dialog.hbs",
    "systems/tb2e/templates/chat/roll-result.hbs",
    "systems/tb2e/templates/chat/versus-pending.hbs",
    "systems/tb2e/templates/chat/versus-resolution.hbs",
    "systems/tb2e/templates/conflict/conflict-window.hbs"
  ]);

  console.log("Torchbearer 2E | System initialized.");
});

// Rebuild versus registry after world data is ready and register socket listener.
Hooks.once("ready", () => {
  PendingVersusRegistry.rebuild();

  // Socket relay: GM processes disposition roll storage requests from players.
  game.socket.on("system.tb2e", async (data) => {
    if ( !game.user.isGM ) return;
    if ( data.action === "storeDispositionRoll" ) {
      const combat = game.combats.get(data.combatId);
      if ( combat ) await combat.storeDispositionRoll(data.groupId, data.result);
    }
  });
});

// Auto-resolve versus tests when opponent's roll message is created (GM-only).
Hooks.on("createChatMessage", (message) => {
  if ( !game.user.isGM ) return;
  resolveVersus(message);
});
