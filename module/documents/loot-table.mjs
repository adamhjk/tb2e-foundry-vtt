/**
 * TB2ELootTable — RollTable subclass that produces a tb2e-styled draw chat card
 * and preserves the full recursive subtable chain so the player sees every
 * intermediate roll, not just the terminal Item.
 *
 * Activated for all RollTables; the chain-preserving behavior is a pure
 * superset of core Foundry's behavior (chain data is just not used when the
 * default template is in effect).
 *
 * Chat template switches to the tb2e template only for RollTables whose
 * compendium is this system's loot-tables pack — other RollTables fall back to
 * core rendering.
 */

const TB2E_TEMPLATE = "systems/tb2e/templates/chat/loot-draw.hbs";

/**
 * Packs for which this subclass intercepts `.draw()` to render the tb2e
 * chat card. Each entry declares the `kind` context used by the template
 * to swap the header label/icon and the footer banner — the rest of the
 * card (chain trace, drops, anchor links) is identical across kinds.
 */
const TB2E_PACK_KINDS = {
  "tb2e.loot-tables": {
    kind: "loot",
    labelKey: "TB2E.Loot.Draw",
    labelIcon: "fa-solid fa-coins",
    bannerKey: "TB2E.Loot.Booty",
    bannerIcon: "fa-solid fa-sack-dollar",
    flagKey: "lootDraw"
  },
  "tb2e.camp-events": {
    kind: "camp-event",
    labelKey: "TB2E.CampEvents.Draw",
    labelIcon: "fa-solid fa-campground",
    bannerKey: "TB2E.CampEvents.CampIsMade",
    bannerIcon: "fa-solid fa-fire-flame-curved",
    flagKey: "campEventDraw"
  }
};

export default class TB2ELootTable extends RollTable {

  /**
   * Override the recursive draw to build a chain trace of
   * {tableName, tableImg, formula, rollTotal, drewInto} links.
   *
   * @returns {Promise<{roll: Roll, results: TableResult[], chain: object[]}>}
   */
  async roll({roll, recursive=true, _depth=0, _chain}={}) {
    if ( _depth > 5 ) {
      throw new Error(`Maximum recursion depth exceeded when rolling RollTable ${this.id}`);
    }

    // Delegate the raw roll (formula resolution, in-range draw) to the parent
    // implementation with recursion DISABLED so we can walk the chain ourselves.
    const own = await super.roll({roll, recursive: false, _depth});
    const link = {
      tableId: this.id,
      tableName: this.name,
      tableImg: this.img,
      tableUuid: this.uuid,
      pageRef: this.description ?? "",
      formula: this.formula,
      rollTotal: own.roll?.total ?? null,
      drewLabel: own.results.map(r => r.name || r.text || "").filter(Boolean).join(", ")
    };
    const chain = _chain ?? [];
    chain.push(link);

    if ( !recursive ) return { ...own, chain };

    // Recurse into any RollTable results, preserving chain order.
    const inner = [];
    for ( const result of own.results ) {
      const { type, documentUuid } = result;
      const documentName = documentUuid ? foundry.utils.parseUuid(documentUuid)?.type : null;
      if ( (type === "document") && (documentName === "RollTable") ) {
        const innerTable = await fromUuid(documentUuid);
        if ( innerTable ) {
          const innerDraw = await innerTable.roll({_depth: _depth + 1, _chain: chain});
          inner.push(...innerDraw.results);
          continue;
        }
      }
      inner.push(result);
    }
    return { roll: own.roll, results: inner, chain };
  }

  /**
   * Override the draw pipeline to thread chain data into our chat card.
   * Only intercepts rendering when this is a tb2e loot-tables RollTable;
   * other tables get the default behavior.
   */
  /**
   * Resolve the tb2e pack kind for this table. Matches by direct pack or by
   * compendium-source lineage (so world-copies of compendium tables still
   * render with the right visual treatment).
   * @returns {object|null} pack kind config (see TB2E_PACK_KINDS) or null.
   */
  get tb2eKind() {
    const direct = TB2E_PACK_KINDS[this.pack];
    if ( direct ) return direct;
    const src = this._stats?.compendiumSource;
    if ( typeof src === "string" ) {
      for ( const [pack, cfg] of Object.entries(TB2E_PACK_KINDS) ) {
        if ( src.startsWith(`Compendium.${pack}.`) ) return cfg;
      }
    }
    return null;
  }

  /**
   * Back-compat alias — true when this is any tb2e-styled draw target
   * (loot or camp event). Pre-existing callers that asked `isLootTable`
   * wanted "should this produce the tb2e chat card?", which is now the
   * union of loot and camp-event tables.
   * @type {boolean}
   */
  get isLootTable() {
    return this.tb2eKind !== null;
  }

