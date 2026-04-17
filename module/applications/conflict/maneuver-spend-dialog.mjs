const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

/**
 * Valid spend combinations per MoS (SG p.69). Each combination is a set of
 * effects that together consume the margin; the player may not use the same
 * effect twice on a single maneuver.
 */
// Per-effect MoS cost (SG p.69):
//   Impede = 1, Gain Position = 2, Disarm = 3, Rearm = 4.
// Combinations add costs; the dialog only offers combos whose total ≤ margin.
const SPEND_COMBINATIONS = {
  1: [
    { key: "impede", cost: 1, impede: true }
  ],
  2: [
    { key: "impede", cost: 1, impede: true },
    { key: "position", cost: 2, position: true }
  ],
  3: [
    { key: "impede", cost: 1, impede: true },
    { key: "position", cost: 2, position: true },
    { key: "impedePosition", cost: 3, impede: true, position: true },
    { key: "disarm", cost: 3, disarm: true }
  ],
  4: [
    { key: "impede", cost: 1, impede: true },
    { key: "position", cost: 2, position: true },
    { key: "impedePosition", cost: 3, impede: true, position: true },
    { key: "disarm", cost: 3, disarm: true },
    { key: "impedeDisarm", cost: 4, impede: true, disarm: true },
    { key: "rearm", cost: 4, rearm: true }
  ]
};

const COMBO_LABELS = {
  impede: "TB2E.Conflict.Maneuver.Impede",
  position: "TB2E.Conflict.Maneuver.Position",
  impedePosition: "TB2E.Conflict.Maneuver.ImpedeAndPosition",
  disarm: "TB2E.Conflict.Maneuver.Disarm",
  impedeDisarm: "TB2E.Conflict.Maneuver.ImpedeAndDisarm",
  rearm: "TB2E.Conflict.Maneuver.Rearm"
};

/**
 * Dialog for spending a won Maneuver's margin of success (SG p.69).
 * Called from the roll/versus chat card button. Writes the selection to the
 * spender's combatant mailbox (`pendingManeuverSpend`); GM-side processing in
 * TB2ECombat applies the effects.
 */
export default class ManeuverSpendDialog extends HandlebarsApplicationMixin(ApplicationV2) {

  #args;
  #chosenComboKey = null;
  #disarmTargetCombatantId = null;
  #disarmTargetItemId = null;
  #rearmItemId = null;
  #rearmFromDropped = false;

  /**
   * @param {object} args
   * @param {number} args.margin
   * @param {string} args.combatId
   * @param {string} args.combatantId
   * @param {string} args.groupId
   * @param {string} args.opponentGroupId
   * @param {number} args.roundNum
   * @param {number} args.volleyIndex
   */
  constructor(args = {}, options = {}) {
    super(options);
    this.#args = args;
    // Capped at 4 per RAW — higher MoS offers no additional combos.
    const effectiveMargin = Math.min(Math.max(args.margin || 0, 1), 4);
    this.#args.effectiveMargin = effectiveMargin;
  }

  static DEFAULT_OPTIONS = {
    id: "maneuver-spend-dialog",
    classes: ["tb2e", "maneuver-spend-dialog"],
    position: { width: 480, height: "auto" },
    window: {
      title: "TB2E.Conflict.Maneuver.SpendTitle",
      resizable: false,
      minimizable: false
    },
    actions: {
      submit: ManeuverSpendDialog.#onSubmit
    }
  };

  static PARTS = {
    dialog: {
      template: "systems/tb2e/templates/conflict/maneuver-spend-dialog.hbs"
    }
  };

