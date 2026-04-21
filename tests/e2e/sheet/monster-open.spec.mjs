import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { MonsterSheet } from '../pages/MonsterSheet.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * Open a monster from the `tb2e.monsters` compendium and verify the sheet
 * renders the core fields a GM needs at a glance.
 *
 * Complements `tests/e2e/character/create-monster.spec.mjs`, which covers the
 * create-from-sidebar path. This spec exercises the import-from-compendium
 * path: we pull a pack entry programmatically (same code path the
 * drag-to-sidebar handler ultimately invokes — `Actor.implementation.create`
 * with the pack entry's `toObject()` snapshot), render the sheet, and check
 * that Nature, dispositions, and the weapons loadout survive the round trip.
 *
 * Chosen monster: Kobold (packs/_source/monsters/Kobold_a1b2c3d4e5f60001.yml).
 *   - Nature 2
 *   - 3 dispositions filled (Flee/Pursue / Capture / Trick)
 *   - 6 weapons
 *   - Scholar's Guide, p. 191 (DH monster stat block)
 *
 * Note on "traits": the briefing checkbox mentions traits, but the monster
 * data model (module/data/actor/monster.mjs) is flat — no embedded Item
 * documents, no `traits` field. The monster sheet's equivalent loadout
 * concept is the `weapons` array rendered in the Weapons table
 * (templates/actors/monster-body.hbs lines 63-104), so we assert on that.
 */

const MONSTER_PACK_ID = 'tb2e.monsters';
const SOURCE_MONSTER = 'Kobold';

/**
 * Import a single named entry from a compendium pack into the world as a new
 * Actor. Returns the created actor's id + the data snapshot we used to
 * create it so the test can assert DOM values match the source.
 *
 * Mirrors the bulk-import pattern in character/import-from-iconic.spec.mjs
 * but scoped to one entry and tagged via `flags.tb2e.e2eTag` for cleanup.
 */
async function importMonsterFromPack(page, { packId, sourceName, uniqueName, tag }) {
  return page.evaluate(
    async ({ pId, src, name, t }) => {
      const pack = window.game.packs.get(pId);
      if (!pack) throw new Error(`Pack not found: ${pId}`);
      const docs = await pack.getDocuments();
      const source = docs.find((d) => d.name === src);
      if (!source) throw new Error(`Source "${src}" not in pack ${pId}`);

      const data = source.toObject();
      data.name = name;
      data.flags = {
        ...(data.flags ?? {}),
        tb2e: { ...(data.flags?.tb2e ?? {}), e2eTag: t },
      };
      const created = await window.Actor.implementation.create(data);
      return {
        id: created.id,
        name: created.name,
        type: created.type,
        nature: created.system.nature,
        dispositions: created.system.dispositions.map((d) => ({
          conflictType: d.conflictType,
          hp: d.hp,
        })),
        weapons: created.system.weapons.map((w) => ({ name: w.name })),
      };
    },
    { pId: packId, src: sourceName, name: uniqueName, t: tag }
  );
}

async function cleanupTaggedActors(page, tag) {
  await page.evaluate(async (t) => {
    const ids = window.game.actors
      .filter((a) => a.getFlag?.('tb2e', 'e2eTag') === t)
      .map((a) => a.id);
    if (ids.length) {
      await window.Actor.implementation.deleteDocuments(ids);
    }
  }, tag);
}

test.describe('Monster sheet — open from compendium', () => {
  test('imports Kobold from tb2e.monsters and renders Nature / dispositions / weapons', async ({
    page,
  }, testInfo) => {
    const tag = `e2e-monster-open-${testInfo.workerIndex}-${Date.now()}`;
    const uniqueName = `${SOURCE_MONSTER} E2E ${Date.now()}`;

    // Surface any uncaught page errors — the monster sheet should open clean.
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err));

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    try {
      const imported = await importMonsterFromPack(page, {
        packId: MONSTER_PACK_ID,
        sourceName: SOURCE_MONSTER,
        uniqueName,
        tag,
      });

      expect(imported.id).toBeTruthy();
      expect(imported.type).toBe('monster');
      expect(imported.name).toBe(uniqueName);
      // Sanity-check the source data survived the import — if the Kobold YAML
      // is ever changed, these will tell us loudly.
      expect(imported.nature).toBeGreaterThan(0);
      expect(imported.dispositions.length).toBe(3);
      expect(imported.weapons.length).toBeGreaterThan(0);

      // Open the sheet via the API — equivalent to clicking the sidebar
      // entry, minus the traversal. This is what the other sheet specs do
      // (see sheet/edit-identity.spec.mjs for the pattern).
      await page.evaluate((id) => {
        window.game.actors.get(id).sheet.render(true);
      }, imported.id);

      const sheet = new MonsterSheet(page, uniqueName);
      await sheet.expectOpen();

      // Name flows to the window title and the name input in the header.
      await expect(sheet.nameInput).toHaveValue(uniqueName);

      // Nature — core stat exposed in the body's "Core Stats" fieldset.
      // monster-body.hbs line 9.
      await expect(sheet.natureInput).toHaveValue(String(imported.nature));

      // Dispositions — 3 rows (strength / competency / weakness tiers),
      // schema-defined in module/data/actor/monster.mjs lines 30-33 with
      // `initial: [{}, {}, {}]`. Assert the row count plus at least one
      // populated row matches the source data.
      await expect(sheet.dispositionRows).toHaveCount(3);
      for (let i = 0; i < imported.dispositions.length; i++) {
        const d = imported.dispositions[i];
        if (d.conflictType) {
          await expect(sheet.dispositionTypeInput(i)).toHaveValue(d.conflictType);
        }
        await expect(sheet.dispositionHpInput(i)).toHaveValue(String(d.hp));
      }

      // Weapons — monster "loadout". The Kobold pack entry has 6 weapons;
      // we assert the count matches and the first weapon's name renders.
      await expect(sheet.weaponRows).toHaveCount(imported.weapons.length);
      await expect(sheet.weaponNameInput(0)).toHaveValue(imported.weapons[0].name);

      // No uncaught page errors during the render cycle.
      expect(pageErrors, pageErrors.map((e) => e.message).join('\n')).toEqual([]);
    } finally {
      await cleanupTaggedActors(page, tag);
    }
  });
});
