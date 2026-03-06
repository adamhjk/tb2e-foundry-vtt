import { abilities, advancementNeeded, conditions, skills } from "../config.mjs";
import { showAdvancementDialog } from "./advancement.mjs";
import { PendingVersusRegistry } from "./versus.mjs";
import { getEligibleHelpers, getEligibleWiseAiders } from "./help.mjs";
import { buildChatTemplateData, mapHelpersForFlags, mapWiseAidersForFlags } from "./roll-utils.mjs";

/* ============================================ */
/*  Modifier Subsystem                          */
/* ============================================ */

/**
 * Create a standardized roll modifier.
 * @param {object} data
 * @param {string} data.label - Human-readable label.
 * @param {"dice"|"success"|"obstacle"} [data.type="dice"] - Whether it modifies dice, successes, or obstacle.
 * @param {number} data.value - Signed value (+1, -1, etc.).
 * @param {string} [data.source="manual"] - Origin: condition, help, trait, persona, nature, manual.
 * @param {string} [data.icon="fa-solid fa-circle"] - FontAwesome icon class.
 * @param {string} [data.color="--tb-text-dim"] - CSS variable name for theming.
 * @param {"pre"|"post"} [data.timing="pre"] - Pre-roll (dice pool) or post-roll (successes).
 * @returns {object} Standardized modifier object.
 */
export function createModifier({
  label, type = "dice", value, source = "manual",
  icon = "fa-solid fa-circle", color = "--tb-text-dim", timing = "pre"
}) {
  const sign = value > 0 ? "+" : "\u2212";
  const unit = type === "dice" ? "D" : type === "obstacle" ? "Ob" : "s";
  return { label, type, value, source, icon, color, timing, display: `${sign}${Math.abs(value)}${unit}` };
}

/* -------------------------------------------- */
/*  Shared Helpers                              */
/* -------------------------------------------- */

/**
 * Resolve the label and dice pool for a roll.
 * @param {Actor} actor
 * @param {"ability"|"skill"} type
 * @param {string} key
 * @returns {{ label: string, dice: number }}
 */
function _resolveRollData(actor, type, key) {
  const cfg = type === "ability" ? abilities[key] : skills[key];
  const label = game.i18n.localize(cfg.label);
  if ( type === "ability" ) {
    const data = actor.system.abilities[key];
    const dice = typeof data === "number" ? data : data.rating;
    return { label, dice };
  }
  const skillData = actor.system.skills;
  if ( Array.isArray(skillData) ) {
    const entry = skillData.find(s => s.key === key);
    return { label, dice: entry?.rating ?? 0 };
  }
  return { label, dice: skillData[key].rating };
}

/* -------------------------------------------- */
/*  Modifier Gathering                          */
/* -------------------------------------------- */

/**
 * Gather condition-based dice modifiers for an actor.
 * @param {Actor} actor
 * @param {object} [testContext={}] - Context for restriction checks.
 * @returns {object[]} Array of modifier objects.
 */
export function gatherConditionModifiers(actor, testContext = {}) {
  const mods = [];
  const isResourcesOrCircles = testContext.isResources || testContext.isCircles;
  const isRecovery = testContext.isRecovery;

  const add = (key, value, opts = {}) => {
    if ( !actor.system.conditions[key] ) return;
    const c = conditions[key];
    mods.push(createModifier({
      label: game.i18n.localize(c.label),
      type: "dice",
      value,
      source: "condition",
      icon: c.icon,
      color: c.color,
      timing: "pre",
      ...opts
    }));
  };

  add("fresh", 1);
  // Injured/Sick: -1D for Nature/Will/Health/skills, NOT Resources/Circles/recovery
  if ( !isResourcesOrCircles && !isRecovery ) {
    add("injured", -1);
    add("sick", -1);
  }
  return mods;
}

/**
 * Build dice modifiers for helpers contributing +1D each.
 * @param {object[]} helpers - Array of helper info objects.
 * @returns {object[]} Array of modifier objects.
 */
export function gatherHelpModifiers(helpers) {
  return helpers.map(h => createModifier({
    label: h.helpViaLabel ? `${h.name} (${h.helpViaLabel})` : h.name,
    type: "dice",
    value: 1,
    source: "help",
    icon: h.icon || "fa-solid fa-handshake-angle",
    color: "--tb-cond-fresh",
    timing: "pre"
  }));
}

/* -------------------------------------------- */
/*  Beginner's Luck Detection                   */
/* -------------------------------------------- */

/**
 * Detect if a test should use Beginner's Luck.
 * @param {Actor} actor
 * @param {"ability"|"skill"} type
 * @param {string} key
 * @returns {{ isBL: boolean, blAbilityKey: string|null, blAbilityLabel: string|null, blDice: number }|null}
 */
function _detectBeginnersLuck(actor, type, key) {
  if ( type !== "skill" || actor.type !== "character" ) return null;
  const skillData = actor.system.skills[key];
  if ( !skillData || skillData.rating > 0 ) return null;

  const skillCfg = skills[key];
  const blAbilityKey = skillCfg.bl === "H" ? "health" : "will";
  const blAbilityLabel = game.i18n.localize(abilities[blAbilityKey].label);
  const blDice = actor.system.abilities[blAbilityKey].rating;
  return { isBL: true, blAbilityKey, blAbilityLabel, blDice };
}

/**
 * Apply Beginner's Luck halving to the dice pool.
 * Halvable sources: base dice, help, manual dice. Non-halvable: traits, persona, fresh, nature.
 * @param {number} baseDice - Base dice from BL ability.
 * @param {object[]} modifiers - All pre-roll dice modifiers.
 * @returns {number} Final pool size after halving.
 */
function _applyBLHalving(baseDice, modifiers) {
  const NON_HALVABLE = new Set(["trait", "persona", "nature", "condition"]);
  let halvable = baseDice;
  let nonHalvable = 0;

  for ( const m of modifiers ) {
    if ( m.timing !== "pre" || m.type !== "dice" ) continue;
    if ( NON_HALVABLE.has(m.source) ) {
      nonHalvable += m.value;
    } else {
      halvable += m.value;
    }
  }
  const halved = Math.ceil(halvable / 2);
  const penalty = halved - halvable;
  const poolSize = Math.max(halved + nonHalvable, 1);
  const halvingMod = createModifier({
    label: game.i18n.localize("TB2E.Roll.BLHalving"),
    type: "dice", value: penalty, source: "bl-halving",
    icon: "fa-solid fa-divide", color: "--tb-amber", timing: "pre"
  });
  return { poolSize, halvingMod };
}

/* -------------------------------------------- */
/*  Advancement                                 */
/* -------------------------------------------- */

/**
 * Log advancement for a test result.
 * @param {object} options
 * @param {Actor} options.actor
 * @param {"ability"|"skill"} options.type
 * @param {string} options.key
 * @param {number} options.baseDice
 * @param {boolean} options.pass
 */
