import { abilities, advancementNeeded, conditions, skills } from "../config.mjs";
import { showAdvancementDialog } from "./advancement.mjs";
import { PendingVersusRegistry } from "./versus.mjs";
import { getEligibleHelpers } from "./help.mjs";

/* -------------------------------------------- */
/*  Shared Modifier Helpers                     */
/* -------------------------------------------- */

/**
 * Resolve the label and dice pool for a roll.
 * @param {Actor} actor - The actor rolling.
 * @param {"ability"|"skill"} type - Whether this is an ability or skill roll.
 * @param {string} key - The ability/skill key (e.g. "will", "fighter").
 * @returns {{ label: string, dice: number }}
 */
function _resolveRollData(actor, type, key) {
  const cfg = type === "ability" ? abilities[key] : skills[key];
  const label = game.i18n.localize(cfg.label);
  const data = type === "ability" ? actor.system.abilities[key] : actor.system.skills[key];
  return { label, dice: data.rating };
}

/**
 * Gather condition-based dice modifiers for an actor.
 * @param {Actor} actor - The actor being tested.
 * @returns {{ label: string, icon: string, color: string, value: number, display: string }[]}
 */
export function gatherConditionModifiers(actor) {
  const mods = [];
  const add = (key, value) => {
    if ( !actor.system.conditions[key] ) return;
    const c = conditions[key];
    const sign = value > 0 ? "+" : "\u2212";
    mods.push({
      label: game.i18n.localize(c.label),
      icon: c.icon,
      color: c.color,
      value,
      display: `${sign}${Math.abs(value)}D`
    });
  };
  add("fresh", 1);
  add("injured", -1);
  add("sick", -1);
  return mods;
}

/**
 * Build dice modifiers for helpers contributing +1D each.
 * @param {{ name: string, icon: string, helpViaLabel: string }[]} helpers - Array of helper info objects.
 * @returns {{ label: string, icon: string, color: string, value: number, display: string }[]}
 */
export function gatherHelpModifiers(helpers) {
  return helpers.map(h => ({
    label: h.helpViaLabel ? `${h.name} (${h.helpViaLabel})` : h.name,
    icon: h.icon || "fa-solid fa-handshake-angle",
    color: "--tb-cond-fresh",
    value: 1,
    display: "+1D"
  }));
}

/**
 * Log advancement for a test result. Used by both independent and versus paths.
 * @param {object} options
 * @param {Actor} options.actor - The actor to log advancement for.
 * @param {"ability"|"skill"} options.type - Roll type.
 * @param {string} options.key - The ability/skill key.
 * @param {number} options.baseDice - The base dice pool (before modifiers).
 * @param {boolean} options.pass - Whether the test was passed.
 */
export async function _logAdvancement({ actor, type, key, baseDice, pass }) {
  const category = type === "ability" ? "abilities" : "skills";
  const result = pass ? "pass" : "fail";
  const path = `system.${category}.${key}.${result}`;
  const current = foundry.utils.getProperty(actor, path) ?? 0;
  const max = advancementNeeded(baseDice)[result];
  if ( current < max ) await actor.update({ [path]: current + 1 });

  // Check if advancement is now ready
  await showAdvancementDialog({ actor, type, key });
}

/**
 * Show the roll configuration dialog.
 * @param {object} options
 * @param {string} options.label - Display name of the ability/skill.
 * @param {number} options.dice - Default dice pool size.
 * @param {object[]} [options.modifiers=[]] - Condition modifiers to display.
 * @param {string} [options.actorId] - The rolling actor's ID.
 * @param {boolean} [options.disposition=false] - If true, show simplified disposition mode.
 * @param {{ id: string, name: string }[]} [options.availableHelpers=[]] - Actors who can help.
 * @returns {Promise<object|null>} Null if cancelled.
 */
