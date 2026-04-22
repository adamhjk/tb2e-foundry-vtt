import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { LootDrawCard } from '../pages/LootDrawCard.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §9 Loot Tables — draw a non-recursive (terminal) table.
 *
 * Rules under test:
 *   - Scholar's Guide loot tables cascade subtable → subtable until a
 *     terminal item. A "terminal" table has no `type:"document"` results
 *     that resolve to nested `RollTable`s — every result links to an Item
 *     or is plain text. `TB2ELootTable.roll` (module/documents/loot-table.mjs
 *     lines 26-65) recurses only on RollTable-typed document results; for
 *     a terminal table the chain has exactly one link and no subtable
 *     drawing happens.
 *
 * Chosen table: `Coins Subtable 1` (id `lt00000000000010`, Scholar's Guide
 * p. 159 — packs/_source/loot-tables/Coins_Subtable_1_lt00000000000010.yml).
 * All three results are `type: document` pointing at Items in `tb2e.loot`
 * (not RollTables), so the draw is guaranteed single-chain-link:
 *   1-3 → Small Sack of Copper Coins
 *   4-5 → Pouch of Silver Coins
 *   6   → Pouch of Gold Coins
 * Formula is `1d6`.
 *
 * Dice determinism: `CONFIG.Dice.randomUniform = () => 0.001` makes every
 * d6 roll a 6 (`Math.ceil((1 - 0.001) * 6) = 6`), so the draw lands on
 * range 6-6 → "Pouch of Gold Coins". Same stub technique as the §3/§4
 * specs (see advancement/auto-trigger.spec.mjs lines 46-51).
 *
 * Draw API: call `table.draw()` directly (the AppV1 RollTable "Roll" sheet
 * button isn't worth driving through the UI for determinism — the
 * override in loot-table.mjs line 83 is what actually posts the chat
 * card, and we want to pin our assertions to the returned ChatMessage
 * rather than scrape the log). `_toLootMessage` (loot-table.mjs line 177)
 * returns the created ChatMessage, which `draw()` returns via its result
 * object — we capture the id and scope the POM by `data-message-id`.
 *
 * Asserts:
 *   - Exactly ONE chat message posts during the draw (no chain fan-out).
 *   - `flags.tb2e.lootDraw === true` (loot-table.mjs line 173).
 *   - The card's header shows the table name.
 *   - The chain trace has exactly one link with no connector (terminal
 *     marker `.loot-chain-link--last` present; zero `.loot-chain-link-
 *     connector` elements because `{{#unless last}}` excludes the last
 *     link — loot-draw.hbs lines 29-33).
 *   - The terminal drop is a single `.loot-drop--item` whose name is
 *     "Pouch of Gold Coins".
 */
