import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §X Camp Events compendium (Phase B2).
 *
 * Rules citations — SG pp. 266–278. Each of six camp-type tables must:
 *   - Exist in the `tb2e.camp-events` compendium with formula `3d6`.
 *   - Have a descriptive page reference in its `description`.
 *   - Carry a `flags.tb2e.campEvents.campType` tag.
 *   - Store result names with `(SG p.NNN)` — never the rule prose.
 *   - Tag each result with `flags.tb2e.campEvents` including at least
 *     `isDisaster`, and for disasters `isUnavertable` + `avert` config.
 *
 * Subtables (SG p. 267, 268, 270, 272, 274, 275, 276, 277, 278) must exist
 * with formula `1d6` and be linked from their parent via `documentUuid`.
 *
 * Cross-pack linkage: existing loot tables (`tb2e.loot-tables`) linked where
 * the rules say "Roll on the X subtable".
 */
test.describe('§X Camp Events compendium (Phase B2)', () => {

  test('exposes 6 main camp-type tables with 3d6 formula and campType flag', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    const summary = await page.evaluate(async () => {
      const pack = game.packs.get('tb2e.camp-events');
      if ( !pack ) return { error: 'pack missing' };
      const docs = await pack.getDocuments();
      const main = docs.filter(d => !d.getFlag('tb2e', 'campEvents')?.isSubtable);
      return main.map(t => ({
        id: t.id,
        name: t.name,
        formula: t.formula,
        description: t.description,
        campType: t.getFlag('tb2e', 'campEvents')?.campType,
        resultCount: t.results.size
      })).sort((a, b) => a.name.localeCompare(b.name));
    });

    // 6 main tables in alphabetical order.
    expect(summary).toHaveLength(6);
    const expectedTypes = new Set([
      'ancient-ruins', 'dungeons', 'natural-caves',
      'outside-town', 'squatting-in-town', 'wilderness'
    ]);
    const foundTypes = new Set(summary.map(t => t.campType));
    expect(foundTypes).toEqual(expectedTypes);

    // Every main table is 3d6.
    for ( const t of summary ) {
      expect(t.formula).toBe('3d6');
      expect(t.description).toMatch(/Scholar's Guide/);
    }
  });

  test('result names carry (SG p.NNN) page refs, no prose body', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    const naughty = await page.evaluate(async () => {
      const pack = game.packs.get('tb2e.camp-events');
      const docs = await pack.getDocuments();
      const issues = [];
      for ( const table of docs ) {
        for ( const r of table.results ) {
          const name = r.name || r.text || '';
          const hasPageRef = /\(SG p\.\s?\d+\)/.test(name);
          if ( !hasPageRef ) issues.push({ table: table.name, id: r.id, reason: 'missing-page-ref', name });
          // Prose body: description should be empty or trivial. Anything over
          // 40 chars would be a rule summary that should live in the book.
          if ( (r.description || '').length > 40 ) {
            issues.push({ table: table.name, id: r.id, reason: 'prose-description', desc: r.description });
          }
          // Text field on text-type results — same bound.
          if ( r.type === CONST.TABLE_RESULT_TYPES.TEXT && (r.text || '').length > 60 ) {
            issues.push({ table: table.name, id: r.id, reason: 'prose-text', text: r.text });
          }
        }
      }
      return issues;
    });

    expect(naughty).toEqual([]);
  });

  test('disasters carry campEvents flags with avert config (or unavertable)', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    const sample = await page.evaluate(async () => {
      const pack = game.packs.get('tb2e.camp-events');
      const docs = await pack.getDocuments();

      // Spot-check specific entries the rules lock in.
      const natural = docs.find(d => d.name === 'Natural Caves Camp Events');
      const cavein = [...natural.results].find(r => r.name.startsWith('Cave-in'));

      const ruins = docs.find(d => d.name === 'Ancient Ruins Camp Events');
      const collapse = [...ruins.results].find(r => r.name.startsWith('Collapse'));

      const wilderness = docs.find(d => d.name === 'Wilderness Camp Events');
      const gnits = [...wilderness.results].find(r => r.name.startsWith('Gnits'));

      const dungeons = docs.find(d => d.name === 'Dungeons Camp Events');
      const foulVapors = [...dungeons.results].find(r => r.name.startsWith('Foul vapors'));

      return {
        cavein:      cavein      ? { ...cavein.flags.tb2e.campEvents,      range: cavein.range }      : null,
        collapse:    collapse    ? { ...collapse.flags.tb2e.campEvents,    range: collapse.range }    : null,
        gnits:       gnits       ? { ...gnits.flags.tb2e.campEvents,       range: gnits.range }       : null,
        foulVapors:  foulVapors  ? { ...foulVapors.flags.tb2e.campEvents,  range: foulVapors.range }  : null
      };
    });

    // Cave-in (SG p. 270) — avertable disaster.
    expect(sample.cavein.isDisaster).toBe(true);
    expect(sample.cavein.isUnavertable).toBe(false);
    expect(sample.cavein.avert.allowed).toBe(true);
    expect(sample.cavein.range).toEqual([0, 0]);

    // Collapse (SG p. 266) — unavertable disaster, 0-1.
    expect(sample.collapse.isDisaster).toBe(true);
    expect(sample.collapse.isUnavertable).toBe(true);
    expect(sample.collapse.range).toEqual([0, 1]);

    // Gnits (SG p. 277) — unavertable disaster.
    expect(sample.gnits.isDisaster).toBe(true);
    expect(sample.gnits.isUnavertable).toBe(true);

    // Foul vapors (SG p. 268) — unavertable disaster.
    expect(sample.foulVapors.isDisaster).toBe(true);
    expect(sample.foulVapors.isUnavertable).toBe(true);
  });

  test('subtables exist and are linked from parent results via documentUuid', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    const check = await page.evaluate(async () => {
      const pack = game.packs.get('tb2e.camp-events');
      const docs = await pack.getDocuments();

      const subtables = docs.filter(d => d.getFlag('tb2e', 'campEvents')?.isSubtable);

      // For each subtable, find a parent result linking to it.
      const subUuids = new Set(subtables.map(t => t.uuid));
      const incomingLinks = new Set();
      for ( const table of docs ) {
        for ( const r of table.results ) {
          if ( r.type === CONST.TABLE_RESULT_TYPES.DOCUMENT && subUuids.has(r.documentUuid) ) {
            incomingLinks.add(r.documentUuid);
          }
        }
      }

      return {
        subtableCount: subtables.length,
        subtableNames: subtables.map(t => t.name).sort(),
        allLinked: subtables.every(t => incomingLinks.has(t.uuid)),
        unlinked: subtables.filter(t => !incomingLinks.has(t.uuid)).map(t => t.name)
      };
    });

    expect(check.subtableCount).toBe(12);
    expect(check.allLinked).toBe(true);
    expect(check.unlinked).toEqual([]);
    expect(check.subtableNames).toEqual([
      'Cave Lair Owner',
      'Cave Raiders',
      'Corrosion Location',
      'Dungeon Curiosity',
      'Dungeon Interlopers',
      'Eavesdrop Topic',
      'Fellow Traveler Class',
      'House Goblin Consequence',
      'Near-Town Raiders',
      'Teen Activity',
      'Town Lurkers',
      'Wilderness Wanderers'
    ]);
  });

  test('loot-subtable links point to tb2e.loot-tables (no inline prose for loot drops)', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    const crosslinks = await page.evaluate(async () => {
      const pack = game.packs.get('tb2e.camp-events');
      const docs = await pack.getDocuments();
      const out = [];
      for ( const table of docs ) {
        for ( const r of table.results ) {
          if ( r.type !== CONST.TABLE_RESULT_TYPES.DOCUMENT ) continue;
          const uuid = r.documentUuid ?? '';
          if ( uuid.startsWith('Compendium.tb2e.loot-tables.RollTable.') ) {
            out.push({ table: table.name, result: r.name, uuid });
          }
        }
      }
      return out;
    });

    // At least the named loot references from SG: Tome of Ancient Lore, Magic,
    // Works of Art, Treasure & Valuables 1, Gear, Books & Maps, Gems.
    const labels = crosslinks.map(c => c.result).join('\n');
    expect(labels).toMatch(/Tome of Ancient Lore/);
    expect(labels).toMatch(/Magic subtable/);
    expect(labels).toMatch(/Works of Art/);
    expect(labels).toMatch(/Treasure & Valuables 1/);
    expect(labels).toMatch(/Gear subtable/);
    expect(labels).toMatch(/Books & Maps/);
    expect(labels).toMatch(/Gem subtable/);
  });
});