async function _showRollDialog({ label, dice, modifiers = [], actorId, disposition = false,
  availableHelpers = [] }) {
  const staticModBonus = modifiers.reduce((sum, m) => sum + m.value, 0);
  const preSelectedCount = availableHelpers.filter(h => h.preSelected).length;
  let helperBonus = preSelectedCount;
  const openChallenges = disposition ? [] : PendingVersusRegistry.getOpenChallenges(actorId);

  const content = await foundry.applications.handlebars.renderTemplate("systems/tb2e/templates/dice/roll-dialog.hbs", {
    label,
    dice,
    modifiers,
    total: dice + staticModBonus + preSelectedCount,
    disposition,
    availableHelpers,
    helpLabel: game.i18n.localize("TB2E.Roll.Help"),
    obstacleLabel: game.i18n.localize("TB2E.Roll.Obstacle"),
    dicePoolLabel: game.i18n.localize("TB2E.Roll.DicePool"),
    independentLabel: game.i18n.localize("TB2E.Roll.Independent"),
    versusLabel: game.i18n.localize("TB2E.Roll.Versus"),
    advancementLabel: game.i18n.localize("TB2E.Roll.LogAdvancement"),
    challengeLabel: game.i18n.localize("TB2E.Roll.Challenge"),
    newChallengeLabel: game.i18n.localize("TB2E.Roll.NewChallenge"),
    openChallenges,
    isVersus: false
  });

  const dialogTitle = disposition
    ? game.i18n.localize("TB2E.Conflict.DispositionPool")
    : game.i18n.format("TB2E.Roll.DialogTitle", { name: label });

  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: dialogTitle },
    classes: ["tb2e", "roll-dialog"],
    content,
    render: (event, dialog) => {
      const form = dialog.element.querySelector("form");
      const summary = form.querySelector(".roll-dialog-summary-text");

      // Helper toggle handlers (shared across all modes)
      const helperButtons = form.querySelectorAll(".helper-toggle");
      for ( const btn of helperButtons ) {
        btn.addEventListener("click", () => {
          btn.classList.toggle("active");
          helperBonus = form.querySelectorAll(".helper-toggle.active").length;
          updateSummary();
        });
      }

      // Pre-select helpers that were already active on the combat chart
      for ( const btn of helperButtons ) {
        const helperId = btn.dataset.helperId;
        const helperData = availableHelpers.find(h => h.id === helperId);
        if ( helperData?.preSelected ) btn.classList.add("active");
      }
      helperBonus = form.querySelectorAll(".helper-toggle.active").length;

      // Summary update function — defined per-mode below, called by helpers too
      let updateSummary;

      if ( disposition ) {
        // Disposition mode: simple pool-only summary
        updateSummary = () => {
          const pool = Number(form.elements.poolSize.value) + staticModBonus + helperBonus;
          summary.textContent = `${pool}D`;
        };
        form.elements.poolSize.addEventListener("input", updateSummary);
      } else {
        // Standard test mode
        const modeInput = form.querySelector("input[name='mode']");
        const modeToggle = form.querySelector(".roll-dialog-mode-toggle");
        const modeLabel = modeToggle.querySelector(".mode-label");
        const obstacleField = form.querySelector(".roll-field-obstacle");
        const challengeField = form.querySelector(".roll-dialog-challenge");
        const challengeSelect = form.elements.challengeMessageId;

        updateSummary = () => {
          const pool = Number(form.elements.poolSize.value) + staticModBonus + helperBonus;
          if ( modeInput.value === "versus" ) {
            const sel = challengeSelect.options[challengeSelect.selectedIndex];
            if ( sel?.value ) {
              const name = sel.dataset.actorName ?? "?";
              summary.textContent = `${pool}D vs ${name}`;
            } else {
              summary.textContent = `${pool}D Versus`;
            }
          } else {
            const ob = form.elements.obstacle.value;
            summary.textContent = `${pool}D vs Ob ${ob}`;
          }
        };

        // Mode toggle handler
        modeToggle.addEventListener("click", () => {
          const newMode = modeInput.value === "independent" ? "versus" : "independent";
          modeInput.value = newMode;
          if ( newMode === "versus" ) {
            modeLabel.textContent = game.i18n.localize("TB2E.Roll.Versus");
            obstacleField.classList.add("hidden");
            challengeField.classList.remove("hidden");
          } else {
            modeLabel.textContent = game.i18n.localize("TB2E.Roll.Independent");
            obstacleField.classList.remove("hidden");
            challengeField.classList.add("hidden");
          }
          updateSummary();
        });

        form.elements.poolSize.addEventListener("input", updateSummary);
        form.elements.obstacle.addEventListener("input", updateSummary);
        challengeSelect.addEventListener("change", updateSummary);
      }

      // Initialize summary
      updateSummary();
    },
    buttons: [
      {
        action: "roll",
        label: game.i18n.localize("TB2E.Roll.RollButton"),
        icon: "fa-solid fa-dice",
        default: true,
        callback: (event, button, dialog) => {
          const totalModBonus = staticModBonus + helperBonus;
          const activeToggles = button.form.querySelectorAll(".helper-toggle.active");
          const selectedHelpers = Array.from(activeToggles).map(el => ({
            id: el.dataset.helperId,
            name: el.querySelector(".helper-name").textContent.trim(),
            helpVia: el.dataset.helpVia || "",
            helpViaLabel: el.querySelector(".helper-via")?.textContent.trim() || ""
          }));
          if ( disposition ) {
            return {
              baseDice: button.form.elements.poolSize.valueAsNumber,
              poolSize: button.form.elements.poolSize.valueAsNumber + totalModBonus,
              selectedHelpers
            };
          }
          return {
            baseDice: button.form.elements.poolSize.valueAsNumber,
            poolSize: button.form.elements.poolSize.valueAsNumber + totalModBonus,
            obstacle: button.form.elements.obstacle.valueAsNumber,
            logAdvancement: button.form.elements.logAdvancement.checked,
            mode: button.form.elements.mode.value,
            challengeMessageId: button.form.elements.challengeMessageId.value,
            selectedHelpers
          };
        }
      },
      {
        action: "cancel",
        label: game.i18n.localize("Cancel"),
        icon: "fa-solid fa-xmark"
      }
    ],
    close: () => null
  });

  if ( !result || result === "cancel" ) return null;
  return result;
}