export async function _logAdvancement({ actor, type, key, baseDice, pass }) {
  if ( actor.type !== "character" ) return;
  const category = type === "ability" ? "abilities" : "skills";
  const result = pass ? "pass" : "fail";
  const path = `system.${category}.${key}.${result}`;
  const current = foundry.utils.getProperty(actor, path) ?? 0;
  // For nature, advancement thresholds are based on max (not taxed current)
  const advRating = (type === "ability" && key === "nature")
    ? actor.system.abilities.nature.max : baseDice;
  const max = advancementNeeded(advRating)[result];
  if ( current < max ) await actor.update({ [path]: current + 1 });
  await showAdvancementDialog({ actor, type, key });
}

/**
 * Log a Beginner's Luck test toward learning a skill.
 * After Nature-max tests, the skill opens at rating 2.
 * @param {object} options
 * @param {Actor} options.actor
 * @param {string} options.key - Skill key.
 */
export async function _logBLLearning({ actor, key }) {
  if ( actor.type !== "character" ) return;
  const skillData = actor.system.skills[key];
  if ( !skillData || skillData.rating > 0 ) return;

  const newCount = (skillData.learning ?? 0) + 1;
  const natureMax = actor.system.abilities.nature.max;

  if ( newCount >= natureMax ) {
    await actor.update({
      [`system.skills.${key}.rating`]: 2,
      [`system.skills.${key}.pass`]: 0,
      [`system.skills.${key}.fail`]: 0,
      [`system.skills.${key}.learning`]: 0
    });
    await _postSkillOpenedCard(actor, key);
  } else {
    await actor.update({ [`system.skills.${key}.learning`]: newCount });
  }
}

/**
 * Post a chat card announcing a skill has been learned via Beginner's Luck.
 * @param {Actor} actor
 * @param {string} key - Skill key.
 */
async function _postSkillOpenedCard(actor, key) {
  const cfg = skills[key];
  const label = game.i18n.localize(cfg.label);
  const chatContent = await foundry.applications.handlebars.renderTemplate(
    "systems/tb2e/templates/chat/skill-opened.hbs",
    { actorName: actor.name, actorImg: actor.img, label, newRating: 2 }
  );
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: chatContent,
    type: CONST.CHAT_MESSAGE_STYLES.OTHER
  });
}

/* -------------------------------------------- */
/*  Gear Modifier Gathering                     */
/* -------------------------------------------- */

/**
 * Gather gear, weapon, and supply items that can provide bonuses for a test.
 * @param {Actor} actor
 * @param {string} testKey - The skill or ability being tested.
 * @returns {{ gearItems: object[], supplyItems: object[] }}
 */
export function _gatherGearModifiers(actor, testKey) {
  if ( !testKey || actor.type !== "character" ) return { gearItems: [], supplyItems: [] };

  const gearItems = [];

  // Scan gear items for matching skillBonuses.
  for ( const item of (actor.itemTypes.gear || []) ) {
    if ( item.system.dropped || item.system.damaged || !item.system.slot ) continue;
    for ( const bonus of (item.system.skillBonuses || []) ) {
      if ( bonus.skill === testKey && bonus.value > 0 ) {
        gearItems.push({ itemId: item.id, name: item.name, value: bonus.value, condition: bonus.condition });
        break;
      }
    }
  }

  // Scan weapons: auto +1D Fighter for any weapon, plus weapon-specific skillBonuses.
  for ( const item of (actor.itemTypes.weapon || []) ) {
    if ( item.system.dropped || item.system.damaged || !item.system.slot ) continue;
    if ( testKey === "fighter" ) {
      gearItems.push({ itemId: item.id, name: item.name, value: 1, condition: "" });
      continue;
    }
    for ( const bonus of (item.system.skillBonuses || []) ) {
      if ( bonus.skill === testKey && bonus.value > 0 ) {
        gearItems.push({ itemId: item.id, name: item.name, value: bonus.value, condition: bonus.condition });
        break;
      }
    }
  }

  // Scan supply items for matching skillBonuses.
  const supplyItems = [];
  for ( const item of (actor.itemTypes.supply || []) ) {
    if ( item.system.dropped || item.system.damaged || !item.system.slot ) continue;
    if ( (item.system.quantity ?? 0) <= 0 ) continue;
    for ( const bonus of (item.system.skillBonuses || []) ) {
      if ( bonus.skill === testKey && bonus.value > 0 ) {
        supplyItems.push({
          itemId: item.id, name: item.name, value: bonus.value,
          condition: bonus.condition, quantity: item.system.quantity
        });
        break;
      }
    }
  }

  return { gearItems, supplyItems };
}

/**
 * Check if an actor has a backpack-type container equipped.
 * @param {Actor} actor
 * @returns {boolean}
 */
function _checkBackpackEquipped(actor) {
  if ( actor.type !== "character" ) return false;
  for ( const item of (actor.itemTypes.container || []) ) {
    if ( item.system.containerType === "backpack" && item.system.slot && !item.system.dropped && !item.system.lost ) {
      return true;
    }
  }
  return false;
}

/* -------------------------------------------- */
/*  Roll Dialog                                 */
/* -------------------------------------------- */

/**
 * Build the trait data for the dialog.
 * @param {Actor} actor
 * @param {boolean} isAngry
 * @returns {object[]}
 */
function _buildTraitData(actor, isAngry) {
  return (actor.itemTypes.trait || []).map(item => {
    const t = item.system;
    const maxBeneficial = t.maxBeneficial;
    const benefitDisabled = isAngry || (t.level < 3 && t.beneficial <= 0);
    return {
      itemId: item.id,
      name: item.name,
      level: t.level,
      beneficial: t.beneficial,
      maxBeneficial,
      isL3: t.level >= 3,
      benefitDisabled,
      againstDisabled: t.usedAgainst,
      checks: t.checks
    };
  }).filter(t => t.name);
}

/**
 * Show the roll configuration dialog.
 * Supports disposition mode (simplified), or full test mode with modifiers, traits, persona, wises.
 * @param {object} options
 * @param {string} options.label
 * @param {number} options.dice
 * @param {object[]} [options.conditionModifiers=[]]
 * @param {object[]} [options.contextModifiers=[]] - Pre-supplied modifiers from testContext.
 * @param {string} [options.actorId]
 * @param {Actor} [options.actor]
 * @param {boolean} [options.disposition=false]
 * @param {object[]} [options.availableHelpers=[]]
 * @param {object|null} [options.blInfo=null]
 * @param {"ability"|"skill"} [options.type]
 * @param {string} [options.key]
 * @param {object} [options.testContext={}]
 * @returns {Promise<object|null>}
 */
