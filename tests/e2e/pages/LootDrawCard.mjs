import { expect } from '@playwright/test';

/**
 * Page object for a TB2E loot-draw chat card.
 *
 * Source: `TB2ELootTable._toLootMessage` (module/documents/loot-table.mjs
 * lines 109-178) renders `templates/chat/loot-draw.hbs` and
 * `ChatMessage.create()`s a message with `flags.tb2e.lootDraw = true`.
 *
 * Template root is `<div class="tb2e-chat-card card-accent--amber loot-card">`.
 * We scope by `.loot-card` inside `.chat-message` to avoid matching sibling
 * TB2E cards (roll-result, versus, grind, nature-crisis).
 *
 * Selector map (loot-draw.hbs):
 *   - `.loot-card`                     card root
 *   - `.card-header .card-name`        table name ("Coins Subtable 1")
 *   - `.card-header .card-subtitle`    table pageRef (e.g. "Scholar's Guide, p. 159")
 *   - `.loot-chain`                    chain-trace block (present even for a
 *                                      single-link terminal draw — the
 *                                      template's `{{#if chain.length}}` is
 *                                      truthy as soon as `_toLootMessage`
 *                                      pushes the first link in `roll()`
 *                                      (loot-table.mjs line 45)).
 *   - `.loot-chain-link`               one per traversed table
 *   - `.loot-chain-link--last`         the terminal link marker
 *   - `.loot-chain-link-connector`     rendered between links (via `{{#unless
 *                                      last}}`), so its count == chain.length - 1.
 *                                      Zero connectors ⇒ non-recursive draw.
 *   - `.loot-drops`                    terminal drops container
 *   - `.loot-drop`                     one per terminal result
 *   - `.loot-drop--item`               drop kind classes (item | document | text)
 *   - `.loot-drop-name`                terminal result name (content-link or
 *                                      plain span). Matches both the anchor
 *                                      variant (`a.loot-drop-name`) and the
 *                                      text variant (`span.loot-drop-name`).
 *   - `.card-banner.banner-amber`      "Booty" banner
 */
export class LootDrawCard {
  /**
   * @param {import('@playwright/test').Page} page
   * @param {object} [opts]
   * @param {string} [opts.messageId]  filter to the ChatMessage with this id
   * @param {number} [opts.nth=-1]     0-based index (−1 = most recent)
   */
  constructor(page, { messageId, nth = -1 } = {}) {
    this.page = page;
    // In Foundry V13 each rendered message is `<li class="chat-message"
    // data-message-id="...">`. When we have a messageId we pin to it — this
    // makes the POM stable even when other tests leave cards in the log.
    const scope = messageId
      ? page.locator(`.chat-message[data-message-id="${messageId}"]`)
      : page.locator('.chat-message');
    const cards = scope.locator('.loot-card');
    this.root = messageId ? cards.first() : (nth < 0 ? cards.last() : cards.nth(nth));

    this.tableName = this.root.locator('.card-header .card-name');
    this.tableSubtitle = this.root.locator('.card-header .card-subtitle');
    this.chain = this.root.locator('.loot-chain');
    this.chainLinks = this.root.locator('.loot-chain-link');
    this.chainConnectors = this.root.locator('.loot-chain-link-connector');
    this.drops = this.root.locator('.loot-drops .loot-drop');
    this.dropNames = this.root.locator('.loot-drops .loot-drop-name');
    // `.loot-drop-page` is the per-drop page reference, rendered via
    // `{{#if pageRef}}` in loot-draw.hbs lines 65-67. The data source is
    // `linkedDoc.system.description` in loot-table.mjs line 138 — so for
    // Scholar's Guide Item entries this surfaces things like
    // "Scholar's Guide, p. 153".
    this.dropPageRefs = this.root.locator('.loot-drops .loot-drop-page');
    this.banner = this.root.locator('.card-banner.banner-amber');
  }

  /** Assert a loot-draw card is present. */
  async expectPresent() {
    await expect(this.root).toBeVisible();
    await expect(this.banner).toBeVisible();
  }

  /** Text of the table name in the card header. */
  tableNameText() {
    return this.tableName.innerText();
  }

  /** Text of every terminal drop name rendered on the card. */
  async dropNameTexts() {
    return (await this.dropNames.allInnerTexts()).map((s) => s.trim());
  }

  /**
   * Text of every rendered per-drop page reference on the card. The icon
   * (`<i class="fa-book">`) is empty content, so `innerText` returns just the
   * reference string (trimmed — leading whitespace in the template would
   * otherwise sneak in).
   */
  async dropPageRefTexts() {
    return (await this.dropPageRefs.allInnerTexts()).map((s) => s.trim());
  }
}