/**
 * Show the disposition roll dialog for a conflict captain.
 * Gathers skill, ability, and condition modifiers, then presents the
 * standard roll dialog in disposition mode with toggleable helper buttons.
 * @param {object} options
 * @param {Actor} options.actor - The captain's actor.
 * @param {string} options.skillKey - The chosen disposition skill key.
 * @param {string} options.abilityKey - The disposition ability key.
 * @param {{ id: string, name: string, preSelected: boolean }[]} [options.availableHelpers=[]] - Helpers who can contribute.
 * @returns {Promise<{ baseDice: number, poolSize: number, selectedHelpers: object[] }|null>} Null if cancelled.
 */
export async function rollDisposition({ actor, skillKey, abilityKey, availableHelpers = [] }) {
  const skillCfg = skills[skillKey];
  const abilityCfg = abilities[abilityKey];
  const skillLabel = game.i18n.localize(skillCfg.label);
  const abilityLabel = game.i18n.localize(abilityCfg.label);

  const skillRating = actor.system.skills[skillKey]?.rating || 0;
  const abilityRating = actor.system.abilities[abilityKey]?.rating || 0;

  // Modifiers: conditions only (ability is added to successes, not to pool)
  const modifiers = [...gatherConditionModifiers(actor)];

  const label = skillLabel;
  const result = await _showRollDialog({
    label, dice: skillRating, modifiers, disposition: true, availableHelpers
  });
  if ( !result ) return null;
  return {
    baseDice: result.baseDice,
    poolSize: result.poolSize,
    selectedHelpers: result.selectedHelpers,
    label, modifiers, skillLabel, abilityLabel, abilityRating
  };
}

/**
 * Evaluate a dice roll and build display data.
 * @param {number} poolSize - Total dice to roll.
 * @returns {Promise<{roll: Roll, successes: number, diceResults: object[]}>}
 */
export async function evaluateRoll(poolSize) {
  const formula = `${poolSize}d6cs>=4`;
  const roll = await new Roll(formula).evaluate();
  const successes = roll.total;
  const diceResults = roll.dice[0]?.results.map(r => ({
    value: r.result,
    success: r.result >= 4,
    face: r.result >= 6 ? "sun" : r.result >= 4 ? "axes" : "wyrm",
    isSun: r.result >= 6
  })) ?? [];
  return { roll, successes, diceResults };
}

/**
 * Perform a test roll for a Torchbearer ability or skill.
 * Supports both independent and versus modes.
 * @param {object} options
 * @param {Actor} options.actor - The actor making the roll.
 * @param {"ability"|"skill"} options.type - Roll type.
 * @param {string} options.key - The ability/skill key.
 * @param {object} [options.testContext={}] - Context flags for help eligibility.
 */
export async function rollTest({ actor, type, key, testContext = {} }) {
  const { label, dice } = _resolveRollData(actor, type, key);
  const modifiers = gatherConditionModifiers(actor);
  const availableHelpers = getEligibleHelpers({ actor, type, key, testContext });

  // Show dialog
  const config = await _showRollDialog({ label, dice, modifiers, actorId: actor.id, availableHelpers });
  if ( !config ) return;

  const { poolSize, baseDice, logAdvancement } = config;
  const { roll, successes, diceResults } = await evaluateRoll(poolSize);

  // Merge helper modifiers with condition modifiers for display on chat cards
  const helpMods = gatherHelpModifiers(config.selectedHelpers || []);
  const allModifiers = [...modifiers, ...helpMods];

  if ( config.mode === "versus" ) {
    await _handleVersusRoll({
      actor, type, key, label, baseDice, poolSize, successes,
      roll, diceResults, modifiers: allModifiers, logAdvancement, config
    });
  } else {
    await _handleIndependentRoll({
      actor, type, key, label, baseDice, poolSize, successes,
      roll, diceResults, modifiers: allModifiers, logAdvancement, config
    });
  }
}

/**
 * Handle an independent (standard) test roll.
 */
