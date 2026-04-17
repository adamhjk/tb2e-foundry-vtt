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

const TB2E_PACK = "tb2e.loot-tables";
const TB2E_TEMPLATE = "systems/tb2e/templates/chat/loot-draw.hbs";

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
   * Is this RollTable part of the tb2e loot-tables pack (or a world copy of one)?
   * @type {boolean}
   */
  get isLootTable() {
    if ( this.pack === TB2E_PACK ) return true;
    const src = this._stats?.compendiumSource;
    if ( typeof src === "string" && src.startsWith(`Compendium.${TB2E_PACK}.`) ) return true;
    return false;
  }

  async draw({roll, recursive=true, results=[], displayChat=true, rollMode, chain}={}) {
    if ( !this.isLootTable ) {
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
      await this._toLootMessage(results, { roll, chain, messageOptions: { rollMode } });
    }
    return { roll, results, chain };
  }

  /**
   * Render and post the tb2e loot-draw chat card.
   * @private
   */
  async _toLootMessage(results, { roll, chain, messageOptions={} }) {
    messageOptions.rollMode ??= game.settings.get("core", "rollMode");

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
        "tb2e": { lootDraw: true }
      }
    };

    return foundry.documents.ChatMessage.implementation.create(messageData, messageOptions);
  }
}
