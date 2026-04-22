import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { CompendiumWindow } from '../pages/CompendiumWindow.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §8 Compendiums — search within a pack filters the entry list.
 *
 * Contract: the compendium window's header search input filters the visible
 * entry rows by name (case-insensitive). The filter lives in
 *   foundry/client/applications/sidebar/document-directory.mjs:132 (`#searchFilter`,
 *     bound to `<search> <input>` via selector "search input")
 *   foundry/client/applications/sidebar/document-directory.mjs:678 (_onMatchSearchEntry:
 *     sets `element.style.display = "none"` on non-matching rows)
 *   foundry/client/applications/ux/search-filter.mjs:60 (200ms debounce by default)
 * The filter is a name-substring match normalized via `SearchFilter.cleanQuery`
 * (NFD + diacritic strip) and tested against a case-insensitive RegExp built
 * from the cleaned query (search-filter.mjs:180).
 *
 * Target pack: `tb2e.monsters` (40 entries — stable, opened via the sibling
 * open-each-pack spec too). The query "troll" matches exactly three entries
 * whose names start with "Troll_" (packs/_source/monsters/Troll_{Bat,Haunt,Rat}_*.yml).
 * The match count (3) is a stable subset < baseline (40) and > 0, which
 * satisfies the checklist: "rendered count is reduced AND > 0".
 *
 * Why "troll" and not e.g. "goblin" or "dragon":
 *   - "goblin" also matches "Hobgoblin" (2 rows) — still a valid reduction,
 *     but less obvious than three Troll_* siblings.
 *   - "dragon" matches Black_Dragon + Red_Dragon (2 rows).
 *   - "troll" gives a 3-row subset, which survives if a new Troll_* entry is
 *     added without anyone re-examining this spec (the assertion is `>= 2`,
 *     reduced, `< baseline` — so 3 → 4 is still green).
 *
 * Open approach: `pack.render(true)` bypasses the sidebar folder nav (same
 * idiom as drag-weapon-to-inventory.spec.mjs and drag-spell-to-magic-tab.spec.mjs).
 * The sidebar path is covered by open-each-pack.spec.mjs; this spec's concern
 * is the search UI inside the window, not how the window was opened.
 *
 * Debounce handling: SearchFilter debounces input handling by 200ms
 * (search-filter.mjs:60). We use `expect.poll(...)` against the visible-row
 * count to wait for the filter to settle rather than a fixed `waitForTimeout`.
 *
 * Narrow scope — out of scope:
 *   - Tag/category filters (not in the v13 compendium header template).
 *   - Search across multiple packs simultaneously.
 *   - Full-text (non-name) search mode — this spec uses the default name
 *     mode; the collection's `searchMode` is not toggled.
 *   - Drag from a filtered list (covered in sibling §8 drag specs).
 */
const PACK_ID = 'tb2e.monsters';
const QUERY = 'troll';
// Expected Troll_* entries (packs/_source/monsters/Troll_{Bat,Haunt,Rat}_*.yml
// at time of writing — 3 rows). The spec asserts the count is reduced and
// >= this floor, so adding a new Troll_* entry won't break the assertion.
const EXPECTED_MATCH_FLOOR = 3;

test.describe('Compendium search filters the entry list', () => {
  test('typing a name substring reduces the visible entry count', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Open the pack window programmatically — same idiom as the sibling
    // drag specs. The sidebar path is covered by open-each-pack.spec.mjs.
    await page.evaluate(async (packId) => {
      const pack = window.game.packs.get(packId);
      if (!pack) throw new Error(`Pack not found: ${packId}`);
      await pack.render(true);
    }, PACK_ID);

    const compWindow = new CompendiumWindow(page, PACK_ID);
    await compWindow.waitForOpen();
    await expect(compWindow.searchInput).toBeVisible();

    // Baseline: count visible entry rows before filtering. All rows are
    // visible at mount — SearchFilter.bind() runs once with an empty query
    // (search-filter.mjs:155) and the _onSearchFilter handler leaves every
    // row displayed when `query` is falsy (document-directory.mjs:708-712).
    await expect(compWindow.entryRows.first()).toBeVisible();
    const baseline = await compWindow.visibleEntryRows.count();
    expect(
      baseline,
      `pack ${PACK_ID} must have enough entries to demonstrate filtering`,
    ).toBeGreaterThan(EXPECTED_MATCH_FLOOR);

    // Type the query and poll until the filter settles below baseline.
    // SearchFilter debounces 200ms (search-filter.mjs:60) — `expect.poll`
    // handles the settle without a brittle fixed sleep.
    await compWindow.search(QUERY);
    await expect
      .poll(() => compWindow.visibleEntryRows.count(), { timeout: 5_000 })
      .toBeLessThan(baseline);

    // After settle: visible row count should be the Troll_* floor (at least),
    // still less than baseline, and strictly > 0 (the filter matched
    // something — not a broken "hide everything" state).
    const filtered = await compWindow.visibleEntryRows.count();
    expect(filtered).toBeGreaterThanOrEqual(EXPECTED_MATCH_FLOOR);
    expect(filtered).toBeLessThan(baseline);

    // Every visible row must actually match the query (case-insensitive
    // name match). Using the index's cleaned name (same path SearchFilter
    // uses via `SearchFilter.cleanQuery` — search-filter.mjs:192) so we're
    // asserting the same semantic the filter applies.
    const visibleNames = await compWindow.visibleEntryRows
      .locator('.entry-name')
      .allTextContents();
    expect(visibleNames.length).toBe(filtered);
    for (const name of visibleNames) {
      expect(
        name.toLowerCase(),
        `row "${name}" should contain "${QUERY}" (case-insensitive)`,
      ).toContain(QUERY);
    }

    // Clear the search — all rows should return to visible (baseline).
    // Exercises the other half of the filter contract: empty query →
    // display:"" for every row (document-directory.mjs:708-712 / 678).
    await compWindow.clearSearch();
    await expect
      .poll(() => compWindow.visibleEntryRows.count(), { timeout: 5_000 })
      .toBe(baseline);
  });
});
