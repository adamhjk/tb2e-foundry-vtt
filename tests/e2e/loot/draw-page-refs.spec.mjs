import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { LootDrawCard } from '../pages/LootDrawCard.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §9 Loot Tables — page references render on the draw card.
 *
 * Rules under test:
 *   - Scholar's Guide loot tables cite a book + page on every entry
 *     (table-level "description" in the pack YAML; item-level
 *     `system.description` on the terminal Item). The chat card must
 *     surface those citations so the GM/players can look up the rule
 *     while resolving a draw.
 *
 * Data plumbing (module/documents/loot-table.mjs):
 *   - Line 156: `table.pageRef = this.description` — the TOP table's
 *     pageRef rendered as `.card-subtitle` in the card header
 *     (templates/chat/loot-draw.hbs lines 7-9).
 *   - Line 138: `pageRef: linkedDoc?.system?.description` — the per-drop
 *     page ref rendered as `.loot-drop-page` (loot-draw.hbs lines 65-67).
 *   - Line 39: each CHAIN LINK also carries a `pageRef` in data, but the
 *     current chain template (loot-draw.hbs lines 19-28) does not render
 *     it — only the top-table subtitle and per-drop refs are surfaced.
 *
 * Chosen draw — same as the recursive-chain spec (draw-recursive-chain.spec.mjs):
 *   - Top: `Loot Table 1` (id `lt00000000000001`) — YAML `description:
 *     "Scholar's Guide, p. 152"` (packs/_source/loot-tables/
 *     Loot_Table_1_lt00000000000001.yml line 4).
 *   - Sub: `Books & Maps Subtable` (id `lt00000000000006`) — YAML
 *     `description: "Scholar's Guide, p. 153"`
 *     (Books_and_Maps_Subtable_lt00000000000006.yml line 4). Not
 *     rendered by the template, but verified indirectly by the
 *     terminal drop's own pageRef below.
 *   - Terminal Item: `Accurate Map (Dungeon Level)` (id
 *     `aa00000000000001`) — YAML `system.description: "Scholar's Guide,
 *     p. 153"` (packs/_source/loot/Accurate_Map_Dungeon_Level_*.yml
 *     line 6). Rendered as `.loot-drop-page`.
 *
 * PRNG stub `CONFIG.Dice.randomUniform = () => 0.999` locks every die to
 * face 1 (same technique as draw-recursive-chain.spec.mjs lines 73-76):
 * 2d6→2 on Loot Table 1 → "Books & Maps"; 3d6→3 on Books & Maps →
 * "Accurate Map (Dungeon Level)".
 *
 * Asserts:
 *   - Header subtitle shows the top table's page ref ("Scholar's Guide,
 *     p. 152").
 *   - Exactly one `.loot-drop-page` element is rendered (one terminal
 *     drop — so any multi-match here would mean extra cards leaked in).
 *   - That page-ref element shows the Item's page ref ("Scholar's
 *     Guide, p. 153").
 *
 * Not asserted:
 *   - Per-chain-link page refs — not rendered by the template (see
 *     loot-draw.hbs lines 19-28; the chain body only emits tableName /
 *     formula / rollTotal). If chain-link refs are added later, extend
 *     this spec.
 */
test.describe('§9 Loot Tables — page refs on card', () => {
  test.afterEach(async ({ page }) => {
    // Restore PRNG stub if the test aborted mid-way (mirrors
    // draw-recursive-chain.spec.mjs lines 53-62). The browser page
    // persists across specs so a leaked stub would poison every
    // downstream test.
    await page.evaluate(() => {
      if (globalThis.__tb2eE2EPrevRandomUniform) {
        CONFIG.Dice.randomUniform = globalThis.__tb2eE2EPrevRandomUniform;
        delete globalThis.__tb2eE2EPrevRandomUniform;
      }
    });
  });

  test('renders top-table and terminal-drop page references', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Lock each die to face 1 — see loot-table.mjs header comment.
    await page.evaluate(() => {
      globalThis.__tb2eE2EPrevRandomUniform = CONFIG.Dice.randomUniform;
      CONFIG.Dice.randomUniform = () => 0.999;
    });

    // Snapshot chat so we can diff for this draw's exact message.
    const beforeIds = await page.evaluate(
      () => game.messages.contents.map((m) => m.id),
    );

    // Draw the top-level table. Recurses internally → chain of 2 links,
    // terminal Item in .results[0]. (Same draw shape as
    // draw-recursive-chain.spec.mjs — we only assert page refs here.)
    const draw = await page.evaluate(async (tableId) => {
      const pack = game.packs.get('tb2e.loot-tables');
      const table = await pack.getDocument(tableId);
      const res = await table.draw();
      return {
        tableId: table.id,
        chainLen: Array.isArray(res.chain) ? res.chain.length : 0,
        resultNames: res.results.map((r) => r.name || r.text || ''),
      };
    }, 'lt00000000000001');

    // Sanity: same recursion shape as the chain spec — guards against
    // silent drift in the pack YAML that might land us on a different
    // terminal Item and break the page-ref expectation below.
    expect(draw.chainLen).toBe(2);
    expect(draw.resultNames).toEqual(['Accurate Map (Dungeon Level)']);

    // Wait for the new message, filter to this draw's loot card.
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

    const posted = await page.evaluate(
      ({ prev, tableId }) => {
        const seen = new Set(prev);
        const fresh = game.messages.contents.filter((m) => !seen.has(m.id));
        const lootCards = fresh.filter(
          (m) =>
            m.flags?.tb2e?.lootDraw === true &&
            m.flags?.core?.RollTable === tableId,
        );
        return { messageId: lootCards[0]?.id ?? null };
      },
      { prev: beforeIds, tableId: draw.tableId },
    );
    expect(posted.messageId).toBeTruthy();

    // Pin the POM to this exact message so concurrent chat activity
    // (reminder cards, other specs' strays) can't bleed into the
    // assertions.
    const card = new LootDrawCard(page, { messageId: posted.messageId });
    await card.expectPresent();

    // Top-table page ref — rendered as the card header subtitle. YAML
    // source: packs/_source/loot-tables/Loot_Table_1_lt00000000000001.yml
    // line 4 (`description: 'Scholar''s Guide, p. 152'`).
    await expect(card.tableSubtitle).toBeVisible();
    await expect(card.tableSubtitle).toHaveText("Scholar's Guide, p. 152");

    // Terminal-drop page ref — exactly one drop, so exactly one
    // `.loot-drop-page` element. YAML source:
    // packs/_source/loot/Accurate_Map_Dungeon_Level_aa00000000000001.yml
    // line 6 (`system.description: "Scholar's Guide, p. 153"`).
    await expect(card.dropPageRefs).toHaveCount(1);
    const dropRefs = await card.dropPageRefTexts();
    expect(dropRefs).toEqual(["Scholar's Guide, p. 153"]);

    // Restore PRNG early so a hook-level failure doesn't propagate the
    // stub to later specs (defense in depth — afterEach restores too).
    await page.evaluate(() => {
      if (globalThis.__tb2eE2EPrevRandomUniform) {
        CONFIG.Dice.randomUniform = globalThis.__tb2eE2EPrevRandomUniform;
        delete globalThis.__tb2eE2EPrevRandomUniform;
      }
    });

    // Cleanup — delete the test's own chat message so the shared world
    // stays clean across --repeat-each and later specs.
    await page.evaluate(async (id) => {
      await game.messages.get(id)?.delete();
    }, posted.messageId);
  });
});
