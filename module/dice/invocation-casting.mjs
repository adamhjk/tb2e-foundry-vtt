import { createModifier } from "./tb2e-roll.mjs";

/**
 * Main invocation performing entry point.
 * @param {Actor} actor - The performing actor.
 * @param {Item} invocationItem - The invocation Item document.
 * @param {object} [opts] - Additional options.
 */
export async function performInvocation(actor, invocationItem, opts = {}) {
  const { rollTest } = await import("./tb2e-roll.mjs");
  const castingType = invocationItem.system.castingType;

  // Skill-swap invocations don't require a casting roll.
  if ( castingType === "skillSwap" ) {
    const msg = game.i18n.format("TB2E.Invocation.SkillSwapActive", { name: invocationItem.name });
    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p>${msg}</p>`,
      type: CONST.CHAT_MESSAGE_STYLES.OTHER
    });
    return;
  }

  // Ask if using a relic for this invocation
  const hasRelic = await _askRelicStatus(actor, invocationItem);
  if ( hasRelic === null ) return; // Cancelled

  // Build context modifiers
  const contextModifiers = [];
  if ( invocationItem.system.sacramental ) {
    contextModifiers.push(createModifier({
      label: game.i18n.localize("TB2E.Invocation.SacramentalBonus"),
      type: "dice", value: 1, source: "invocation",
      icon: "fa-solid fa-fire-flame-curved", color: "--tb-green",
      timing: "pre"
    }));
  }

  const burdenAmount = hasRelic ? invocationItem.system.burdenWithRelic : invocationItem.system.burden;

  const testContext = {
    invocationId: invocationItem.id,
    invocationName: invocationItem.name,
    isInvocation: true,
    hasRelic,
    burdenAmount,
    contextModifiers
  };

  if ( castingType === "fixed" ) {
    let obstacle = invocationItem.system.fixedObstacle;
    if ( !hasRelic ) obstacle += 1;
    testContext.obstacle = obstacle;
    return rollTest({ actor, type: "skill", key: "ritualist", testContext });
  }

  if ( castingType === "factors" ) {
    const obstacle = await _showFactorDialog(invocationItem, hasRelic);
    if ( obstacle === null ) return; // Cancelled
    testContext.obstacle = obstacle;
    return rollTest({ actor, type: "skill", key: "ritualist", testContext });
  }

  if ( castingType === "versus" ) {
    testContext.isVersus = true;
    if ( !hasRelic ) {
      // Without relic: -1s penalty on versus tests
      contextModifiers.push(createModifier({
        label: game.i18n.localize("TB2E.Invocation.NoRelicPenalty"),
        type: "success", value: -1, source: "invocation",
        icon: "fa-solid fa-circle-minus", color: "--tb-red",
        timing: "post"
      }));
    }
    return rollTest({ actor, type: "skill", key: "ritualist", testContext });
  }
}

/**
 * Find a relic item on the actor that applies to the given invocation.
 * A relic must be placed in an inventory slot (not dropped) to be usable.
 * @param {Actor} actor
 * @param {Item} invocationItem
 * @returns {Item|undefined}
 */
function findApplicableRelic(actor, invocationItem) {
  const relics = actor.itemTypes.relic || [];
  return relics.find(relic => {
    if ( !relic.system.slot || relic.system.dropped ) return false;
    if ( relic.system.relicTier === "great" ) {
      return relic.system.linkedCircle === invocationItem.system.circle;
    }
    return (relic.system.linkedInvocations || []).includes(invocationItem.name);
  });
}

/**
 * Show a dialog asking if the invoker is using a relic.
 * Checks the actor's relic items first for automatic detection.
 * @param {Actor} actor
 * @param {Item} invocationItem
 * @returns {Promise<boolean|null>} true if using relic, false if not, null if cancelled.
 */
async function _askRelicStatus(actor, invocationItem) {
  const applicableRelic = findApplicableRelic(actor, invocationItem);

  let content;
  if ( applicableRelic ) {
    content = `<p>${game.i18n.format("TB2E.Relic.HasRelic", { relic: applicableRelic.name })}</p>`;
  } else {
    // Fall back to the invocation's reference relic name if no item found
    const relicName = invocationItem.system.relic;
    content = relicName
      ? `<p>${game.i18n.format("TB2E.Invocation.RelicPrompt", { relic: relicName })}</p>`
      : `<p>${game.i18n.localize("TB2E.Relic.NoRelic")}</p>`;
  }

  return foundry.applications.api.DialogV2.wait({
    window: { title: `${invocationItem.name} — ${game.i18n.localize("TB2E.Invocation.Relic")}` },
    content,
    buttons: [
      {
        action: "yes",
        label: game.i18n.localize("TB2E.Invocation.WithRelic"),
        icon: "fa-solid fa-hands-praying",
        callback: () => true
      },
      {
        action: "no",
        label: game.i18n.localize("TB2E.Invocation.WithoutRelic"),
        icon: "fa-solid fa-ban",
        callback: () => false
      }
    ],
    close: () => null
  });
}

/**
 * Show the factor selection dialog for a factor-type invocation.
 * @param {Item} invocationItem
 * @param {boolean} hasRelic
 * @returns {Promise<number|null>} The computed obstacle, or null if cancelled.
 */
async function _showFactorDialog(invocationItem, hasRelic) {
  const factors = (invocationItem.system.factors || []).map((group, gi) => ({
    ...group,
    groupIndex: gi,
    options: (group.options || []).map((opt, oi) => ({
      ...opt,
      optionIndex: oi
    }))
  }));

  const content = await foundry.applications.handlebars.renderTemplate(
    "systems/tb2e/templates/dice/spell-factors.hbs", {
      spellName: invocationItem.name,
      factors,
      factorNote: invocationItem.system.factorNote
    }
  );

  const relicModifier = hasRelic ? -1 : 1;
  const relicLabel = hasRelic
    ? game.i18n.localize("TB2E.Invocation.RelicFactorReduction")
    : game.i18n.localize("TB2E.Invocation.NoRelicFactorIncrease");

  return new Promise((resolve) => {
    const dialog = new foundry.applications.api.DialogV2({
      window: { title: `${invocationItem.name} — ${game.i18n.localize("TB2E.Spell.Factors")}` },
      content,
      buttons: [
        {
          action: "perform",
          label: game.i18n.localize("TB2E.Invocation.PerformButton"),
          icon: "fa-solid fa-hands-praying",
          callback: (event, button, dialog) => {
            let total = 0;
            for ( const radio of button.form?.querySelectorAll("input[type='radio']:checked") ?? [] ) {
              total += Number(radio.value) || 0;
            }
            resolve(Math.max(1, total + relicModifier));
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
        // Add relic modifier note
        const totalEl = html.querySelector(".factor-total-value");
        if ( !totalEl ) return;

        // Add relic note after the total
        const totalDiv = totalEl.closest(".factor-total");
        if ( totalDiv ) {
          const note = document.createElement("span");
          note.className = "factor-relic-note";
          note.style.cssText = "margin-left: 0.5rem; font-size: 0.85rem; font-style: italic;";
          note.textContent = `(${relicLabel}: ${relicModifier > 0 ? "+" : ""}${relicModifier})`;
          totalDiv.appendChild(note);
        }

        function updateTotal() {
          let total = 0;
          for ( const radio of html.querySelectorAll("input[type='radio']:checked") ) {
            total += Number(radio.value) || 0;
          }
          totalEl.textContent = Math.max(1, total + relicModifier);
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
 * Process post-roll invocation state changes.
 * Called from the post-roll flow when testContext has invocationId.
 * @param {Actor} actor
 * @param {object} testContext
 * @param {boolean} passed - Whether the test passed.
 */
export async function processInvocationPerformed(actor, testContext, passed) {
  if ( !testContext?.invocationId ) return;

  const invocation = actor.items.get(testContext.invocationId);
  if ( invocation ) {
    await invocation.update({ "system.performed": true });
  }

  // Add burden regardless of pass/fail
  const burdenAmount = testContext.burdenAmount || 0;
  if ( burdenAmount > 0 ) {
    const newBurden = actor.system.urdr.burden + burdenAmount;
    await actor.update({ "system.urdr.burden": newBurden });

    // Notify about burden added
    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p>${game.i18n.format("TB2E.Invocation.BurdenAdded", {
        name: testContext.invocationName,
        amount: burdenAmount,
        total: newBurden
      })}</p>`,
      type: CONST.CHAT_MESSAGE_STYLES.OTHER
    });

    // Check if burden exceeds Urðr capacity — post a styled card
    const capacity = actor.system.urdr.capacity || 0;
    if ( newBurden > capacity ) {
      await _postBurdenExceededCard(actor, newBurden, capacity);
    }
  }
}

