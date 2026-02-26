import { abilities, advancementNeeded, conditions, skills } from "../config.mjs";
import { showAdvancementDialog } from "./advancement.mjs";
import { PendingVersusRegistry } from "./versus.mjs";

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
 * @returns {{ label: string, icon: string, color: string, value: number }[]}
 */
function _gatherConditionModifiers(actor) {
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
 * @param {string} options.actorId - The rolling actor's ID.
 * @returns {Promise<object|null>} Null if cancelled.
 */
async function _showRollDialog({ label, dice, modifiers = [], actorId }) {
  const modBonus = modifiers.reduce((sum, m) => sum + m.value, 0);
  const openChallenges = PendingVersusRegistry.getOpenChallenges(actorId);

  const content = await renderTemplate("systems/tb2e/templates/dice/roll-dialog.hbs", {
    label,
    dice,
    modifiers,
    total: dice + modBonus,
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

  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.format("TB2E.Roll.DialogTitle", { name: label }) },
    classes: ["tb2e", "roll-dialog"],
    content,
    render: (event, dialog) => {
      const form = dialog.element.querySelector("form");
      const summary = form.querySelector(".roll-dialog-summary-text");
      const modeInput = form.querySelector("input[name='mode']");
      const modeToggle = form.querySelector(".roll-dialog-mode-toggle");
      const modeLabel = modeToggle.querySelector(".mode-label");
      const obstacleField = form.querySelector(".roll-field-obstacle");
      const challengeField = form.querySelector(".roll-dialog-challenge");
      const challengeSelect = form.elements.challengeMessageId;

      const updateSummary = () => {
        const pool = Number(form.elements.poolSize.value) + modBonus;
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

      // Initialize summary
      updateSummary();
    },
    buttons: [
      {
        action: "roll",
        label: game.i18n.localize("TB2E.Roll.RollButton"),
        icon: "fa-solid fa-dice",
        default: true,
        callback: (event, button, dialog) => ({
          baseDice: button.form.elements.poolSize.valueAsNumber,
          poolSize: button.form.elements.poolSize.valueAsNumber + modBonus,
          obstacle: button.form.elements.obstacle.valueAsNumber,
          logAdvancement: button.form.elements.logAdvancement.checked,
          mode: button.form.elements.mode.value,
          challengeMessageId: button.form.elements.challengeMessageId.value
        })
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
 * Evaluate a dice roll and build display data.
 * @param {number} poolSize - Total dice to roll.
 * @returns {Promise<{roll: Roll, successes: number, diceResults: object[]}>}
 */
async function _evaluateRoll(poolSize) {
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
 */
export async function rollTest({ actor, type, key }) {
  const { label, dice } = _resolveRollData(actor, type, key);
  const modifiers = _gatherConditionModifiers(actor);

  // Show dialog
  const config = await _showRollDialog({ label, dice, modifiers, actorId: actor.id });
  if ( !config ) return;

  const { poolSize, baseDice, logAdvancement } = config;
  const { roll, successes, diceResults } = await _evaluateRoll(poolSize);

  if ( config.mode === "versus" ) {
    await _handleVersusRoll({
      actor, type, key, label, baseDice, poolSize, successes,
      roll, diceResults, modifiers, logAdvancement, config
    });
  } else {
    await _handleIndependentRoll({
      actor, type, key, label, baseDice, poolSize, successes,
      roll, diceResults, modifiers, logAdvancement, config
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

  const chatContent = await renderTemplate("systems/tb2e/templates/chat/roll-result.hbs", {
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
    type: CONST.CHAT_MESSAGE_STYLES.OTHER
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

    const chatContent = await renderTemplate("systems/tb2e/templates/chat/versus-pending.hbs", {
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
          }
        }
      }
    });
  } else {
    // This actor is initiating a new challenge (no opponent selected)
    const chatContent = await renderTemplate("systems/tb2e/templates/chat/versus-pending.hbs", {
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
          }
        }
      }
    });

    PendingVersusRegistry.register(message.id);
  }
}
