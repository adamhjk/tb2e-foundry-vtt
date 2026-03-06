import { createModifier } from "./tb2e-roll.mjs";

/**
 * Main spell casting entry point.
 * @param {Actor} actor - The casting actor.
 * @param {Item} spellItem - The spell Item document.
 * @param {string} source - "memory" | "spellbook" | "scroll"
 * @param {object} [opts] - Additional options.
 * @param {string} [opts.scrollItemId] - The scroll item ID (when casting from scroll).
 */
export async function castSpell(actor, spellItem, source, opts = {}) {
  const { rollTest } = await import("./tb2e-roll.mjs");
  const castingType = spellItem.system.castingType;

  // Skill-swap spells don't require a casting roll.
  if ( castingType === "skillSwap" ) {
    const msg = game.i18n.format("TB2E.Spell.SkillSwapActive", { name: spellItem.name });
    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p>${msg}</p>`,
      type: CONST.CHAT_MESSAGE_STYLES.OTHER
    });
    return;
  }

  // Build context modifiers for materials and focus.
  const contextModifiers = [];
  if ( spellItem.system.materials ) {
    contextModifiers.push(createModifier({
      label: game.i18n.localize("TB2E.Spell.MaterialsBonus"),
      type: "dice", value: 1, source: "spell",
      icon: "fa-solid fa-mortar-pestle", color: "--tb-green",
      timing: "pre"
    }));
  }
  if ( spellItem.system.focus ) {
    contextModifiers.push(createModifier({
      label: game.i18n.localize("TB2E.Spell.FocusBonus"),
      type: "dice", value: 1, source: "spell",
      icon: "fa-solid fa-wand-sparkles", color: "--tb-green",
      timing: "pre"
    }));
  }

  const testContext = {
    spellId: spellItem.id,
    spellName: spellItem.name,
    castingSource: source,
    scrollItemId: opts.scrollItemId || null,
    contextModifiers
  };

  if ( castingType === "fixed" ) {
    let obstacle = spellItem.system.fixedObstacle;
    testContext.obstacle = obstacle;
    return rollTest({ actor, type: "skill", key: "arcanist", testContext });
  }

  if ( castingType === "factors" ) {
    const obstacle = await _showFactorDialog(spellItem);
    if ( obstacle === null ) return; // Cancelled
    testContext.obstacle = obstacle;
    return rollTest({ actor, type: "skill", key: "arcanist", testContext });
  }

  if ( castingType === "versus" ) {
    testContext.isVersus = true;
    return rollTest({ actor, type: "skill", key: "arcanist", testContext });
  }
}

/**
 * Show the factor selection dialog for a factor-type spell.
 * @param {Item} spellItem
 * @returns {Promise<number|null>} The computed obstacle, or null if cancelled.
 */
async function _showFactorDialog(spellItem) {
  const factors = (spellItem.system.factors || []).map((group, gi) => ({
    ...group,
    groupIndex: gi,
    options: (group.options || []).map((opt, oi) => ({
      ...opt,
      optionIndex: oi
    }))
  }));

  const content = await foundry.applications.handlebars.renderTemplate(
    "systems/tb2e/templates/dice/spell-factors.hbs", {
      spellName: spellItem.name,
      factors,
      factorNote: spellItem.system.factorNote
    }
  );

  return new Promise((resolve) => {
    const dialog = new foundry.applications.api.DialogV2({
      window: { title: `${spellItem.name} — ${game.i18n.localize("TB2E.Spell.Factors")}` },
      content,
      buttons: [
        {
          action: "cast",
          label: game.i18n.localize("TB2E.Spell.CastButton"),
          icon: "fa-solid fa-hat-wizard",
          callback: (event, button, dialog) => {
            // Compute total from selected radio buttons.
            let total = 0;
            for ( const radio of button.form?.querySelectorAll("input[type='radio']:checked") ?? [] ) {
              total += Number(radio.value) || 0;
            }
            resolve(total);
          }
        },
        {
          action: "cancel",
          label: game.i18n.localize("TB2E.Advance.Cancel"),
          callback: () => resolve(null)
        }
      ],
      close: () => resolve(null),
      render: (event, html) => {
        // Live obstacle total update.
        const totalEl = html.querySelector(".factor-total-value");
        if ( !totalEl ) return;
        function updateTotal() {
          let total = 0;
          for ( const radio of html.querySelectorAll("input[type='radio']:checked") ) {
            total += Number(radio.value) || 0;
          }
          totalEl.textContent = total;
        }
        for ( const radio of html.querySelectorAll("input[type='radio']") ) {
          radio.addEventListener("change", updateTotal);
        }
        updateTotal();
      }
    });
    dialog.render(true);
  });
}

/**
 * Process post-roll spell state changes after a successful casting roll.
 * Called from the post-roll flow when testContext has spellId.
 * @param {Actor} actor
 * @param {object} testContext
 * @param {boolean} passed - Whether the test passed.
 */
export async function processSpellCast(actor, testContext, passed) {
  if ( !testContext?.spellId ) return;

  const source = testContext.castingSource;

  // Scrolls are consumed regardless of pass/fail — post a chat confirmation card
  if ( source === "scroll" ) {
    const spell = actor.items.get(testContext.spellId);
    if ( spell ) await spell.update({ "system.cast": true });
    await _postSpellSourceCard(actor, testContext);
    return;
  }

  if ( !passed ) return;

  const spell = actor.items.get(testContext.spellId);
  if ( !spell ) return;

  await spell.update({ "system.cast": true });

  if ( source === "memory" ) {
    await spell.update({ "system.memorized": false });
  } else if ( source === "spellbook" ) {
    // Post a chat confirmation card instead of auto-clearing
    await _postSpellSourceCard(actor, testContext);
  }
}

/* -------------------------------------------- */
/*  Spell Source Consumption Card                */
/* -------------------------------------------- */

const SPELL_SOURCE_TEMPLATE = "systems/tb2e/templates/chat/spell-source.hbs";

/**
 * Post a chat card prompting the player to confirm spell source consumption.
 * @param {Actor} actor
 * @param {object} testContext
 */
async function _postSpellSourceCard(actor, testContext) {
  const source = testContext.castingSource;
  const spellName = testContext.spellName || "Unknown Spell";

  let flavorText, buttonLabel, buttonIcon, spellbookName;

  if ( source === "scroll" ) {
    flavorText = game.i18n.format("TB2E.Spell.ScrollSourceText", {
      name: actor.name, spellName
    });
    buttonLabel = game.i18n.localize("TB2E.Spell.ConsumeScroll");
    buttonIcon = "fa-solid fa-fire";
  } else if ( source === "spellbook" ) {
    // Look up the spellbook name
    const spell = actor.items.get(testContext.spellId);
    const spellbookId = spell?.system?.spellbookId;
    const spellbook = spellbookId ? actor.items.get(spellbookId) : null;
    spellbookName = spellbook?.name || "spellbook";
    flavorText = game.i18n.format("TB2E.Spell.SpellbookSourceText", {
      name: actor.name, spellName, spellbookName
    });
    buttonLabel = game.i18n.localize("TB2E.Spell.RemoveFromSpellbook");
    buttonIcon = "fa-solid fa-book-skull";
  }

  const cardContent = await foundry.applications.handlebars.renderTemplate(
    SPELL_SOURCE_TEMPLATE, {
      actorName: actor.name,
      actorImg: actor.img,
      actorId: actor.id,
      spellName,
      flavorText,
      buttonLabel,
      buttonIcon
    }
  );

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: cardContent,
    type: CONST.CHAT_MESSAGE_STYLES.OTHER,
    flags: {
      tb2e: {
        spellSource: {
          type: source,
          actorId: actor.id,
          spellId: testContext.spellId,
          spellName,
          scrollItemId: testContext.scrollItemId || null,
          spellbookName: spellbookName || null
        }
      }
    }
  });
}

/**
 * Register click handlers on spell source consumption chat cards.
 * @param {ChatMessage} message
 * @param {HTMLElement} html
 */
export function activateSpellSourceListeners(message, html) {
  const flags = message.getFlag("tb2e", "spellSource");
  if ( !flags || flags.resolved ) return;

  const btn = html.querySelector(".spell-source-confirm");
  if ( !btn ) return;

  btn.addEventListener("click", async (event) => {
    event.preventDefault();
    const actor = game.actors.get(flags.actorId);
    if ( !actor || !actor.isOwner ) return;

    if ( flags.type === "scroll" ) {
      const scroll = actor.items.get(flags.scrollItemId);
      if ( scroll ) await scroll.delete();
    } else if ( flags.type === "spellbook" ) {
      const spell = actor.items.get(flags.spellId);
      if ( spell ) await spell.update({ "system.spellbookId": "" });
    }

    // Determine resolved text
    const resolvedText = flags.type === "scroll"
      ? game.i18n.localize("TB2E.Spell.ScrollConsumed")
      : game.i18n.localize("TB2E.Spell.RemovedFromSpellbook");
    const resolvedLabel = resolvedText;

    // Mark resolved and re-render
    await message.update({ "flags.tb2e.spellSource.resolved": true });
    const resolvedContent = await foundry.applications.handlebars.renderTemplate(
      SPELL_SOURCE_TEMPLATE, {
        actorName: actor.name,
        actorImg: actor.img,
        actorId: actor.id,
        spellName: flags.spellName,
        resolved: true,
        resolvedText,
        resolvedLabel
      }
    );
    await message.update({ content: resolvedContent });
  });
}
