import { abilities, advancementNeeded, conditions, skills } from "../config.mjs";
import { showAdvancementDialog } from "./advancement.mjs";
import { PendingVersusRegistry } from "./versus.mjs";
import { getEligibleHelpers } from "./help.mjs";

/* ============================================ */
/*  Modifier Subsystem                          */
/* ============================================ */

/**
 * Create a standardized roll modifier.
 * @param {object} data
 * @param {string} data.label - Human-readable label.
 * @param {"dice"|"success"} [data.type="dice"] - Whether it modifies dice or successes.
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
  const unit = type === "dice" ? "D" : "s";
  return { label, type, value, source, icon, color, timing, display: `${sign}${Math.abs(value)}${unit}` };
}

/* -------------------------------------------- */
/*  Shared Helpers                              */
/* -------------------------------------------- */

/**
 * Build a subtitle string for chat cards based on actor type.
 * @param {Actor} actor
 * @returns {string}
 */
function _buildActorSubtitle(actor) {
  if ( actor.type !== "npc" ) return "";
  const parts = [actor.system.stock, actor.system.class].filter(Boolean);
  return parts.length ? `NPC \u2014 ${parts.join(" ")}` : "NPC";
}

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
  return Math.max(Math.ceil(halvable / 2) + nonHalvable, 1);
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
  return (actor.system.traits || []).map((t, i) => {
    const maxBeneficial = t.level >= 3 ? 0 : t.level;
    const benefitDisabled = isAngry || (t.level < 3 && t.beneficial <= 0);
    return {
      index: i,
      name: t.name,
      level: t.level,
      beneficial: t.beneficial,
      maxBeneficial,
      isL3: t.level >= 3,
      benefitDisabled,
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
  disposition = false, availableHelpers = [], blInfo = null, type, key, testContext = {}
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

  const content = await foundry.applications.handlebars.renderTemplate(
    "systems/tb2e/templates/dice/roll-dialog.hbs", {
      label, dice, disposition,
      conditionModifiers, contextModifiers,
      hasHelpers, pcHelpers, npcHelpers,
      hasTraits, traits: traitData,
      hasWises, wises: wiseData,
      showPersona, personaAvailable,
      hideChannelNature, natureRating,
      isDirectNatureTest, natureDescriptors, channelNatureDescriptors,
      blInfo,
      isAfraid, isAngry,
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
  const traitState = { index: -1, mode: "none" };
  const personaState = { advantage: 0, channelNature: false };
  const natureState = { withinNature: false };

  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: dialogTitle },
    classes: ["tb2e", "roll-dialog"],
    content,
    render: (event, dialog) => {
      const form = dialog.element.querySelector("form");
      const summary = form.querySelector(".roll-dialog-summary-text");
      const modContainer = form.querySelector(".roll-dialog-modifiers");

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

        // Trait modifier
        if ( traitState.index >= 0 && traitState.mode !== "none" ) {
          const t = traitData[traitState.index];
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
            all.push(createModifier({
              label: `${t.name} (against)`, type: "dice", value: -1, source: "trait",
              icon: "fa-solid fa-fingerprint", color: "--tb-cond-angry", timing: "pre"
            }));
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

        // Manual modifiers
        all.push(...manualModifiers);
        return all;
      }

      /* ------ Helper Toggles ------ */
      for ( const btn of form.querySelectorAll(".helper-toggle") ) {
        btn.addEventListener("click", () => {
          btn.classList.toggle("active");
          // Clear synergy when helper is deactivated
          const row = btn.closest(".helper-row");
          if ( !btn.classList.contains("active") && row ) {
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
            helperBonus = form.querySelectorAll(".helper-toggle.active").length;
            renderModifierList();
            updateSummary();
          }
          row.classList.toggle("synergy-active");
        });
      }

      /* ------ Trait Selector ------ */
      if ( hasTraits ) {
        const traitRows = form.querySelectorAll(".trait-row");
        for ( const row of traitRows ) {
          const idx = Number(row.dataset.traitIndex);
          for ( const btn of row.querySelectorAll(".trait-btn") ) {
            btn.addEventListener("click", () => {
              const mode = btn.dataset.mode;
              // Toggle off if same button clicked
              if ( traitState.index === idx && traitState.mode === mode ) {
                traitState.index = -1;
                traitState.mode = "none";
              } else {
                traitState.index = idx;
                traitState.mode = mode;
              }
              // Update active states on all trait buttons
              for ( const r of traitRows ) {
                const rIdx = Number(r.dataset.traitIndex);
                for ( const b of r.querySelectorAll(".trait-btn") ) {
                  b.classList.toggle("active", rIdx === traitState.index && b.dataset.mode === traitState.mode);
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
        const withinToggle = form.querySelector("input[name='withinNature']");
        if ( withinToggle ) {
          withinToggle.addEventListener("change", () => {
            natureState.withinNature = withinToggle.checked;
            const label = form.querySelector(".nature-within-label");
            if ( label ) {
              label.textContent = natureState.withinNature
                ? game.i18n.localize("TB2E.Nature.ActingWithin")
                : game.i18n.localize("TB2E.Nature.OutsideDescriptors");
              label.classList.toggle("within", natureState.withinNature);
              label.classList.toggle("outside", !natureState.withinNature);
            }
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

        updateSummary = () => {
          const allMods = _collectAllModifiers();
          const diceBonus = allMods.filter(m => m.timing === "pre" && m.type === "dice").reduce((s, m) => s + m.value, 0);
          const successBonus = allMods.filter(m => m.timing === "post" && m.type === "success").reduce((s, m) => s + m.value, 0);
          const pool = Number(form.elements.poolSize.value) + diceBonus;

          let summaryText;
          if ( modeInput.value === "versus" ) {
            const sel = challengeSelect.options[challengeSelect.selectedIndex];
            summaryText = sel?.value
              ? `${pool}D vs ${sel.dataset.actorName ?? "?"}`
              : `${pool}D Versus`;
          } else {
            const ob = form.elements.obstacle.value;
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
          updateSummary();
        });

        form.elements.poolSize.addEventListener("input", updateSummary);
        form.elements.obstacle.addEventListener("input", updateSummary);
        challengeSelect.addEventListener("change", updateSummary);
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

          // Wise selection
          const wiseSelect = form.elements.wise;
          const wiseIndex = wiseSelect ? Number(wiseSelect.value) : -1;

          // Trait state from closure
          const traitInfo = dialog.element.__tb2eTraitState ?? { index: -1, mode: "none" };
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
          return {
            baseDice,
            poolSize: baseDice + totalDiceBonus,
            obstacle: form.elements.obstacle.valueAsNumber,
            logAdvancement: form.elements.logAdvancement.checked,
            mode: form.elements.mode.value,
            challengeMessageId: form.elements.challengeMessageId.value,
            selectedHelpers,
            modifiers: allMods,
            traitState: traitInfo,
            personaState: personaInfo,
            natureState: natureInfo,
            wiseIndex
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

  // Patch in the dialog state that was stored on the element
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
  const contextModifiers = (testContext.modifiers || []).map(m => createModifier(m));
  const availableHelpers = getEligibleHelpers({ actor, type, key, testContext });

  // Show dialog
  const config = await _showRollDialog({
    label,
    dice: baseDice,
    conditionModifiers,
    contextModifiers,
    actorId: actor.id,
    actor,
    availableHelpers,
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
    poolSize = _applyBLHalving(config.baseDice, allModifiers);
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
      config, rollFlags
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
  if ( ts && ts.index >= 0 && ts.mode !== "none" ) {
    const traits = foundry.utils.deepClone(actor.system.traits);
    const trait = traits[ts.index];
    if ( trait ) {
      if ( ts.mode === "benefit" && trait.level < 3 ) {
        trait.beneficial = Math.max(0, trait.beneficial - 1);
      } else if ( ts.mode === "against" ) {
        // Earn checks: -1D = 1 check, +2D opponent / break tie = 2 checks
        const checksEarned = 1;
        trait.checks += checksEarned;
        updates["system.checks.earned"] = actor.system.checks.earned + checksEarned;
        updates["system.checks.remaining"] = actor.system.checks.remaining + checksEarned;
      }
      updates["system.traits"] = traits;
    }
  }

  if ( Object.keys(updates).length ) await actor.update(updates);
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
      blAbilityKey: blInfo?.blAbilityKey ?? null
    },
    trait: config.traitState?.index >= 0 ? {
      name: actor.system.traits?.[config.traitState.index]?.name,
      mode: config.traitState.mode,
      level: actor.system.traits?.[config.traitState.index]?.level
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
    ofCourseUsed: false
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

  const chatContent = await foundry.applications.handlebars.renderTemplate(
    "systems/tb2e/templates/chat/roll-result.hbs", {
      actorName: actor.name,
      actorImg: actor.img,
      actorSubtitle: _buildActorSubtitle(actor),
      label,
      baseDice,
      poolSize,
      obstacle,
      successes: finalSuccesses,
      pass,
      modifiers,
      diceResults,
      postSuccessMods: postSuccessMods.length ? postSuccessMods : null,
      isBL: !!rollFlags.roll.isBL,
      blAbilityLabel: rollFlags.roll.blAbilityKey ? game.i18n.localize(abilities[rollFlags.roll.blAbilityKey]?.label) : null,
      // Post-roll buttons visibility
      hasPostActions: _hasPostRollActions(rollFlags, actor),
      hasSuns: diceResults.some(d => d.isSun),
      hasWyrms: diceResults.some(d => !d.success),
      sunCount: diceResults.filter(d => d.isSun).length,
      wyrmCount: diceResults.filter(d => !d.success).length,
      wiseSelected: !!rollFlags.wise,
      hasFate: actor.type === "character" && actor.system.fate.current > 0,
      hasPersona: actor.type === "character" && actor.system.persona.current > 0,
      showNatureTax: rollFlags.channelNature,
      showDirectNatureTax: rollFlags.directNatureTest && !rollFlags.withinNature,
      directNatureWithin: rollFlags.directNatureTest && rollFlags.withinNature,
      synergyHelpers: _buildSynergyHelpers(config.selectedHelpers),
      passLabel: game.i18n.localize("TB2E.Roll.Pass"),
      failLabel: game.i18n.localize("TB2E.Roll.Fail"),
      successesLabel: game.i18n.localize("TB2E.Roll.Successes"),
      obstacleLabel: game.i18n.localize("TB2E.Roll.ObstacleLabel"),
      testLabel: game.i18n.localize("TB2E.Roll.Test"),
      testTypeLabel: rollFlags.roll.isBL
        ? game.i18n.format("TB2E.Roll.BLTest", { ability: game.i18n.localize(abilities[rollFlags.roll.blAbilityKey]?.label) })
        : game.i18n.localize("TB2E.Roll.Independent")
    }
  );

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: chatContent,
    rolls: [roll],
    type: CONST.CHAT_MESSAGE_STYLES.OTHER,
    flags: {
      tb2e: {
        ...rollFlags,
        helpers: (config.selectedHelpers || []).map(h => ({
          id: h.id, name: h.name, helpVia: h.helpVia, helpViaType: h.helpViaType, synergy: !!h.synergy
        }))
      }
    }
  });

  // Log advancement immediately for rolls without post-roll actions
  // (Post-roll actions like Fate Luck can change the result, so defer advancement for those)
  if ( logAdvancement && obstacle > 0 && !_hasPostRollActions(rollFlags, actor) ) {
    await _logAdvancement({ actor, type, key, baseDice, pass });
  }
}

/**
 * Check if the roll has any available post-roll actions.
 */
function _hasPostRollActions(rollFlags, actor) {
  if ( actor.type !== "character" ) return false;
  const diceResults = rollFlags.roll.diceResults;
  const hasSuns = diceResults.some(d => d.isSun);
  const hasWyrms = diceResults.some(d => !d.success);
  const hasFate = actor.system.fate.current > 0;
  const hasPersona = actor.system.persona.current > 0;

  if ( hasFate && hasSuns ) return true; // Luck
  if ( rollFlags.wise && hasFate && hasWyrms ) return true; // Deeper Understanding
  if ( rollFlags.wise && hasPersona && hasWyrms ) return true; // Of Course!
  if ( rollFlags.channelNature ) return true; // Nature tax prompt
  if ( rollFlags.directNatureTest && !rollFlags.withinNature ) return true; // Direct nature tax
  return false;
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
  roll, diceResults, modifiers, logAdvancement, config, rollFlags }) {

  const isOpponent = !!config.challengeMessageId;

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

    const chatContent = await foundry.applications.handlebars.renderTemplate(
      "systems/tb2e/templates/chat/versus-pending.hbs", {
        actorName: actor.name,
        actorImg: actor.img,
        actorSubtitle: _buildActorSubtitle(actor),
        label, baseDice, poolSize, successes, modifiers, diceResults,
        versusLabel: game.i18n.localize("TB2E.Roll.Versus"),
        testLabel: game.i18n.localize("TB2E.Roll.Test"),
        successesLabel: game.i18n.localize("TB2E.Roll.Successes"),
        pendingLabel: game.i18n.localize("TB2E.Roll.Pending")
      }
    );

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
            successes, rollType: type, rollKey: key, label, baseDice,
            logAdvancement, resolved: false
          },
          helpers: (config.selectedHelpers || []).map(h => ({
            id: h.id, name: h.name, helpVia: h.helpVia
          }))
        }
      }
    });
  } else {
    const chatContent = await foundry.applications.handlebars.renderTemplate(
      "systems/tb2e/templates/chat/versus-pending.hbs", {
        actorName: actor.name,
        actorImg: actor.img,
        actorSubtitle: _buildActorSubtitle(actor),
        label, baseDice, poolSize, successes, modifiers, diceResults,
        versusLabel: game.i18n.localize("TB2E.Roll.Versus"),
        testLabel: game.i18n.localize("TB2E.Roll.Test"),
        successesLabel: game.i18n.localize("TB2E.Roll.Successes"),
        pendingLabel: game.i18n.localize("TB2E.Roll.Pending")
      }
    );

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
            successes, rollType: type, rollKey: key, label, baseDice,
            logAdvancement, resolved: false
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