async function _showRollDialog({
  label, dice, conditionModifiers = [], contextModifiers = [], actorId, actor,
  disposition = false, availableHelpers = [], availableWiseAiders = [], blInfo = null,
  type, key, testContext = {}
}) {
  const isCharacter = actor?.type === "character";
  const isAfraid = actor?.system?.conditions?.afraid ?? false;
  const isAngry = isCharacter && actor.system.conditions.angry;

  // Build character-specific data
  const traitData = isCharacter && !disposition ? _buildTraitData(actor, isAngry) : [];
  const hasTraits = traitData.length > 0;

  const wiseData = isCharacter && !disposition ? (actor.system.wises || []).filter(w => w.name) : [];
  const hasWises = wiseData.length > 0 && !isAngry;

  const isResourcesOrCircles = type === "ability" && (key === "resources" || key === "circles");
  const showPersona = isCharacter && !disposition && !isResourcesOrCircles;
  const personaAvailable = showPersona ? actor.system.persona.current : 0;
  const hideChannelNature = !showPersona;
  const natureRating = isCharacter ? actor.system.abilities.nature.rating : 0;

  // Direct nature test: show within/outside descriptors toggle
  const isDirectNatureTest = isCharacter && !disposition && type === "ability" && key === "nature";
  const natureDescriptors = isDirectNatureTest ? (actor.system.natureDescriptors || []) : [];
  // Also provide descriptors as reference when channel nature is available
  const channelNatureDescriptors = (isCharacter && !disposition && !isResourcesOrCircles)
    ? (actor.system.natureDescriptors || []) : [];

  // Open challenges for versus mode
  const openChallenges = disposition ? [] : PendingVersusRegistry.getOpenChallenges(actorId);

  // Helper lists
  const pcHelpers = availableHelpers.filter(h => !h.isNPC);
  const npcHelpers = availableHelpers.filter(h => h.isNPC);
  const hasHelpers = !isAfraid && (pcHelpers.length > 0 || npcHelpers.length > 0);

  // Wise aiders (I Am Wise)
  const wiseAiders = !isAfraid && !disposition ? availableWiseAiders : [];
  const hasWiseAiders = wiseAiders.length > 0;

  // Gear & supply modifiers for skill and ability tests
  const testKey = (type === "skill" || type === "ability") ? key : null;
  const { gearItems, supplyItems } = isCharacter && testKey && !disposition
    ? _gatherGearModifiers(actor, testKey) : { gearItems: [], supplyItems: [] };
  const hasGearSupplies = gearItems.length > 0 || supplyItems.length > 0;

  const content = await foundry.applications.handlebars.renderTemplate(
    "systems/tb2e/templates/dice/roll-dialog.hbs", {
      label, dice, disposition,
      conditionModifiers, contextModifiers,
      hasHelpers, pcHelpers, npcHelpers,
      hasWiseAiders, wiseAiders,
      hasTraits, traits: traitData,
      hasWises, wises: wiseData,
      showPersona, personaAvailable,
      hideChannelNature, natureRating,
      isDirectNatureTest, natureDescriptors, channelNatureDescriptors,
      blInfo,
      isAfraid, isAngry,
      hasGearSupplies, gearItems, supplyItems,
      helpLabel: game.i18n.localize("TB2E.Roll.Help"),
      npcHelpLabel: game.i18n.localize("TB2E.Help.NPCSection"),
      obstacleLabel: game.i18n.localize("TB2E.Roll.Obstacle"),
      dicePoolLabel: game.i18n.localize("TB2E.Roll.DicePool"),
      independentLabel: game.i18n.localize("TB2E.Roll.Independent"),
      versusLabel: game.i18n.localize("TB2E.Roll.Versus"),
      advancementLabel: game.i18n.localize("TB2E.Roll.LogAdvancement"),
      challengeLabel: game.i18n.localize("TB2E.Roll.Challenge"),
      newChallengeLabel: game.i18n.localize("TB2E.Roll.NewChallenge"),
      openChallenges,
      isVersus: false
    }
  );

  const dialogTitle = disposition
    ? game.i18n.localize("TB2E.Conflict.DispositionPool")
    : game.i18n.format("TB2E.Roll.DialogTitle", { name: label });

  /* ------ Dialog State ------ */
  // Mutable state objects — mutated in place so the roll callback always sees current values
  let helperBonus = 0;
  const traitState = { itemId: null, mode: "none", againstType: null };
  const personaState = { advantage: 0, channelNature: false };
  const natureState = { withinNature: true };

  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: dialogTitle },
    classes: ["tb2e", "roll-dialog"],
    content,
    render: (event, dialog) => {
      const form = dialog.element.querySelector("form");
      const summary = form.querySelector(".roll-dialog-summary-text");
      const modContainer = form.querySelector(".roll-dialog-modifiers");

      // Pre-set obstacle from testContext (e.g., spell casting)
      if ( testContext.obstacle != null && form.elements.obstacle ) {
        form.elements.obstacle.value = testContext.obstacle;
      }

      /* ------ Modifier List Rendering ------ */
      function renderModifierList() {
        // Gather all active modifiers: conditions + context + helpers + trait + persona + nature + manual
        const allMods = _collectAllModifiers();
        modContainer.innerHTML = allMods.map((m, i) => `
          <div class="roll-modifier" style="--mod-color: var(${m.color})">
            <i class="${m.icon}"></i>
            <span class="mod-label">${m.label}</span>
            <span class="mod-value">${m.display}</span>
            ${m.source === "manual" ? `<button type="button" class="mod-remove" data-mod-index="${i}"><i class="fa-solid fa-xmark"></i></button>` : ""}
          </div>
        `).join("");
        // Attach remove handlers
        for ( const btn of modContainer.querySelectorAll(".mod-remove") ) {
          btn.addEventListener("click", () => {
            // Find which manual modifier this corresponds to
            const displayIdx = Number(btn.dataset.modIndex);
            const allMods = _collectAllModifiers();
            const targetMod = allMods[displayIdx];
            if ( targetMod?.source === "manual" ) {
              const manualIdx = manualModifiers.indexOf(targetMod);
              if ( manualIdx >= 0 ) manualModifiers.splice(manualIdx, 1);
            }
            renderModifierList();
            updateSummary();
          });
        }
      }

      // Manual modifiers array
      const manualModifiers = [];

      function _collectAllModifiers() {
        const all = [...conditionModifiers, ...contextModifiers];

        // Helper modifiers
        const activeHelpers = form.querySelectorAll(".helper-toggle.active");
        for ( const el of activeHelpers ) {
          all.push(createModifier({
            label: el.querySelector(".helper-name").textContent.trim(),
            type: "dice", value: 1, source: "help",
            icon: "fa-solid fa-handshake-angle", color: "--tb-cond-fresh", timing: "pre"
          }));
        }

        // Wise aid modifiers (I Am Wise)
        const activeWiseAids = form.querySelectorAll(".wise-aid-toggle.active");
        for ( const el of activeWiseAids ) {
          all.push(createModifier({
            label: `${el.dataset.helperName} (${el.dataset.wiseName})`,
            type: "dice", value: 1, source: "wise-aid",
            icon: "fa-solid fa-lightbulb", color: "--tb-amber", timing: "pre"
          }));
        }

        // Trait modifier
        if ( traitState.itemId && traitState.mode !== "none" ) {
          const t = traitData.find(td => td.itemId === traitState.itemId);
          if ( t ) {
            if ( traitState.mode === "benefit" ) {
              if ( t.isL3 ) {
                all.push(createModifier({
                  label: `${t.name} (L3)`, type: "success", value: 1, source: "trait",
                  icon: "fa-solid fa-fingerprint", color: "--tb-cond-fresh", timing: "post"
                }));
              } else {
                all.push(createModifier({
                  label: `${t.name} (L${t.level})`, type: "dice", value: 1, source: "trait",
                  icon: "fa-solid fa-fingerprint", color: "--tb-cond-fresh", timing: "pre"
                }));
              }
            } else if ( traitState.mode === "against" ) {
              if ( traitState.againstType === "opponent-bonus" ) {
                // +2D to opponent — no modifier on YOUR roll; stored in flags
                all.push(createModifier({
                  label: `${t.name} (against: +2D opp)`, type: "dice", value: 0, source: "trait",
                  icon: "fa-solid fa-fingerprint", color: "--tb-cond-angry", timing: "pre"
                }));
              } else {
                // Default: -1D penalty
                all.push(createModifier({
                  label: `${t.name} (against)`, type: "dice", value: -1, source: "trait",
                  icon: "fa-solid fa-fingerprint", color: "--tb-cond-angry", timing: "pre"
                }));
              }
            }
          }
        }

        // Persona advantage modifiers
        for ( let i = 0; i < personaState.advantage; i++ ) {
          all.push(createModifier({
            label: game.i18n.localize("TB2E.Roll.PersonaAdvantage"),
            type: "dice", value: 1, source: "persona",
            icon: "fa-solid fa-star", color: "--tb-amber", timing: "pre"
          }));
        }

        // Channel Nature modifier
        if ( personaState.channelNature ) {
          all.push(createModifier({
            label: game.i18n.localize("TB2E.Roll.ChannelNature"),
            type: "dice", value: natureRating, source: "nature",
            icon: "fa-solid fa-paw", color: "--tb-blue", timing: "pre"
          }));
        }

        // Gear modifier (from dialog selection)
        const activeGear = form.querySelector(".gear-bonus-toggle.active");
        if ( activeGear ) {
          all.push(createModifier({
            label: activeGear.dataset.itemName,
            type: "dice", value: 1, source: "gear",
            icon: "fa-solid fa-gear", color: "--tb-blue", timing: "pre"
          }));
        }

        // Supply modifier (from dialog selection, consumed on roll)
        const activeSupply = form.querySelector(".supply-bonus-toggle.active");
        if ( activeSupply ) {
          all.push(createModifier({
            label: `${activeSupply.dataset.itemName} (consumed)`,
            type: "dice", value: 1, source: "supply",
            icon: "fa-solid fa-flask", color: "--tb-green", timing: "pre"
          }));
        }

        // Manual modifiers
        all.push(...manualModifiers);
        return all;
      }

      /* ------ Helper Toggles ------ */
      for ( const btn of form.querySelectorAll(".helper-toggle") ) {
        btn.addEventListener("click", () => {
          btn.classList.toggle("active");
          const row = btn.closest(".helper-row");
          if ( btn.classList.contains("active") ) {
            // Deactivate any wise aid from the same actor (mutual exclusion)
            const helperId = btn.dataset.helperId;
            for ( const waBtn of form.querySelectorAll(`.wise-aid-toggle.active[data-helper-id="${helperId}"]`) ) {
              waBtn.classList.remove("active");
            }
          } else if ( row ) {
            // Clear synergy when helper is deactivated
            row.classList.remove("synergy-active");
          }
          helperBonus = form.querySelectorAll(".helper-toggle.active").length;
          renderModifierList();
          updateSummary();
        });
      }

      /* ------ Synergy Buttons ------ */
      for ( const btn of form.querySelectorAll(".helper-synergy-btn") ) {
        btn.addEventListener("click", () => {
          const row = btn.closest(".helper-row");
          const toggle = row?.querySelector(".helper-toggle");
          if ( !toggle ) return;
          // If help isn't engaged, engage it first
          if ( !toggle.classList.contains("active") ) {
            toggle.classList.add("active");
            // Deactivate any wise aid from the same actor (mutual exclusion)
            const helperId = toggle.dataset.helperId;
            for ( const waBtn of form.querySelectorAll(`.wise-aid-toggle.active[data-helper-id="${helperId}"]`) ) {
              waBtn.classList.remove("active");
            }
            helperBonus = form.querySelectorAll(".helper-toggle.active").length;
            renderModifierList();
            updateSummary();
          }
          row.classList.toggle("synergy-active");
        });
      }

      /* ------ Gear & Supply Toggles ------ */
      for ( const btn of form.querySelectorAll(".gear-bonus-toggle") ) {
        btn.addEventListener("click", () => {
          // Radio behavior: only one gear item at a time
          for ( const other of form.querySelectorAll(".gear-bonus-toggle.active") ) {
            if ( other !== btn ) other.classList.remove("active");
          }
          btn.classList.toggle("active");
          renderModifierList();
          updateSummary();
        });
      }
      for ( const btn of form.querySelectorAll(".supply-bonus-toggle") ) {
        btn.addEventListener("click", () => {
          // Radio behavior: only one supply item at a time
          for ( const other of form.querySelectorAll(".supply-bonus-toggle.active") ) {
            if ( other !== btn ) other.classList.remove("active");
          }
          btn.classList.toggle("active");
          renderModifierList();
          updateSummary();
        });
      }

      /* ------ Wise Aid Toggles (I Am Wise) ------ */
      for ( const btn of form.querySelectorAll(".wise-aid-toggle") ) {
        btn.addEventListener("click", () => {
          const helperId = btn.dataset.helperId;
          const isActive = btn.classList.toggle("active");
          if ( isActive ) {
            // Deactivate regular help from the same actor (mutual exclusion)
            const helperToggle = form.querySelector(`.helper-toggle.active[data-helper-id="${helperId}"]`);
            if ( helperToggle ) {
              helperToggle.classList.remove("active");
              const row = helperToggle.closest(".helper-row");
              if ( row ) row.classList.remove("synergy-active");
              helperBonus = form.querySelectorAll(".helper-toggle.active").length;
            }
            // Only one wise aid per actor
            for ( const other of form.querySelectorAll(`.wise-aid-toggle.active[data-helper-id="${helperId}"]`) ) {
              if ( other !== btn ) other.classList.remove("active");
            }
          }
          renderModifierList();
          updateSummary();
        });
      }

      /* ------ Trait Selector ------ */
      if ( hasTraits ) {
        const traitRows = form.querySelectorAll(".trait-row");
        for ( const row of traitRows ) {
          const itemId = row.dataset.traitId;
          for ( const btn of row.querySelectorAll(".trait-btn") ) {
            btn.addEventListener("click", () => {
              const mode = btn.dataset.mode;
              const againstType = btn.dataset.againstType || null;
              // Toggle off if same button clicked
              if ( traitState.itemId === itemId && traitState.mode === mode
                && traitState.againstType === againstType ) {
                traitState.itemId = null;
                traitState.mode = "none";
                traitState.againstType = null;
              } else {
                traitState.itemId = itemId;
                traitState.mode = mode;
                traitState.againstType = againstType;
              }
              // Update active states on all trait buttons
              for ( const r of traitRows ) {
                const rId = r.dataset.traitId;
                for ( const b of r.querySelectorAll(".trait-btn") ) {
                  const bAgainstType = b.dataset.againstType || null;
                  b.classList.toggle("active",
                    rId === traitState.itemId
                    && b.dataset.mode === traitState.mode
                    && bAgainstType === traitState.againstType
                  );
                }
              }
              renderModifierList();
              updateSummary();
            });
          }
        }
      }

      /* ------ Persona Controls ------ */
      if ( showPersona ) {
        const advValue = form.querySelector(".stepper-value[data-field='personaAdvantage']");
        const personaTotalEl = form.querySelector(".persona-total-value");
        const channelCheckbox = form.querySelector("input[name='channelNature']");

        function updatePersonaDisplay() {
          if ( advValue ) advValue.textContent = personaState.advantage;
          const cost = personaState.advantage + (personaState.channelNature ? 1 : 0);
          if ( personaTotalEl ) personaTotalEl.textContent = cost;
        }

        for ( const btn of form.querySelectorAll(".persona-advantage .stepper-btn") ) {
          btn.addEventListener("click", () => {
            const delta = Number(btn.dataset.delta);
            const maxAdv = Math.min(3, personaAvailable - (personaState.channelNature ? 1 : 0));
            personaState.advantage = Math.max(0, Math.min(maxAdv, personaState.advantage + delta));
            updatePersonaDisplay();
            renderModifierList();
            updateSummary();
          });
        }

        if ( channelCheckbox ) {
          channelCheckbox.addEventListener("change", () => {
            personaState.channelNature = channelCheckbox.checked;
            // Clamp advantage if needed
            const maxAdv = Math.min(3, personaAvailable - (personaState.channelNature ? 1 : 0));
            personaState.advantage = Math.min(personaState.advantage, maxAdv);
            updatePersonaDisplay();
            renderModifierList();
            updateSummary();
          });
        }
        updatePersonaDisplay();
      }

      /* ------ Within Nature Toggle (Direct Nature Tests) ------ */
      if ( isDirectNatureTest ) {
        const withinToggle = form.querySelector(".nature-switch");
        if ( withinToggle ) {
          withinToggle.addEventListener("click", () => {
            natureState.withinNature = !natureState.withinNature;
            const label = withinToggle.querySelector(".nature-switch-label");
            if ( label ) {
              label.textContent = natureState.withinNature
                ? game.i18n.localize("TB2E.Nature.ActingWithin")
                : game.i18n.localize("TB2E.Nature.OutsideDescriptors");
            }
            withinToggle.classList.toggle("within", natureState.withinNature);
            withinToggle.classList.toggle("outside", !natureState.withinNature);
          });
        }
      }

      /* ------ Manual Modifier Add ------ */
      const addBtn = form.querySelector(".add-modifier-btn");
      if ( addBtn ) {
        addBtn.addEventListener("click", () => {
          const row = document.createElement("div");
          row.className = "manual-modifier-input";
          row.innerHTML = `
            <input type="text" class="manual-label" placeholder="${game.i18n.localize("TB2E.Roll.ModifierLabel")}" value="">
            <select class="manual-type">
              <option value="dice">D</option>
              <option value="success">s</option>
              <option value="obstacle">Ob</option>
            </select>
            <input type="number" class="manual-value" value="1" min="-10" max="10">
            <button type="button" class="manual-confirm"><i class="fa-solid fa-check"></i></button>
            <button type="button" class="manual-cancel"><i class="fa-solid fa-xmark"></i></button>
          `;
          addBtn.before(row);
          row.querySelector(".manual-label").focus();
          row.querySelector(".manual-confirm").addEventListener("click", () => {
            const mlabel = row.querySelector(".manual-label").value.trim() || game.i18n.localize("TB2E.Roll.ManualModifier");
            const mtype = row.querySelector(".manual-type").value;
            const mvalue = Number(row.querySelector(".manual-value").value) || 0;
            if ( mvalue !== 0 ) {
              manualModifiers.push(createModifier({
                label: mlabel, type: mtype, value: mvalue, source: "manual",
                icon: "fa-solid fa-sliders", color: "--tb-steel",
                timing: mtype === "success" ? "post" : "pre"
              }));
              renderModifierList();
              updateSummary();
            }
            row.remove();
          });
          row.querySelector(".manual-cancel").addEventListener("click", () => row.remove());
          // Enter key confirms
          row.querySelector(".manual-label").addEventListener("keydown", e => {
            if ( e.key === "Enter" ) row.querySelector(".manual-confirm").click();
          });
          row.querySelector(".manual-value").addEventListener("keydown", e => {
            if ( e.key === "Enter" ) row.querySelector(".manual-confirm").click();
          });
        });
      }

      /* ------ Summary Update ------ */
      let updateSummary;

      if ( disposition ) {
        updateSummary = () => {
          const allMods = _collectAllModifiers();
          const diceBonus = allMods.filter(m => m.timing === "pre" && m.type === "dice").reduce((s, m) => s + m.value, 0);
          const pool = Number(form.elements.poolSize.value) + diceBonus;
          summary.textContent = `${pool}D`;
        };
        form.elements.poolSize.addEventListener("input", updateSummary);
      } else {
        const modeInput = form.querySelector("input[name='mode']");
        const modeToggle = form.querySelector(".roll-dialog-mode-toggle");
        const modeLabel = modeToggle.querySelector(".mode-label");
        const obstacleField = form.querySelector(".roll-field-obstacle");
        const challengeField = form.querySelector(".roll-dialog-challenge");
        const challengeSelect = form.elements.challengeMessageId;

        // Pre-set versus mode from testContext (e.g., spell casting)
        if ( testContext.isVersus ) {
          modeInput.value = "versus";
          modeLabel.textContent = game.i18n.localize("TB2E.Roll.Versus");
          obstacleField.classList.add("hidden");
          challengeField.classList.remove("hidden");
          for ( const btn of form.querySelectorAll(".trait-btn-versus") ) {
            btn.classList.remove("hidden");
          }
        }

        updateSummary = () => {
          const allMods = _collectAllModifiers();
          const diceBonus = allMods.filter(m => m.timing === "pre" && m.type === "dice").reduce((s, m) => s + m.value, 0);
          const successBonus = allMods.filter(m => m.timing === "post" && m.type === "success").reduce((s, m) => s + m.value, 0);
          const pool = Number(form.elements.poolSize.value) + diceBonus;

          const obBonus = allMods.filter(m => m.type === "obstacle").reduce((s, m) => s + m.value, 0);

          let summaryText;
          if ( modeInput.value === "versus" ) {
            const sel = challengeSelect.options[challengeSelect.selectedIndex];
            summaryText = sel?.value
              ? `${pool}D vs ${sel.dataset.actorName ?? "?"}`
              : `${pool}D Versus`;
          } else {
            const ob = Number(form.elements.obstacle.value) + obBonus;
            summaryText = `${pool}D vs Ob ${ob}`;
          }
          if ( successBonus > 0 ) summaryText += ` (+${successBonus}s on pass)`;
          summary.textContent = summaryText;
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
          // Show/hide +2D opponent buttons based on versus mode
          for ( const btn of form.querySelectorAll(".trait-btn-versus") ) {
            btn.classList.toggle("hidden", newMode !== "versus");
          }
          // Clear trait against selection if switching away from versus and opponent-bonus was selected
          if ( newMode !== "versus" && traitState.againstType === "opponent-bonus" ) {
            traitState.itemId = null;
            traitState.mode = "none";
            traitState.againstType = null;
            for ( const b of form.querySelectorAll(".trait-btn") ) b.classList.remove("active");
            renderModifierList();
          }
          updateSummary();
        });

        form.elements.poolSize.addEventListener("input", updateSummary);
        form.elements.obstacle.addEventListener("input", updateSummary);
        challengeSelect.addEventListener("change", () => {
          // Check if selected challenge has a trait opponent bonus for us
          const selectedMsgId = challengeSelect.value;
          // Remove any existing opponent-bonus context modifier
          const existingIdx = contextModifiers.findIndex(m => m.source === "trait-opponent");
          if ( existingIdx >= 0 ) contextModifiers.splice(existingIdx, 1);

          if ( selectedMsgId ) {
            const initMsg = game.messages.get(selectedMsgId);
            const bonus = initMsg?.getFlag("tb2e", "traitOpponentBonus");
            if ( bonus?.value ) {
              contextModifiers.push(createModifier({
                label: `${bonus.traitName} (opponent's trait)`,
                type: "dice", value: bonus.value, source: "trait-opponent",
                icon: "fa-solid fa-fingerprint", color: "--tb-cond-angry", timing: "pre"
              }));
            }
          }
          renderModifierList();
          updateSummary();
        });
      }

      // Expose state to the roll button callback via dialog element
      dialog.element.__tb2eCollectModifiers = _collectAllModifiers;
      dialog.element.__tb2eTraitState = traitState;
      dialog.element.__tb2ePersonaState = personaState;
      dialog.element.__tb2eNatureState = natureState;

      // Initial render
      renderModifierList();
      updateSummary();
    },
    buttons: [
      {
        action: "roll",
        label: game.i18n.localize("TB2E.Roll.RollButton"),
        icon: "fa-solid fa-dice",
        default: true,
        callback: (event, button, dialog) => {
          // Collect final modifier state
          const form = button.form;

          // Re-collect all modifiers (same logic as in render)
          // We need the _collectAllModifiers from the closure; store it on the form
          const allMods = dialog.element.__tb2eCollectModifiers?.() ?? [];

          const preModifiers = allMods.filter(m => m.timing === "pre" && m.type === "dice");
          const totalDiceBonus = preModifiers.reduce((s, m) => s + m.value, 0);

          // Selected helpers
          const activeToggles = form.querySelectorAll(".helper-toggle.active");
          const selectedHelpers = Array.from(activeToggles).map(el => {
            const row = el.closest(".helper-row");
            return {
              id: el.dataset.helperId,
              name: el.querySelector(".helper-name").textContent.trim(),
              helpVia: el.dataset.helpVia || "",
              helpViaType: el.dataset.helpViaType || "",
              helpViaLabel: el.querySelector(".helper-via")?.textContent.trim() || "",
              synergy: row ? row.classList.contains("synergy-active") : false
            };
          });

          // Selected wise aiders (I Am Wise)
          const selectedWiseAiders = Array.from(form.querySelectorAll(".wise-aid-toggle.active")).map(el => ({
            id: el.dataset.helperId,
            name: el.dataset.helperName,
            wiseIndex: Number(el.dataset.wiseIndex),
            wiseName: el.dataset.wiseName
          }));

          // Wise selection
          const wiseSelect = form.elements.wise;
          const wiseIndex = wiseSelect ? Number(wiseSelect.value) : -1;

          // Trait state from closure
          const traitInfo = dialog.element.__tb2eTraitState ?? { itemId: null, mode: "none", againstType: null };
          const personaInfo = dialog.element.__tb2ePersonaState ?? { advantage: 0, channelNature: false };
          const natureInfo = dialog.element.__tb2eNatureState ?? { withinNature: false };

          const baseDice = form.elements.poolSize.valueAsNumber;

          if ( disposition ) {
            return {
              baseDice,
              poolSize: baseDice + totalDiceBonus,
              selectedHelpers,
              modifiers: allMods
            };
          }
          // Supply item ID for consumption after roll
          const activeSupplyBtn = form.querySelector(".supply-bonus-toggle.active");
          const supplyItemId = activeSupplyBtn ? activeSupplyBtn.dataset.itemId : null;

          const obMods = allMods.filter(m => m.type === "obstacle");
          const obBonus = obMods.reduce((s, m) => s + m.value, 0);
          const baseObstacle = form.elements.obstacle.valueAsNumber;

          return {
            baseDice,
            poolSize: baseDice + totalDiceBonus,
            obstacle: baseObstacle + obBonus,
            baseObstacle,
            logAdvancement: form.elements.logAdvancement.checked,
            mode: form.elements.mode.value,
            challengeMessageId: form.elements.challengeMessageId.value,
            selectedHelpers,
            selectedWiseAiders,
            modifiers: allMods,
            traitState: traitInfo,
            personaState: personaInfo,
            natureState: natureInfo,
            wiseIndex,
            supplyItemId
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

  // Attach testContext for downstream flag storage
  result.testContext = testContext;
  return result;
}

/* -------------------------------------------- */
/*  Roll Execution                              */
/* -------------------------------------------- */

/**
 * Evaluate a dice roll and build display data.
 * @param {number} poolSize
 * @returns {Promise<{roll: Roll, successes: number, diceResults: object[]}>}
 */
export async function evaluateRoll(poolSize) {
  const clamped = Math.max(poolSize, 1);
  const formula = `${clamped}d6cs>=4`;
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
 * Show the disposition roll dialog for a conflict captain.
 * @param {object} options
 * @param {Actor} options.actor
 * @param {string} options.skillKey
 * @param {string} options.abilityKey
 * @param {object[]} [options.availableHelpers=[]]
 * @returns {Promise<object|null>}
 */
export async function rollDisposition({ actor, skillKey, abilityKey, availableHelpers = [] }) {
  const skillCfg = skills[skillKey];
  const abilityCfg = abilities[abilityKey];
  const skillLabel = game.i18n.localize(skillCfg.label);
  const abilityLabel = game.i18n.localize(abilityCfg.label);

  const skillRating = actor.system.skills[skillKey]?.rating || 0;
  const abilityRating = actor.system.abilities[abilityKey]?.rating || 0;

  const conditionModifiers = [...gatherConditionModifiers(actor)];

  const result = await _showRollDialog({
    label: skillLabel,
    dice: skillRating,
    conditionModifiers,
    actor,
    actorId: actor.id,
    disposition: true,
    availableHelpers
  });
  if ( !result ) return null;
  return {
    baseDice: result.baseDice,
    poolSize: result.poolSize,
    selectedHelpers: result.selectedHelpers,
    label: skillLabel,
    modifiers: conditionModifiers,
    skillLabel,
    abilityLabel,
    abilityRating
  };
}

/* -------------------------------------------- */
/*  Main Roll Entry Point                       */
/* -------------------------------------------- */

/**
 * Perform a test roll for a Torchbearer ability or skill.
 * @param {object} options
 * @param {Actor} options.actor
 * @param {"ability"|"skill"} options.type
 * @param {string} options.key
 * @param {object} [options.testContext={}]
 */
export async function rollTest({ actor, type, key, testContext = {} }) {
  const { label, dice } = _resolveRollData(actor, type, key);

  // Detect Beginner's Luck
  const blInfo = _detectBeginnersLuck(actor, type, key);
  const baseDice = blInfo ? blInfo.blDice : dice;

  // Check afraid + BL restriction
  if ( blInfo && actor.system.conditions.afraid ) {
    ui.notifications.warn(game.i18n.localize("TB2E.Roll.AfraidBLWarning"));
    return;
  }

  // Gather modifiers
  const conditionModifiers = gatherConditionModifiers(actor, testContext);
  const contextModifiers = [
    ...(testContext.modifiers || []).map(m => createModifier(m)),
    ...(testContext.contextModifiers || [])
  ];
  const availableHelpers = getEligibleHelpers({ actor, type, key, testContext });
  const availableWiseAiders = getEligibleWiseAiders({ actor, testContext });

  // Backpack factor: +1 Ob for Fighter/Dungeoneer when carrying a backpack
  if ( type === "skill" && (key === "fighter" || key === "dungeoneer") && _checkBackpackEquipped(actor) ) {
    contextModifiers.push(createModifier({
      label: game.i18n.localize("TB2E.Roll.BackpackFactor"),
      type: "obstacle", value: 1, source: "context",
      icon: "fa-solid fa-bag-shopping", color: "--tb-amber", timing: "pre"
    }));
  }

  // Show dialog
  const config = await _showRollDialog({
    label,
    dice: baseDice,
    conditionModifiers,
    contextModifiers,
    actorId: actor.id,
    actor,
    availableHelpers,
    availableWiseAiders,
    blInfo,
    type,
    key,
    testContext
  });
  if ( !config ) return;

  // Collect all modifiers from the dialog result (already includes helpers, traits, persona, etc.)
  const allModifiers = config.modifiers || [];

  // Calculate final pool
  let poolSize;
  if ( blInfo ) {
    // BL: halve the halvable portion
    const { poolSize: blPool, halvingMod } = _applyBLHalving(config.baseDice, allModifiers);
    poolSize = blPool;
    if ( halvingMod.value !== 0 ) allModifiers.push(halvingMod);
  } else {
    const diceBonus = allModifiers
      .filter(m => m.timing === "pre" && m.type === "dice")
      .reduce((s, m) => s + m.value, 0);
    poolSize = Math.max(config.baseDice + diceBonus, 1);
  }

  const { roll, successes, diceResults } = await evaluateRoll(poolSize);

  // Calculate post-roll success modifiers
  const postSuccessMods = allModifiers.filter(m => m.timing === "post" && m.type === "success");

  // Apply actor state changes
  await _applyPreRollActorChanges({ actor, config, allModifiers });

  // Build roll context flags
  const rollFlags = _buildRollFlags({
    actor, type, key, label, baseDice: config.baseDice, poolSize, successes,
    diceResults, allModifiers, config, blInfo, postSuccessMods
  });

  if ( config.mode === "versus" ) {
    await _handleVersusRoll({
      actor, type, key, label, baseDice: config.baseDice, poolSize, successes,
      roll, diceResults, modifiers: allModifiers, logAdvancement: config.logAdvancement,
      config, rollFlags, postSuccessMods
    });
  } else {
    await _handleIndependentRoll({
      actor, type, key, label, baseDice: config.baseDice, poolSize, successes,
      roll, diceResults, modifiers: allModifiers, logAdvancement: config.logAdvancement,
      config, rollFlags, postSuccessMods
    });
  }
}

/* -------------------------------------------- */
/*  Actor State Changes (Pre-Roll)              */
/* -------------------------------------------- */

/**
 * Apply state changes to the actor after rolling (persona spend, trait use tracking, check earning).
 * @param {object} options
 * @param {Actor} options.actor
 * @param {object} options.config - Dialog result.
 * @param {object[]} options.allModifiers - All modifiers.
 */
async function _applyPreRollActorChanges({ actor, config, allModifiers }) {
  if ( actor.type !== "character" ) return;
  const updates = {};

  // Persona spending
  const personaCost = (config.personaState?.advantage ?? 0) + (config.personaState?.channelNature ? 1 : 0);
  if ( personaCost > 0 ) {
    updates["system.persona.current"] = Math.max(0, actor.system.persona.current - personaCost);
    updates["system.persona.spent"] = actor.system.persona.spent + personaCost;
  }

  // Trait use tracking
  const ts = config.traitState;
  if ( ts && ts.itemId && ts.mode !== "none" ) {
    const traitItem = actor.items.get(ts.itemId);
    if ( traitItem ) {
      if ( ts.mode === "benefit" && traitItem.system.level < 3 ) {
        await traitItem.update({ "system.beneficial": Math.max(0, traitItem.system.beneficial - 1) });
      } else if ( ts.mode === "against" ) {
        const checksEarned = ts.againstType === "opponent-bonus" ? 2 : 1;
        await traitItem.update({
          "system.checks": traitItem.system.checks + checksEarned,
          "system.usedAgainst": true
        });
        updates["system.checks"] = actor.system.checks + checksEarned;
      }
    }
  }

  if ( Object.keys(updates).length ) await actor.update(updates);

  // Supply consumption: if a supply modifier was selected, decrement quantity.
  const supplyMod = allModifiers.find(m => m.source === "supply");
  if ( supplyMod && config.supplyItemId ) {
    const supplyItem = actor.items.get(config.supplyItemId);
    if ( supplyItem && supplyItem.system.quantity > 0 ) {
      await supplyItem.update({ "system.quantity": supplyItem.system.quantity - 1 });
    }
  }
}

/* -------------------------------------------- */
/*  Roll Flag Building                          */
/* -------------------------------------------- */

/**
 * Build the flags object stored on the ChatMessage for post-roll interactions.
 */
function _buildRollFlags({ actor, type, key, label, baseDice, poolSize, successes,
  diceResults, allModifiers, config, blInfo, postSuccessMods }) {

  const wiseIndex = config.wiseIndex ?? -1;
  let wiseInfo = null;
  if ( wiseIndex >= 0 && actor.type === "character" ) {
    const wise = actor.system.wises[wiseIndex];
    if ( wise ) wiseInfo = { name: wise.name, index: wiseIndex };
  }

  return {
    roll: {
      type, key, label, baseDice, poolSize, successes,
      diceResults: diceResults.map(d => ({ ...d })),
      modifiers: allModifiers.map(m => ({ ...m })),
      isBL: !!blInfo,
      blAbilityKey: blInfo?.blAbilityKey ?? null,
      baseObstacle: config.baseObstacle ?? null
    },
    trait: config.traitState?.itemId ? (() => {
      const item = actor.items.get(config.traitState.itemId);
      return item ? {
        name: item.name,
        mode: config.traitState.mode,
        level: item.system.level,
        itemId: config.traitState.itemId,
        againstType: config.traitState.againstType
      } : null;
    })() : null,
    traitOpponentBonus: (config.traitState?.mode === "against" && config.traitState?.againstType === "opponent-bonus") ? {
      value: 2,
      traitName: actor.items.get(config.traitState.itemId)?.name ?? ""
    } : null,
    wise: wiseInfo,
    channelNature: config.personaState?.channelNature ?? false,
    directNatureTest: type === "ability" && key === "nature",
    withinNature: config.natureState?.withinNature ?? false,
    actorId: actor.id,
    resolved: false,
    postSuccessMods: postSuccessMods.map(m => ({ ...m })),
    luckUsed: false,
    deeperUsed: false,
    ofCourseUsed: false,
    testContext: config.testContext ? {
      spellId: config.testContext.spellId ?? null,
      spellName: config.testContext.spellName ?? null,
      castingSource: config.testContext.castingSource ?? null,
      scrollItemId: config.testContext.scrollItemId ?? null,
      invocationId: config.testContext.invocationId ?? null,
      invocationName: config.testContext.invocationName ?? null,
      hasRelic: config.testContext.hasRelic ?? null,
      burdenAmount: config.testContext.burdenAmount ?? null
    } : null
  };
}

/* -------------------------------------------- */
/*  Independent Roll Handler                    */
/* -------------------------------------------- */

async function _handleIndependentRoll({ actor, type, key, label, baseDice, poolSize, successes,
  roll, diceResults, modifiers, logAdvancement, config, rollFlags, postSuccessMods }) {

  const obstacle = config.obstacle;

  // Calculate post-roll success adjustments
  const autoSuccessBonus = postSuccessMods
    .filter(m => m.value < 0) // -1s apply unconditionally
    .reduce((s, m) => s + m.value, 0);
  const conditionalSuccessBonus = postSuccessMods
    .filter(m => m.value > 0) // +1s apply on pass/tie only
    .reduce((s, m) => s + m.value, 0);

  const adjustedSuccesses = successes + autoSuccessBonus;
  const isPassBeforeBonus = adjustedSuccesses >= obstacle;
  const finalSuccesses = isPassBeforeBonus ? adjustedSuccesses + conditionalSuccessBonus : adjustedSuccesses;
  const pass = finalSuccesses >= obstacle;

  // Update flags with final state
  rollFlags.roll.successes = successes;
  rollFlags.roll.finalSuccesses = finalSuccesses;
  rollFlags.roll.obstacle = obstacle;
  rollFlags.roll.pass = pass;

  // Build tbFlags-like object for buildChatTemplateData (rollFlags uses flat keys, not nested)
  const tbFlagsForTemplate = { ...rollFlags, resolved: false };
  const templateData = buildChatTemplateData({
    actor, rollData: rollFlags.roll, tbFlags: tbFlagsForTemplate, isVersus: false,
    synergyHelpers: _buildSynergyHelpers(config.selectedHelpers)
  });
  Object.assign(templateData, {
    showNatureTax: rollFlags.channelNature,
    showDirectNatureTax: rollFlags.directNatureTest && !rollFlags.withinNature,
    directNatureWithin: rollFlags.directNatureTest && rollFlags.withinNature
  });

  const chatContent = await foundry.applications.handlebars.renderTemplate(
    "systems/tb2e/templates/chat/roll-result.hbs", templateData
  );

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: chatContent,
    rolls: [roll],
    type: CONST.CHAT_MESSAGE_STYLES.OTHER,
    flags: {
      tb2e: {
        ...rollFlags,
        helpers: mapHelpersForFlags(config.selectedHelpers),
        wiseAiders: mapWiseAidersForFlags(config.selectedWiseAiders)
      }
    }
  });
}


/**
 * Build the synergyHelpers array for the chat card template.
 * @param {object[]} helpers - Helper array (from selectedHelpers or message flags)
 * @param {object} [helperSynergy={}] - Already-processed synergy map { actorId: true }
 * @returns {object[]} Filtered helpers with localized labels
 */
export function _buildSynergyHelpers(helpers, helperSynergy = {}) {
  return (helpers || [])
    .filter(h => h.synergy && !helperSynergy[h.id])
    .map(h => {
      const cfg = h.helpViaType === "skill" ? skills[h.helpVia] : abilities[h.helpVia];
      return {
        id: h.id,
        name: h.name,
        helpViaLabel: cfg ? game.i18n.localize(cfg.label) : h.helpVia
      };
    });
}

/* -------------------------------------------- */
/*  Versus Roll Handler                         */
/* -------------------------------------------- */

async function _handleVersusRoll({ actor, type, key, label, baseDice, poolSize, successes,
  roll, diceResults, modifiers, logAdvancement, config, rollFlags, postSuccessMods }) {

  const isOpponent = !!config.challengeMessageId;

  // Store raw successes in roll flags (no obstacle-based pass/fail for versus)
  rollFlags.roll.successes = successes;
  rollFlags.roll.finalSuccesses = successes;
  rollFlags.roll.obstacle = null;
  rollFlags.roll.pass = null;

  // Apply post-success modifiers to the stored successes
  const successBonus = postSuccessMods.reduce((s, m) => s + m.value, 0);
  if ( successBonus !== 0 ) {
    const adjusted = Math.max(successes + successBonus, 0);
    rollFlags.roll.successes = successes;
    rollFlags.roll.finalSuccesses = adjusted;
  }

  // Build template data — reuse roll-result.hbs with versus mode
  const tbFlagsForTemplate = { ...rollFlags, resolved: false };
  const templateData = buildChatTemplateData({
    actor, rollData: rollFlags.roll, tbFlags: tbFlagsForTemplate, isVersus: true,
    synergyHelpers: _buildSynergyHelpers(config.selectedHelpers)
  });
  templateData.versusFinalized = false;

  const chatContent = await foundry.applications.handlebars.renderTemplate(
    "systems/tb2e/templates/chat/roll-result.hbs", templateData
  );

  if ( isOpponent ) {
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

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: chatContent,
      rolls: [roll],
      type: CONST.CHAT_MESSAGE_STYLES.OTHER,
      flags: {
        tb2e: {
          ...rollFlags,
          versus: {
            type: "opponent",
            initiatorMessageId: initiatorMessage.id,
            initiatorActorId: initiatorVs.initiatorActorId,
            opponentActorId: actor.id,
            rollType: type, rollKey: key, label, baseDice,
            logAdvancement, isBL: !!rollFlags.roll.isBL, resolved: false
          },
          helpers: mapHelpersForFlags(config.selectedHelpers),
          wiseAiders: mapWiseAidersForFlags(config.selectedWiseAiders)
        }
      }
    });
  } else {
    const message = await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: chatContent,
      rolls: [roll],
      type: CONST.CHAT_MESSAGE_STYLES.OTHER,
      flags: {
        tb2e: {
          ...rollFlags,
          versus: {
            type: "initiator",
            initiatorActorId: actor.id,
            rollType: type, rollKey: key, label, baseDice,
            logAdvancement, isBL: !!rollFlags.roll.isBL, resolved: false
          },
          helpers: mapHelpersForFlags(config.selectedHelpers),
          wiseAiders: mapWiseAidersForFlags(config.selectedWiseAiders)
        }
      }
    });

    PendingVersusRegistry.register(message.id);
  }
}
