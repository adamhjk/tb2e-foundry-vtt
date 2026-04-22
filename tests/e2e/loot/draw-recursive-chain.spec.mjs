import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { LootDrawCard } from '../pages/LootDrawCard.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §9 Loot Tables — recursive chain draw.
 *
 * Rules under test (Scholar's Guide p. 152 ff.):
 *   - Loot tables cascade subtable → subtable until a terminal item.
 *     `TB2ELootTable.roll` (module/documents/loot-table.mjs lines 26-65)
 *     walks `results[]`; when an entry is `type:"document"` and the linked
 *     doc is a `RollTable` (line 54) it recurses, pushing a link onto the
 *     chain trace each step (line 45). The draw pipeline posts a SINGLE
 *     chat card via `_toLootMessage` (line 109) — the whole chain renders
 *     inside that one message.
 *
 * Chosen chain: top-level `Loot Table 1` (id `lt00000000000001`,
 * Scholar's Guide p. 152 — packs/_source/loot-tables/Loot_Table_1_*.yml)
 * → subtable `Books & Maps Subtable` (id `lt00000000000006`, Scholar's
 * Guide p. 153). Both are in this system's `tb2e.loot-tables` pack, and
 * every result on Loot Table 1 is `type: document` pointing at another
 * RollTable (recurse-guaranteed) while Books & Maps has all Item-typed
 * results (terminal-guaranteed). So: exactly two links, always.
 *
 * Deterministic landing: `CONFIG.Dice.randomUniform = () => 0.999` locks
 * every die face to `Math.ceil((1 - 0.999) * faces) = 1` (see
 * foundry/client/dice/terms/dice.mjs `mapRandomFace`). Loot Table 1's
 * formula is `2d6` → sum = 2, which lands on range 2-2 → "Books & Maps".
 * Books & Maps' formula is `3d6` → sum = 3, which lands on range 3-3 →
 * "Accurate Map (Dungeon Level)" (Item in `tb2e.loot`, Item id
 * `aa00000000000001`). Identical stub technique to the terminal-table
 * spec (tests/e2e/loot/draw-terminal-table.spec.mjs lines 73-76) but
 * inverted (0.999 → lowest face instead of 0.001 → highest face).
 *
 * Asserts:
 *   - Exactly ONE chat message posts during the draw (chain renders as a
 *     single card — loot-table.mjs line 99-101 posts only one message).
 *   - `flags.tb2e.lootDraw === true` and `flags.core.RollTable` is the
 *     TOP-level table id (loot-table.mjs lines 171-174; the chained
 *     subtable's id is NOT the message flag).
 *   - The returned `chain` has length 2 (top + subtable).
 *   - `draw.results` contains the terminal Item.
 *   - DOM: `.loot-chain-link` x2, with `.loot-chain-link-connector`
 *     between them (count == chain.length - 1 per the `{{#unless last}}`
 *     at loot-draw.hbs line 29).
 *   - Only the LAST link carries `.loot-chain-link--last`.
 *   - Terminal drop is a single `.loot-drop--item` named "Accurate Map
 *     (Dungeon Level)".
 */
test.describe('§9 Loot Tables — recursive chain draw', () => {
  test.afterEach(async ({ page }) => {
    // Restore the PRNG stub if the test aborted before its own restore.
    // Mirrors draw-terminal-table.spec.mjs lines 58-63.
    await page.evaluate(() => {
      if (globalThis.__tb2eE2EPrevRandomUniform) {
        CONFIG.Dice.randomUniform = globalThis.__tb2eE2EPrevRandomUniform;
        delete globalThis.__tb2eE2EPrevRandomUniform;
      }
    });
  });

  test('recursive table draw posts a single card with a multi-link chain', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Lock each die to face 1 — u=0.999 → ceil((1-0.999)*faces) = 1.
    // 2d6 → 2 → "Books & Maps" on Loot Table 1; 3d6 → 3 → "Accurate Map
    // (Dungeon Level)" on Books & Maps subtable.
    await page.evaluate(() => {
      globalThis.__tb2eE2EPrevRandomUniform = CONFIG.Dice.randomUniform;
      CONFIG.Dice.randomUniform = () => 0.999;
    });

    // Snapshot chat state BEFORE the draw. Scope by id-diff + top-table
    // id so we can assert exactly one new card posted even if a prior
    // iteration left messages around (relevant under --repeat-each).
    const beforeIds = await page.evaluate(
      () => game.messages.contents.map((m) => m.id),
    );

    // Draw the top-level table. `TB2ELootTable.draw()` (loot-table.mjs
    // line 83) recurses internally and returns {roll, results, chain}.
    const draw = await page.evaluate(async (tableId) => {
      const pack = game.packs.get('tb2e.loot-tables');
      const table = await pack.getDocument(tableId);
      const res = await table.draw();
      return {
        tableName: table.name,
        tableId: table.id,
        chainLen: Array.isArray(res.chain) ? res.chain.length : 0,
        chainNames: Array.isArray(res.chain) ? res.chain.map((l) => l.tableName) : [],
        resultCount: res.results.length,
        resultNames: res.results.map((r) => r.name || r.text || ''),
      };
    }, 'lt00000000000001');

    // The top-level table's name and chain contract.
    expect(draw.tableName).toBe('Loot Table 1');
    expect(draw.chainLen).toBe(2);
    expect(draw.chainNames).toEqual(['Loot Table 1', 'Books & Maps Subtable']);
    // Terminal result: cascaded through two subtables to a single Item.
    expect(draw.resultCount).toBe(1);
    expect(draw.resultNames).toEqual(['Accurate Map (Dungeon Level)']);

    // Wait for chat log to register the new message, then diff.
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

    // Locate the new loot card — scoped to this table's top-level id.
    // `flags.core.RollTable` is the TOP table id (loot-table.mjs line
    // 172), NOT the inner subtable, so filtering by it confirms the
    // recursive draw still posts under the caller.
    const posted = await page.evaluate(
      ({ prev, tableId }) => {
        const seen = new Set(prev);
        const fresh = game.messages.contents.filter((m) => !seen.has(m.id));
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
          rollTableFlag: lootCards[0]?.flags?.core?.RollTable ?? null,
        };
      },
      { prev: beforeIds, tableId: draw.tableId },
    );
    // EXACTLY ONE card posted. Recursion does not fan out to N cards —
    // the whole chain renders in the single message (this is the core
    // invariant of the §9 implementation).
    expect(posted.freshTotal).toBe(1);
    expect(posted.lootCount).toBe(1);
    expect(posted.hasLootFlag).toBe(true);
    expect(posted.rollTableFlag).toBe('lt00000000000001');
    expect(posted.messageId).toBeTruthy();

    // DOM assertions — pin the POM to the known message id so other
    // cards in the log can't fool us. POM reused unchanged from the
    // terminal-table spec (tests/e2e/pages/LootDrawCard.mjs).
    const card = new LootDrawCard(page, { messageId: posted.messageId });
    await card.expectPresent();
    // The card's header names the TOP table, not the subtable.
    await expect(card.tableName).toHaveText('Loot Table 1');

    // Recursive chain: two links, one connector between them. The
    // `{{#unless last}}` at loot-draw.hbs line 29 excludes the connector
    // AFTER the last link, so count == chainLen - 1.
    await expect(card.chainLinks).toHaveCount(2);
    await expect(card.chainConnectors).toHaveCount(1);
    // Only the terminal link gets `loot-chain-link--last` (loot-table.mjs
    // line 147: `last: idx === arr.length - 1`).
    await expect(card.chainLinks.first()).not.toHaveClass(/loot-chain-link--last/);
    await expect(card.chainLinks.last()).toHaveClass(/loot-chain-link--last/);

    // Terminal drop: one Item resolved from the inner subtable.
    await expect(card.drops).toHaveCount(1);
    await expect(card.drops.first()).toHaveClass(/loot-drop--item/);
    const dropNames = await card.dropNameTexts();
    expect(dropNames).toEqual(['Accurate Map (Dungeon Level)']);

    // Restore PRNG before the afterEach fires (defense in depth — if the
    // cleanup hook itself throws, we haven't leaked a stub into the
    // shared browser page).
    await page.evaluate(() => {
      if (globalThis.__tb2eE2EPrevRandomUniform) {
        CONFIG.Dice.randomUniform = globalThis.__tb2eE2EPrevRandomUniform;
        delete globalThis.__tb2eE2EPrevRandomUniform;
      }
    });

    // Cleanup: delete the test's chat message so the shared world stays
    // tidy across iterations (--repeat-each) and later specs.
    await page.evaluate(async (id) => {
      await game.messages.get(id)?.delete();
    }, posted.messageId);
  });
});