/* -------------------------------------------- */
/*  Weight of the Immortal Burden Card           */
/* -------------------------------------------- */

const BURDEN_EXCEEDED_TEMPLATE = "systems/tb2e/templates/chat/burden-exceeded.hbs";

/**
 * Post a styled chat card for Weight of the Immortal Burden.
 * @param {Actor} actor
 * @param {number} burden - Current total burden.
 * @param {number} capacity - Urðr capacity.
 */
async function _postBurdenExceededCard(actor, burden, capacity) {
  const cardContent = await foundry.applications.handlebars.renderTemplate(
    BURDEN_EXCEEDED_TEMPLATE, {
      actorName: actor.name,
      actorImg: actor.img,
      actorId: actor.id,
      cardTitle: game.i18n.localize("TB2E.Burden.CardTitle"),
      bodyText: game.i18n.format("TB2E.Burden.BodyText", { burden, capacity }),
      detailText: game.i18n.localize("TB2E.Burden.DetailText"),
      buttonLabel: game.i18n.format("TB2E.Burden.RollHealth", { obstacle: burden })
    }
  );

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: cardContent,
    type: CONST.CHAT_MESSAGE_STYLES.OTHER,
    flags: {
      tb2e: {
        burdenExceeded: {
          actorId: actor.id,
          burden,
          capacity
        }
      }
    }
  });
}