async function _handleIndependentRoll({ actor, type, key, label, baseDice, poolSize, successes,
  roll, diceResults, modifiers, logAdvancement, config }) {
  const obstacle = config.obstacle;
  const pass = successes >= obstacle;

  const chatContent = await foundry.applications.handlebars.renderTemplate("systems/tb2e/templates/chat/roll-result.hbs", {
    actorName: actor.name,
    actorImg: actor.img,
    label,
    baseDice,
    poolSize,
    obstacle,
    successes,
    pass,
    modifiers,
    diceResults,
    passLabel: game.i18n.localize("TB2E.Roll.Pass"),
    failLabel: game.i18n.localize("TB2E.Roll.Fail"),
    successesLabel: game.i18n.localize("TB2E.Roll.Successes"),
    obstacleLabel: game.i18n.localize("TB2E.Roll.ObstacleLabel"),
    testLabel: game.i18n.localize("TB2E.Roll.Test"),
    testTypeLabel: game.i18n.localize("TB2E.Roll.Independent")
  });

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: chatContent,
    rolls: [roll],
    type: CONST.CHAT_MESSAGE_STYLES.OTHER,
    flags: {
      tb2e: {
        helpers: (config.selectedHelpers || []).map(h => ({
          id: h.id, name: h.name, helpVia: h.helpVia
        }))
      }
    }
  });

  // Log advancement — Ob 0 tests never count
  if ( logAdvancement && obstacle > 0 ) {
    await _logAdvancement({ actor, type, key, baseDice, pass });
  }
}

/**
 * Handle a versus test roll (initiator or opponent).
 */
async function _handleVersusRoll({ actor, type, key, label, baseDice, poolSize, successes,
  roll, diceResults, modifiers, logAdvancement, config }) {

  const isOpponent = !!config.challengeMessageId;

  if ( isOpponent ) {
    // This actor is responding to an open challenge
    const initiatorMessage = game.messages.get(config.challengeMessageId);
    if ( !initiatorMessage ) {
      ui.notifications.warn("The selected challenge no longer exists.");
      return;
    }
    const initiatorVs = initiatorMessage.getFlag("tb2e", "versus");
    if ( !initiatorVs || initiatorVs.resolved ) {
      ui.notifications.warn("That challenge has already been resolved.");
      return;
    }
    const initiatorActor = game.actors.get(initiatorVs.initiatorActorId);

    const chatContent = await foundry.applications.handlebars.renderTemplate("systems/tb2e/templates/chat/versus-pending.hbs", {
      actorName: actor.name,
      actorImg: actor.img,
      label,
      baseDice,
      poolSize,
      successes,
      modifiers,
      diceResults,
      versusLabel: game.i18n.localize("TB2E.Roll.Versus"),
      testLabel: game.i18n.localize("TB2E.Roll.Test"),
      successesLabel: game.i18n.localize("TB2E.Roll.Successes"),
      pendingLabel: game.i18n.localize("TB2E.Roll.Pending")
    });

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: chatContent,
      rolls: [roll],
      type: CONST.CHAT_MESSAGE_STYLES.OTHER,
      flags: {
        tb2e: {
          versus: {
            type: "opponent",
            initiatorMessageId: initiatorMessage.id,
            initiatorActorId: initiatorVs.initiatorActorId,
            opponentActorId: actor.id,
            successes,
            rollType: type,
            rollKey: key,
            label,
            baseDice,
            logAdvancement,
            resolved: false
          },
          helpers: (config.selectedHelpers || []).map(h => ({
            id: h.id, name: h.name, helpVia: h.helpVia
          }))
        }
      }
    });
  } else {
    // This actor is initiating a new challenge (no opponent selected)
    const chatContent = await foundry.applications.handlebars.renderTemplate("systems/tb2e/templates/chat/versus-pending.hbs", {
      actorName: actor.name,
      actorImg: actor.img,
      label,
      baseDice,
      poolSize,
      successes,
      modifiers,
      diceResults,
      versusLabel: game.i18n.localize("TB2E.Roll.Versus"),
      testLabel: game.i18n.localize("TB2E.Roll.Test"),
      successesLabel: game.i18n.localize("TB2E.Roll.Successes"),
      pendingLabel: game.i18n.localize("TB2E.Roll.Pending")
    });

    const message = await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: chatContent,
      rolls: [roll],
      type: CONST.CHAT_MESSAGE_STYLES.OTHER,
      flags: {
        tb2e: {
          versus: {
            type: "initiator",
            initiatorActorId: actor.id,
            successes,
            rollType: type,
            rollKey: key,
            label,
            baseDice,
            logAdvancement,
            resolved: false
          },
          helpers: (config.selectedHelpers || []).map(h => ({
            id: h.id, name: h.name, helpVia: h.helpVia
          }))
        }
      }
    });

    PendingVersusRegistry.register(message.id);
  }
}