test.describe('§9 Loot Tables — terminal draw', () => {
  test.afterEach(async ({ page }) => {
    // Restore the PRNG stub if the test aborted before its own restore.
    // Pattern borrowed from tests/e2e/advancement/auto-trigger.spec.mjs
    // — the browser page persists across specs so a leaked stub would
    // break every downstream test depending on real randomness.
    await page.evaluate(() => {
      if (globalThis.__tb2eE2EPrevRandomUniform) {
        CONFIG.Dice.randomUniform = globalThis.__tb2eE2EPrevRandomUniform;
        delete globalThis.__tb2eE2EPrevRandomUniform;
      }
    });
  });

  test('non-recursive table draw posts a single card with the terminal result', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Lock the d6 to a 6 — u=0.001 → ceil((1-0.001)*6) = 6.
    await page.evaluate(() => {
      globalThis.__tb2eE2EPrevRandomUniform = CONFIG.Dice.randomUniform;
      CONFIG.Dice.randomUniform = () => 0.001;
    });

    // Snapshot chat state BEFORE the draw so we can assert exactly one
    // new message posted. Scoping by `flags.tb2e.lootDraw` alone would
    // be too loose (recursive draws would also set it — that's the next
    // checkbox, line 306 in TEST_PLAN.md), and scoping by tableId risks
    // false-negatives under --repeat-each where a prior iteration left
    // a card in the log. Instead we diff ids against the snapshot and
    // filter by tableId — the overlap is exactly our message.
    const beforeIds = await page.evaluate(
      () => game.messages.contents.map((m) => m.id),
    );

    // Draw the terminal table. `game.packs.get(...).getDocument(id)`
    // returns a live RollTable instance (the pack name and id are
    // stable: see packs/_source/loot-tables/Coins_Subtable_1_*.yml).
    const draw = await page.evaluate(async (tableId) => {
      const pack = game.packs.get('tb2e.loot-tables');
      const table = await pack.getDocument(tableId);
      const res = await table.draw();
      return {
        tableName: table.name,
        tableId: table.id,
        chainLen: Array.isArray(res.chain) ? res.chain.length : 0,
        resultCount: res.results.length,
        resultNames: res.results.map((r) => r.name || r.text || ''),
      };
    }, 'lt00000000000010');

    expect(draw.tableName).toBe('Coins Subtable 1');
    // The draw() return value should have exactly one chain link
    // (terminal — no recursion) and one terminal result.
    expect(draw.chainLen).toBe(1);
    expect(draw.resultCount).toBe(1);
    expect(draw.resultNames).toEqual(['Pouch of Gold Coins']);

    // Wait for the chat log to register the new message, then diff.
    await expect
      .poll(
        async () =>
          page.evaluate((prev) => {
            const seen = new Set(prev);
            return game.messages.contents
              .filter((m) => !seen.has(m.id))
              .map((m) => m.id);
          }, beforeIds),
        { timeout: 10_000 },
      )
      .toHaveLength(1);

    // Locate THE new message, narrowed to this table's draw — and assert
    // exactly one such message posted. (If the draw ever chains, a
    // recursive implementation would post >1 card for different tables.)
    const posted = await page.evaluate(
      ({ prev, tableId }) => {
        const seen = new Set(prev);
        const fresh = game.messages.contents.filter((m) => !seen.has(m.id));
        // Note: ChatMessage.create nests dot-separated flag scopes —
        // `{"core.RollTable": id}` in messageData becomes
        // `m.flags.core.RollTable` on the document (Foundry's
        // `DocumentFlags#set` splits on the first `.`). Read the nested
        // path; the namespaced `tb2e.lootDraw` is already nested by the
        // author in loot-table.mjs line 173.
        const lootCards = fresh.filter(
          (m) =>
            m.flags?.tb2e?.lootDraw === true &&
            m.flags?.core?.RollTable === tableId,
        );
        return {
          freshTotal: fresh.length,
          lootCount: lootCards.length,
          messageId: lootCards[0]?.id ?? null,
          hasLootFlag: lootCards[0]?.flags?.tb2e?.lootDraw ?? null,
        };
      },
      { prev: beforeIds, tableId: draw.tableId },
    );
    expect(posted.freshTotal).toBe(1);
    expect(posted.lootCount).toBe(1);
    expect(posted.hasLootFlag).toBe(true);
    expect(posted.messageId).toBeTruthy();

    // DOM assertions — pin the POM to the known message id so other
    // cards in the log can't fool us.
    const card = new LootDrawCard(page, { messageId: posted.messageId });
    await card.expectPresent();
    await expect(card.tableName).toHaveText('Coins Subtable 1');

    // Terminal chain: one link, zero connectors. The template renders
    // a connector between links via `{{#unless last}}` (loot-draw.hbs
    // line 29), so a single-link chain yields zero connectors —
    // non-recursive in DOM terms.
    await expect(card.chainLinks).toHaveCount(1);
    await expect(card.chainConnectors).toHaveCount(0);
    await expect(card.chainLinks.first()).toHaveClass(/loot-chain-link--last/);

    // Terminal drop: Pouch of Gold Coins, kind=item (document → Item).
    await expect(card.drops).toHaveCount(1);
    await expect(card.drops.first()).toHaveClass(/loot-drop--item/);
    const dropNames = await card.dropNameTexts();
    expect(dropNames).toEqual(['Pouch of Gold Coins']);

    // Restore PRNG before the afterEach fires (so leaked state during
    // this test body doesn't propagate if the cleanup hook itself
    // throws).
    await page.evaluate(() => {
      if (globalThis.__tb2eE2EPrevRandomUniform) {
        CONFIG.Dice.randomUniform = globalThis.__tb2eE2EPrevRandomUniform;
        delete globalThis.__tb2eE2EPrevRandomUniform;
      }
    });

    // Cleanup: delete the test's chat message so the shared world stays
    // tidy across iterations (--repeat-each) and later specs. No actor
    // to scope by, so we target the exact id.
    await page.evaluate(async (id) => {
      await game.messages.get(id)?.delete();
    }, posted.messageId);
  });
});