/**
 * Register click handlers on burden exceeded chat cards.
 * @param {ChatMessage} message
 * @param {HTMLElement} html
 */
export function activateBurdenListeners(message, html) {
  const flags = message.getFlag("tb2e", "burdenExceeded");
  if ( !flags || flags.resolved ) return;

  const btn = html.querySelector(".burden-roll-health");
  if ( !btn ) return;

  btn.addEventListener("click", async (event) => {
    event.preventDefault();
    const actor = game.actors.get(flags.actorId);
    if ( !actor || !actor.isOwner ) return;

    // Launch a Health test at Ob = burden
    const { rollTest } = await import("./tb2e-roll.mjs");
    rollTest({
      actor,
      type: "ability",
      key: "health",
      testContext: { obstacle: flags.burden }
    });

    // Mark resolved and re-render
    await message.update({ "flags.tb2e.burdenExceeded.resolved": true });
    const resolvedContent = await foundry.applications.handlebars.renderTemplate(
      BURDEN_EXCEEDED_TEMPLATE, {
        actorName: actor.name,
        actorImg: actor.img,
        actorId: actor.id,
        cardTitle: game.i18n.localize("TB2E.Burden.CardTitle"),
        resolved: true,
        resolvedText: game.i18n.format("TB2E.Burden.ResolvedText", { obstacle: flags.burden }),
        resolvedLabel: game.i18n.localize("TB2E.Burden.ResolvedLabel")
      }
    );
    await message.update({ content: resolvedContent });
  });
}
