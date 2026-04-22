import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §9 Loot Tables — recursion depth cap.
 *
 * Rules under test:
 *   - `TB2ELootTable.roll` (module/documents/loot-table.mjs lines 26-29)
 *     guards against runaway subtable chains:
 *
 *         if ( _depth > 5 ) {
 *           throw new Error(`Maximum recursion depth exceeded when rolling RollTable ${this.id}`);
 *         }
 *
 *     So `_depth` values 0..5 are permitted and depth 6 throws. At the
 *     top-level call `_depth = 0`, each nested recurse increments it by 1
 *     (loot-table.mjs line 57), i.e. the first subtable is depth 1, so a
 *     chain of up to 6 tables (top + 5 nested) completes normally and a
 *     chain of 7 trips the guard on the 7th table's entry.
 *
 *   - `draw()` (loot-table.mjs line 83) calls `roll()` internally; a throw
 *     from the guard propagates out of `draw()`, so NO chat card is posted
 *     when the cap is exceeded (loot-table.mjs lines 99-101 only run after
 *     `roll()` returns successfully).
 *
 * Approach: the shipped pack ("tb2e.loot-tables") does not contain a chain
 * path 7+ tables deep — loot tables are at most 2-3 levels (cf. the
 * recursive-chain spec, which uses the longest chain in the pack:
 * `Loot Table 1` → `Books & Maps Subtable`, length 2). So this spec
 * CONSTRUCTS a synthetic cycle of 7 world RollTables `T0..T6` where each
 * `Tn` (n in 0..5) has one `document` result whose `documentUuid` points at
 * world `T(n+1)`, and `T6` has a single `text` result (terminal) — drawing
 * `T0` would recurse 7 levels deep if uncapped and should trip the guard.
 *
 * Fake-compendium-source trick: `TB2ELootTable.isLootTable`
 * (module/documents/loot-table.mjs lines 76-81) gates the loot-card path on
 * `this.pack === "tb2e.loot-tables"` OR `_stats.compendiumSource` starting
 * with `"Compendium.tb2e.loot-tables."`. World tables have no `.pack`, so
 * we set the synthetic tables' `_stats.compendiumSource` to a stringified
 * compendium UUID at creation time (compendiumSource is a settable
 * DocumentUUIDField on the _stats schema — foundry/common/data/fields.mjs
 * line 3162 — and is NOT in the `managedFields` list at line 3187, so it's
 * honored on `create`). This exercises the SAME `roll()` path as real
 * loot-table draws, so the guard throws where real tables would.
 *
 * Why this tests the real guard: `roll()` (loot-table.mjs line 26) doesn't
 * consult `isLootTable` — the `_depth > 5` check runs for every RollTable,
 * so making our synthetic tables look like loot tables only affects
 * whether a chat card WOULD have been posted on success. Since the draw
 * throws before `_toLootMessage` runs (loot-table.mjs line 100), no card
 * is posted regardless — but by routing through the loot path we also
 * assert that the guard propagates cleanly out of the user-facing
 * `draw()` wrapper, not just `roll()` in isolation.
 *
 * Asserts:
 *   - `draw()` rejects with an Error whose message matches
 *     `/Maximum recursion depth exceeded/`.
 *   - NO chat card posts (id diff stays empty for loot cards).
 *   - No pageerror events fired during the draw (the throw is caught at the
 *     call site and doesn't leak to the browser as an unhandled rejection).
 *
 * Cleanup: all 7 synthetic world RollTables are deleted in afterEach; the
 * `e2eMaxDepth` tag on flags scopes cleanup so a crashed iteration under
 * `--repeat-each` doesn't leave the world cluttered.
 */

const TAG_KEY = 'e2eMaxDepth';

test.describe('§9 Loot Tables — max recursion depth', () => {
  test.afterEach(async ({ page }) => {
    // Broad cleanup — sweep any tagged synthetic tables left by a crashed
    // iteration so parallel workers / --repeat-each start clean.
    await page.evaluate(async (tag) => {
      const stale = game.tables?.contents.filter((t) => t.flags?.tb2e?.[tag]) ?? [];
      if (stale.length) {
        await RollTable.deleteDocuments(stale.map((t) => t.id));
      }
    }, TAG_KEY);
  });

  test('drawing a 7-deep chain rejects at depth 6 and posts no card', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Capture any unhandled page errors during the draw — the guard should
    // throw a caught Promise rejection from `table.draw()`, NOT an
    // uncaught error that bubbles to the window error handler.
    const pageErrors = [];
    const onPageError = (err) => pageErrors.push(err);
    page.on('pageerror', onPageError);

    // Snapshot chat message ids before the draw so we can diff afterwards.
    // The guard throws before `_toLootMessage` (loot-table.mjs line 100)
    // posts anything, so the diff should stay empty.
    const beforeIds = await page.evaluate(
      () => game.messages.contents.map((m) => m.id),
    );

    // Construct the 7-table chain in the world. Each Tn (0..5) has one
    // `document` result pointing at T(n+1)'s world UUID. T6 has a single
    // `text` result so without the guard the recursion terminates cleanly.
    // A stable `e2e-maxdepth-<timestamp>` suffix keeps names unique even
    // when multiple workers touch the world concurrently.
    const suffix = Date.now();
    const tableIds = await page.evaluate(
      async ({ n, tag, suffix }) => {
        // Allocate ids first so we can wire documentUuid BEFORE create.
        const ids = Array.from({ length: n }, () => foundry.utils.randomID(16));

        // Build each table's data. Range [1,1] on a `1d1` formula makes
        // the single entry always draw — no PRNG stub needed.
        const datas = ids.map((id, idx) => {
          const isTerminal = idx === n - 1;
          const result = isTerminal
            ? {
                // Terminal: plain text result. Drawing it finishes the
                // chain without further recursion (roll-table.mjs line
                // 311-318 only recurses on type:"document" + RollTable).
                type: 'text',
                text: `T${idx} terminal`,
                range: [1, 1],
                weight: 1,
              }
            : {
                // Non-terminal: document result pointing at the NEXT
                // table's world UUID. `RollTable.<id>` (no compendium
                // prefix) is the world-scope UUID — `fromUuid`
                // resolves it from `game.tables`.
                type: 'document',
                documentUuid: `RollTable.${ids[idx + 1]}`,
                range: [1, 1],
                weight: 1,
                name: `-> T${idx + 1}`,
              };
          return {
            _id: id,
            name: `E2E MaxDepth T${idx} ${suffix}`,
            formula: '1d1',
            replacement: true,
            displayRoll: false,
            // Mark every constructed table as a "loot-table pack import"
            // so `TB2ELootTable.isLootTable` (loot-table.mjs lines 76-81)
            // routes the draw through `_toLootMessage`. The stringified
            // UUID just needs the `Compendium.tb2e.loot-tables.` prefix
            // — the trailing id is arbitrary (we reuse a real pack id
            // for tidiness). Confirmed settable at create: foundry/
            // common/data/fields.mjs line 3162 defines `compendiumSource`
            // on the `_stats` schema and line 3187 excludes it from
            // `managedFields`.
            _stats: {
              compendiumSource: 'Compendium.tb2e.loot-tables.RollTable.lt00000000000001',
            },
            flags: { tb2e: { [tag]: true } },
            results: [result],
          };
        });

        const created = await RollTable.createDocuments(datas, { keepId: true });
        return created.map((t) => t.id);
      },
      { n: 7, tag: TAG_KEY, suffix },
    );

    expect(tableIds).toHaveLength(7);

    // Sanity: T0 has the loot-table flag set so the draw would route into
    // `_toLootMessage` on success — we're testing the failure path, but we
    // want to be sure the guard fires BEFORE the success path, not because
    // `isLootTable` returned false (which would just call super.draw()).
    const isLootVerdict = await page.evaluate((id) => {
      const t = game.tables.get(id);
      return t?.isLootTable ?? null;
    }, tableIds[0]);
    expect(isLootVerdict).toBe(true);

    // Invoke draw on T0. Capture the rejection inside the page so we get
    // a structured object back (raw Errors don't cross the Playwright
    // bridge).
    const drawOutcome = await page.evaluate(async (topId) => {
      const top = game.tables.get(topId);
      try {
        const res = await top.draw();
        return { ok: true, chainLen: res?.chain?.length ?? null };
      } catch (err) {
        return { ok: false, message: err?.message ?? String(err), name: err?.name ?? null };
      }
    }, tableIds[0]);

    // The guard threw — `ok: false`, message matches the sentinel string
    // from loot-table.mjs line 28.
    expect(drawOutcome.ok).toBe(false);
    expect(drawOutcome.message).toMatch(/Maximum recursion depth exceeded/);

    // No new loot chat card was posted — id diff is empty for loot cards.
    // We DON'T assert fresh.length === 0 overall because Foundry can post
    // unrelated system messages (e.g. user-activity toasts) under parallel
    // workers; filter by `flags.tb2e.lootDraw` to scope.
    const freshLootCount = await page.evaluate(
      (prev) => {
        const seen = new Set(prev);
        return game.messages.contents.filter(
          (m) => !seen.has(m.id) && m.flags?.tb2e?.lootDraw === true,
        ).length;
      },
      beforeIds,
    );
    expect(freshLootCount).toBe(0);

    // The throw was awaited — no unhandled rejection should have surfaced.
    expect(pageErrors).toEqual([]);
    page.off('pageerror', onPageError);

    // Cleanup: delete all 7 synthetic tables. afterEach sweeps anything
    // left behind, but an explicit delete here keeps --repeat-each fast.
    await page.evaluate(async (ids) => {
      await RollTable.deleteDocuments(ids);
    }, tableIds);
  });
});