  async draw({roll, recursive=true, results=[], displayChat=true, rollMode, chain}={}) {
    const kindCfg = this.tb2eKind;
    if ( !kindCfg ) {
      return super.draw({roll, recursive, results, displayChat, rollMode});
    }

    // The RollTable sheet's "Roll" button invokes table.roll() then passes the
    // whole result object (roll/results/chain) into draw() — so chain may
    // already be populated. Only re-roll when neither results nor chain came in.
    if ( !results.length ) {
      const r = await this.roll({roll, recursive});
      roll = r.roll;
      results = r.results;
      chain = r.chain;
    }
    if ( !results.length ) return { roll, results };

    if ( displayChat ) {
      await this._toLootMessage(results, { roll, chain, kindCfg, messageOptions: { rollMode } });
    }
    return { roll, results, chain };
  }

  /**
   * Render and post the tb2e chat card. `kindCfg` is the pack-kind config
   * from {@link TB2E_PACK_KINDS}: it tells the template which label/icon
   * pairs to render in the header and footer banner. The structural
   * treatment (chain trace, drops, content-link anchors, amber accent) is
   * identical for loot and camp-event tables.
   * @private
   */
  async _toLootMessage(results, { roll, chain, kindCfg, messageOptions={} }) {
    kindCfg ??= this.tb2eKind ?? TB2E_PACK_KINDS["tb2e.loot-tables"];
    messageOptions.rollMode ??= game.settings.get("core", "rollMode");

    // For camp-event draws, detect disaster via the TOP-LEVEL result's
    // `flags.tb2e.campEvents.isDisaster` (subtable terminals don't carry
    // the flag). The banner + icon swap to a "Disaster!" treatment so the
    // card is readable at a glance.
    if ( kindCfg.kind === "camp-event" ) {
      const total = roll?.total ?? 0;
      const topLevel = this.getResultsForRoll(total)[0];
      const topFlags = topLevel?.flags?.tb2e?.campEvents ?? {};
      if ( topFlags.isDisaster ) {
        kindCfg = {
          ...kindCfg,
          bannerKey:  "TB2E.CampEvents.DisasterBanner",
          bannerIcon: "fa-solid fa-triangle-exclamation"
        };
      }
    }

    // Build terminal drops: for document results, resolve to the linked Item (or nested RollTable).
    // Use the document's own `toAnchor()` to get a fully-wired content link
    // (Foundry's global listeners handle click→open-sheet and drag→drop).
    const drops = await Promise.all(results.map(async (r) => {
      const obj = r.toObject?.(false) ?? r;
      let linkedDoc = null;
      if ( obj.type === "document" && obj.documentUuid ) {
        try { linkedDoc = await fromUuid(obj.documentUuid); }
        catch ( _err ) { linkedDoc = null; }
      }
      const isItem = linkedDoc && linkedDoc.documentName === "Item";
      // Render a content-link anchor when we have a resolved doc; strip the
      // default icon Foundry injects so the name sits cleanly alongside our
      // large drop image.
      let anchorHTML = null;
      if ( linkedDoc ) {
        const anchor = linkedDoc.toAnchor({ classes: ["loot-drop-name"] });
        anchor.querySelector("i")?.remove();
        anchorHTML = anchor.outerHTML;
      }
      return {
        kind: isItem ? "item" : (obj.type === "document" ? "document" : "text"),
        name: linkedDoc?.name || obj.name || obj.text || "",
        img: linkedDoc?.img || obj.img || null,
        description: obj.description || "",
        uuid: obj.documentUuid || linkedDoc?.uuid || null,
        pageRef: linkedDoc?.system?.description || "",
        anchorHTML
      };
    }));

    // Shape the chain for rendering — drop the last link's "drewLabel" since
    // the terminal drops display it separately.
    const chainLinks = (chain || []).map((link, idx, arr) => ({
      ...link,
      last: idx === arr.length - 1
    }));

    const rollHTML = (this.displayRoll && roll) ? await roll.render() : null;
    const content = await foundry.applications.handlebars.renderTemplate(TB2E_TEMPLATE, {
      kind:        kindCfg.kind,
      labelKey:    kindCfg.labelKey,
      labelIcon:   kindCfg.labelIcon,
      bannerKey:   kindCfg.bannerKey,
      bannerIcon:  kindCfg.bannerIcon,
      table: {
        id: this.id,
        name: this.name,
        img: this.img,
        pageRef: this.description ?? "",
        formula: this.formula
      },
      chain: chainLinks,
      drops,
      rollHTML
    });

    const messageData = {
      flavor: game.i18n.format("TABLE.DrawFlavor", { number: results.length, name: foundry.utils.escapeHTML(this.name) }),
      author: game.user.id,
      speaker: foundry.documents.ChatMessage.implementation.getSpeaker(),
      content,
      rolls: roll ? [roll] : [],
      sound: roll ? CONFIG.sounds.dice : null,
      flags: {
        "core.RollTable": this.id,
        "tb2e": { [kindCfg.flagKey]: true }
      }
    };

    return foundry.documents.ChatMessage.implementation.create(messageData, messageOptions);
  }
}