  /** @override */
  async _prepareContext() {
    const combat = game.combats.get(this.#args.combatId);
    const spender = combat?.combatants.get(this.#args.combatantId);
    const opponents = combat
      ? combat.combatants.filter(c => c._source.group === this.#args.opponentGroupId)
      : [];

    const margin = this.#args.effectiveMargin;
    const comboList = SPEND_COMBINATIONS[margin] || [];
    const combos = comboList.map(c => ({
      key: c.key,
      label: game.i18n.localize(COMBO_LABELS[c.key] || c.key),
      cost: c.cost,
      costLabel: game.i18n.format("TB2E.Conflict.Maneuver.CostLabel", { cost: c.cost }),
      impede: !!c.impede,
      position: !!c.position,
      disarm: !!c.disarm,
      rearm: !!c.rearm,
      selected: c.key === this.#chosenComboKey
    }));
    // Show Disarm/Rearm sections up-front for the current MoS level, not only
    // after a combo is selected — reduces re-render flash and lets the player
    // preview their targets while choosing.
    const anyComboDisarm = comboList.some(c => c.disarm);
    const anyComboRearm = comboList.some(c => c.rearm);

    // Disarm target pool: each opponent combatant's equipped conflict weapons,
    // carried weapons, and traits. Offered as grouped targets. Monsters store
    // weapons as system data (not items), so their pools are often empty — in
    // that case the dialog shows a "track manually" hint and spend proceeds
    // without a concrete target.
    const disarmTargets = opponents.map(c => {
      const actor = c.actor;
      const items = actor?.items?.contents || [];
      const weapons = items.filter(i => i.type === "weapon").map(i => ({
        id: i.id, name: i.name, kind: "weapon"
      }));
      const gear = items.filter(i => i.type === "gear" || i.type === "supply").map(i => ({
        id: i.id, name: i.name, kind: "gear"
      }));
      const traits = items.filter(i => i.type === "trait").map(i => ({
        id: i.id, name: i.name, kind: "trait"
      }));
      return {
        combatantId: c.id,
        combatantName: c.name,
        items: [...weapons, ...gear, ...traits],
        hasItems: weapons.length + gear.length + traits.length > 0
      };
    });
    const anyDisarmTargets = disarmTargets.some(t => t.hasItems);

    // Rearm pool: spender's own carried weapons + any dropped weapons on their
    // team's drop pool. Filters out the currently equipped weapon.
    const spenderItems = spender?.actor?.items?.contents || [];
    const currentWeaponId = spender?.system.weaponId || "";
    const ownWeapons = spenderItems
      .filter(i => i.type === "weapon" && i.id !== currentWeaponId)
      .map(i => ({ id: i.id, name: i.name, fromDropped: false }));
    const droppedPool = combat?.system.droppedWeapons?.[this.#args.groupId] || [];
    const droppedWeapons = droppedPool.map(d => ({
      id: d.itemId, name: d.itemName || "(dropped weapon)", fromDropped: true
    }));

    return {
      margin: this.#args.margin,
      effectiveMargin: margin,
      spenderName: spender?.name || "",
      combos,
      anyComboDisarm,
      anyComboRearm,
      disarmTargets,
      anyDisarmTargets,
      droppedWeapons,
      ownWeapons,
      chosenComboKey: this.#chosenComboKey,
      chosenCombo: (SPEND_COMBINATIONS[margin] || []).find(c => c.key === this.#chosenComboKey),
      disarmTargetCombatantId: this.#disarmTargetCombatantId,
      disarmTargetItemId: this.#disarmTargetItemId,
      rearmItemId: this.#rearmItemId,
      rearmFromDropped: this.#rearmFromDropped
    };
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);

    const disarmSection = this.element.querySelector("[data-combo-section='disarm']");
    const rearmSection = this.element.querySelector("[data-combo-section='rearm']");

    const applyVisibility = () => {
      const combo = SPEND_COMBINATIONS[this.#args.effectiveMargin]
        ?.find(c => c.key === this.#chosenComboKey);
      if ( disarmSection ) disarmSection.hidden = !combo?.disarm;
      if ( rearmSection ) rearmSection.hidden = !combo?.rearm;
    };

    // Apply initial visibility (in case a combo is already chosen from a prior state).
    applyVisibility();

    // Toggle target sections on radio change without a full re-render.
    const comboRadios = this.element.querySelectorAll("input[name='combo']");
    for ( const r of comboRadios ) {
      r.addEventListener("change", () => {
        this.#chosenComboKey = r.value;
        applyVisibility();
      });
    }

    const disarmSelect = this.element.querySelector(".disarm-target-select");
    if ( disarmSelect ) {
      disarmSelect.addEventListener("change", () => {
        const [cid, iid] = (disarmSelect.value || "|").split("|");
        this.#disarmTargetCombatantId = cid || null;
        this.#disarmTargetItemId = iid || null;
      });
    }

    const rearmSelect = this.element.querySelector(".rearm-target-select");
    if ( rearmSelect ) {
      rearmSelect.addEventListener("change", () => {
        const [id, fromDropped] = (rearmSelect.value || "|").split("|");
        this.#rearmItemId = id || null;
        this.#rearmFromDropped = fromDropped === "dropped";
      });
    }
  }

  static async #onSubmit(event, target) {
    const combo = SPEND_COMBINATIONS[this.#args.effectiveMargin]?.find(c => c.key === this.#chosenComboKey);
    if ( !combo ) {
      ui.notifications.warn(game.i18n.localize("TB2E.Conflict.Maneuver.ChooseCombo"));
      return;
    }
    // Disarm target is optional: monsters store weapons as system data, not as
    // Item documents, so we can't always offer a concrete target. If the user
    // picks one we disable that item on the roll path; otherwise the GM tracks
    // the effect narratively (the spend is still recorded + Impede still lands).
    if ( combo.rearm && !this.#rearmItemId ) {
      ui.notifications.warn(game.i18n.localize("TB2E.Conflict.Maneuver.ChooseRearmItem"));
      return;
    }

    const combat = game.combats.get(this.#args.combatId);
    const spender = combat?.combatants.get(this.#args.combatantId);
    if ( !spender ) return;

    const selection = {
      impede: !!combo.impede,
      position: !!combo.position
    };
    if ( combo.disarm ) {
      selection.disarm = {
        targetCombatantId: this.#disarmTargetCombatantId,
        targetItemId: this.#disarmTargetItemId
      };
    }
    if ( combo.rearm ) {
      selection.rearm = {
        itemId: this.#rearmItemId,
        fromDropped: this.#rearmFromDropped
      };
    }

    // Write mailbox. GM's _onUpdateDescendantDocuments hook in TB2ECombat
    // picks this up and applies it via #applyManeuverSpend.
    await spender.update({
      "system.pendingManeuverSpend": {
        roundNum: this.#args.roundNum,
        volleyIndex: this.#args.volleyIndex,
        selection
      }
    });

    // Mark the source chat message as having spent its MoS, so the button
    // disappears on re-render.
    if ( this.#args.messageId ) {
      const message = game.messages.get(this.#args.messageId);
      if ( message ) {
        if ( game.user.isGM ) {
          await message.setFlag("tb2e", "maneuverSpent", true);
        } else {
          // Best-effort for players; GM may also set via mailbox processing.
          try { await message.setFlag("tb2e", "maneuverSpent", true); } catch {}
        }
      }
    }

    this.close();
  }
}
