import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { CompendiumSidebar } from '../pages/CompendiumSidebar.mjs';
import { CompendiumWindow } from '../pages/CompendiumWindow.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §8 Compendiums — open-each-pack
 *
 * Contract: every pack registered in system.json is loadable at runtime and
 * has a non-trivial entry count. Packs are the canonical content surface for
 * the system, so a silent build regression (e.g., a pack that fails to
 * compile and loads empty — see CLAUDE.md "Compendium Packs" on the `_key`
 * requirement) must fail the suite loudly.
 *
 * Two tests:
 *   1. Programmatic sweep across every pack in `game.system.packs` (source of
 *      truth after load). No hard-coded pack list; the iteration comes from
 *      Foundry's registered manifest. Each pack must (a) resolve via
 *      `game.packs.get`, (b) have an index size ≥ the per-pack floor below.
 *   2. UI sanity check: open the `monsters` pack via the sidebar and assert
 *      the window renders with entry rows. Proves the sidebar/render path
 *      works without paying the O(N) cost of opening every pack.
 *
 * EXPECTED_MIN_ENTRIES is a per-pack floor, not a ceiling — packs can grow.
 * Floors are set conservatively below the current source count so routine
 * additions don't break this spec; a regression (missing _key, empty LevelDB,
 * unpacked yaml, etc.) will still trip it.
 *
 * Baseline counts (packs/_source/<pack>/*.yml, verified against the live
 * index.size of each CompendiumCollection at time of writing):
 *   agents: 11         armor: 11           bulk-goods: 15
 *   clothing: 11       containers: 17      equipment: 24
 *   food-and-drink: 2  iconic-characters: 9  light-sources: 6
 *   loot: 48           loot-tables: 49     magical-religious: 8
 *   magic-items: 34    monsters: 40        musical-instruments: 3
 *   npcs: 41           phase-scenes: 4     potions: 11
 *   richer-loot: 61    shamanic-invocations: 36  shamanic-relics: 36
 *   spells: 51         theurge-invocations: 49   theurge-relics: 45
 *   weapons: 20
 *
 * Floors below are the baseline count (a regression that drops entries is
 * what we want to catch). New entries pass trivially; only unintentional
 * shrinkage fails. The build pipeline (npm run build:db) is what keeps
 * packs/ in sync with packs/_source/; a missing _key field silently skips
 * the entry (CLAUDE.md "Compendium Packs") — this spec catches that class
 * of regression loudly.
 */
const EXPECTED_MIN_ENTRIES = {
  'tb2e.agents': 11,
  'tb2e.armor': 11,
  'tb2e.bulk-goods': 15,
  'tb2e.clothing': 11,
  'tb2e.containers': 17,
  'tb2e.equipment': 24,
  'tb2e.food-and-drink': 2,
  'tb2e.iconic-characters': 9,
  'tb2e.light-sources': 6,
  'tb2e.loot': 48,
  'tb2e.loot-tables': 49,
  'tb2e.magical-religious': 8,
  'tb2e.magic-items': 34,
  'tb2e.monsters': 40,
  'tb2e.musical-instruments': 3,
  'tb2e.npcs': 41,
  'tb2e.phase-scenes': 4,
  'tb2e.potions': 11,
  'tb2e.richer-loot': 61,
  'tb2e.shamanic-invocations': 36,
  'tb2e.shamanic-relics': 36,
  'tb2e.spells': 51,
  'tb2e.theurge-invocations': 49,
  'tb2e.theurge-relics': 45,
  'tb2e.weapons': 20,
};

/** Packs not in the table still must have at least this many entries. */
const DEFAULT_MIN_ENTRIES = 1;

test.describe('Compendium packs', () => {
  test('every registered pack loads with the expected minimum entries', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Read `game.system.packs` (the post-load source of truth, matching
    // system.json at runtime) and fetch each pack's index size. Using
    // `getIndex()` is cheaper than `getDocuments()` — we only need counts.
    const results = await page.evaluate(async () => {
      // game.system.packs is the list from system.json; each CompendiumCollection
      // is registered as `<system-id>.<pack-name>`.
      const registered = Array.from(window.game.system.packs ?? []);
      const out = [];
      for (const meta of registered) {
        const packId = `${window.game.system.id}.${meta.name}`;
        const pack = window.game.packs.get(packId);
        if (!pack) {
          out.push({ packId, found: false, count: 0, type: meta.type });
          continue;
        }
        const index = await pack.getIndex();
        out.push({
          packId,
          found: true,
          count: index.size ?? index.length ?? 0,
          type: pack.documentName,
        });
      }
      return out;
    });

    // Every registered pack must resolve.
    for (const r of results) {
      expect(r.found, `pack "${r.packId}" is registered in system.json but not in game.packs`).toBe(true);
    }

    // Every pack must meet its floor.
    const shortfalls = [];
    for (const r of results) {
      const floor = EXPECTED_MIN_ENTRIES[r.packId] ?? DEFAULT_MIN_ENTRIES;
      if (r.count < floor) {
        shortfalls.push(`${r.packId}: ${r.count} < ${floor}`);
      }
    }
    expect(
      shortfalls,
      `pack entry counts below expected floor:\n  ${shortfalls.join('\n  ')}`,
    ).toEqual([]);

    // Sanity: system.json registers 25 packs (at time of writing). If a pack
    // is added, bump the floor here and add it to EXPECTED_MIN_ENTRIES.
    expect(results.length).toBeGreaterThanOrEqual(25);
  });

  test('compendium window opens for monsters pack and renders entries', async ({ page }) => {
    // UI sanity — monsters is a large, stable pack; picking it proves the
    // sidebar → window render path works without paying the O(N) cost of
    // opening every pack. Other §8 specs cover drag-drop from specific packs.
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    const compSidebar = new CompendiumSidebar(page);
    await compSidebar.open();
    await compSidebar.openPack('tb2e.monsters');

    const compWindow = new CompendiumWindow(page, 'tb2e.monsters');
    await compWindow.waitForOpen();

    // The window must render entry rows — `li.directory-item` matches the
    // Foundry compendium directory template (same selector used by
    // CompendiumWindow.entryByName and the ActorsSidebar POM).
    const rows = compWindow.root.locator('li.directory-item');
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeGreaterThanOrEqual(EXPECTED_MIN_ENTRIES['tb2e.monsters']);
  });
});
