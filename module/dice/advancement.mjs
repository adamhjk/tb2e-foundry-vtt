import { abilities, advancementNeeded, skills } from "../config.mjs";

/**
 * Show an advancement dialog when both pass and fail pips are filled.
 * @param {object} options
 * @param {Actor} options.actor - The actor advancing.
 * @param {"ability"|"skill"} options.type - Whether this is an ability or skill.
 * @param {string} options.key - The ability/skill key (e.g. "will", "fighter").
 */
export async function showAdvancementDialog({ actor, type, key }) {
  const category = type === "ability" ? "abilities" : "skills";
  const cfg = type === "ability" ? abilities[key] : skills[key];
  const label = game.i18n.localize(cfg.label);
  const data = actor.system[category][key];
  const needed = advancementNeeded(data.rating);

  // Guard — both rows must be full, and rating must be > 0
  if ( needed.pass <= 0 ) return;
  if ( data.pass < needed.pass || data.fail < needed.fail ) return;

  const currentRating = data.rating;
  const newRating = currentRating + 1;

  const content = await renderTemplate("systems/tb2e/templates/dice/advancement-dialog.hbs", {
    label,
    currentRating,
    newRating,
    prompt: game.i18n.format("TB2E.Advance.Prompt", { name: label })
  });

  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.format("TB2E.Advance.DialogTitle", { name: label }) },
    classes: ["tb2e", "advancement-dialog"],
    content,
    buttons: [
      {
        action: "accept",
        label: game.i18n.localize("TB2E.Advance.Accept"),
        icon: "fa-solid fa-arrow-up",
        default: true,
        callback: () => true
      },
      {
        action: "cancel",
        label: game.i18n.localize("TB2E.Advance.Cancel"),
        icon: "fa-solid fa-xmark"
      }
    ],
    close: () => null
  });

  if ( !result ) return;

  // Apply advancement: rating +1, pips reset to 0
  await actor.update({
    [`system.${category}.${key}.rating`]: newRating,
    [`system.${category}.${key}.pass`]: 0,
    [`system.${category}.${key}.fail`]: 0
  });

  // Post celebration chat card
  const chatContent = await renderTemplate("systems/tb2e/templates/chat/advancement-result.hbs", {
    actorName: actor.name,
    actorImg: actor.img,
    label,
    currentRating,
    newRating,
    advancedLabel: game.i18n.localize("TB2E.Advance.ChatMessage")
  });

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: chatContent,
    type: CONST.CHAT_MESSAGE_STYLES.OTHER
  });
}
