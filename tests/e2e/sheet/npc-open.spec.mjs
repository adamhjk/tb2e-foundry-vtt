import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { NPCSheet } from '../pages/NPCSheet.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * Open an NPC from the `tb2e.npcs` compendium and verify the sheet renders
 * the core identity + stat-block fields a GM needs at a glance.
 *
 * Mirrors tests/e2e/sheet/monster-open.spec.mjs (see lines 42-83) — same
 * "pull one pack entry, import with an e2eTag, open via API, assert fields,
 * clean up" pattern. The difference is the NPC data model
 * (`module/data/actor/npc.mjs`) is richer than the monster's flat schema:
 * NPCs have an `abilities` object (nature/will/health + town abilities), a
 * variable-length `skills` array, a `wises` string array, and embedded trait
 * items. We assert the fields the Alchemist pack entry populates so the
 * import round-trip is meaningful.
 *
 * Chosen NPC: Alchemist (packs/_source/npcs/Alchemist_f1e2d3c4b5a60001.yml).
 *   - Nature 2, Will 6, Health 3, Might 2
 *   - 3 skills (alchemist / healer / loremaster)
 *   - 2 wises (Chemistry-wise / Herb-wise)
 *   - 2 trait items (Curious / Wise, both level 2)
 *   - Scholar's Guide, p. 201
 *
 * Note on the production-bug history (TEST_PLAN.md line 66): an earlier
 * iteration of create-npc.spec.mjs flagged an ENOENT at
 * `module/applications/actor/npc-sheet.mjs:43` pointing to a nonexistent
 * `character-conflict.hbs`. That reference is gone in the current source —
 * line 43 now points to `templates/actors/npc-body.hbs`, which exists. This
 * spec therefore runs green. The create-npc spec (line 66) is out of scope
 * here but worth flipping in a separate iteration.
 */

const NPC_PACK_ID = 'tb2e.npcs';
const SOURCE_NPC = 'Alchemist';

/**
 * Import a single named entry from a compendium pack into the world as a new
 * Actor. Returns the created actor's id + the data snapshot we used to
 * create it so the test can assert DOM values match the source. Mirrors the
 * monster-open.spec.mjs helper but shaped for the richer NPC schema.
 */
async function importNpcFromPack(page, { packId, sourceName, uniqueName, tag }) {
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
        stock: created.system.stock,
        class: created.system.class,
        goal: created.system.goal,
        might: created.system.might,
        abilities: {
          nature: created.system.abilities.nature.rating,
          will: created.system.abilities.will.rating,
          health: created.system.abilities.health.rating,
        },
        skills: created.system.skills.map((s) => ({ key: s.key, rating: s.rating })),
        wises: [...created.system.wises],
        traitCount: created.itemTypes?.trait?.length ?? 0,
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

test.describe('NPC sheet — open from compendium', () => {
  test('imports Alchemist from tb2e.npcs and renders identity / abilities / skills / wises / traits', async ({
    page,
  }, testInfo) => {
    const tag = `e2e-npc-open-${testInfo.workerIndex}-${Date.now()}`;
    const uniqueName = `${SOURCE_NPC} E2E ${Date.now()}`;

    // Surface any uncaught page errors — historically npc-sheet.mjs:43
    // threw ENOENT on an invalid template ref (TEST_PLAN.md line 66). The
    // fix is in place but this assertion guards against regression.
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err));

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    try {
      const imported = await importNpcFromPack(page, {
        packId: NPC_PACK_ID,
        sourceName: SOURCE_NPC,
        uniqueName,
        tag,
      });

      expect(imported.id).toBeTruthy();
      expect(imported.type).toBe('npc');
      expect(imported.name).toBe(uniqueName);
      // Sanity-check the source YAML survived the import. If the Alchemist
      // pack entry is ever edited these will tell us loudly.
      expect(imported.abilities.nature).toBeGreaterThan(0);
      expect(imported.skills.length).toBeGreaterThan(0);
      expect(imported.wises.length).toBeGreaterThan(0);
      expect(imported.traitCount).toBeGreaterThan(0);

      // Open the sheet via the API — same approach as monster-open.spec.mjs.
      await page.evaluate((id) => {
        window.game.actors.get(id).sheet.render(true);
      }, imported.id);

      const sheet = new NPCSheet(page, uniqueName);
      await sheet.expectOpen();

      // Header — name flows to the window title (in the POM filter) and the
      // header name input (npc-header.hbs line 18).
      await expect(sheet.nameInput).toHaveValue(uniqueName);

      // Identity strip — npc-body.hbs lines 4-17. Alchemist ships with all
      // three fields blank, so we just assert the inputs rendered.
      await expect(sheet.stockInput).toHaveValue(imported.stock ?? '');
      await expect(sheet.classInput).toHaveValue(imported.class ?? '');
      await expect(sheet.goalInput).toHaveValue(imported.goal ?? '');

      // Raw abilities — npc-body.hbs lines 20-30, bound to
      // `system.abilities.<key>.rating` per npc.mjs lines 13-32.
      await expect(sheet.natureInput).toHaveValue(String(imported.abilities.nature));
      await expect(sheet.willInput).toHaveValue(String(imported.abilities.will));
      await expect(sheet.healthInput).toHaveValue(String(imported.abilities.health));

      // Might — npc-body.hbs line 51, default 2 per npc.mjs line 35.
      await expect(sheet.mightInput).toHaveValue(String(imported.might));

      // Skills — variable-length list from npc.mjs lines 38-41. Alchemist
      // has 3; assert row count + one rating round-trip.
      await expect(sheet.skillRows).toHaveCount(imported.skills.length);
      await expect(sheet.skillRatingInput(0)).toHaveValue(String(imported.skills[0].rating));
      // The skill <select> carries a `selected` option matching the stored
      // key — check the resolved value (an empty `value=""` is the
      // placeholder row, so a non-empty value implies the selected attr fired).
      await expect(sheet.skillKeySelect(0)).toHaveValue(imported.skills[0].key);

      // Wises — string array on the actor (not Items). Alchemist has 2.
      await expect(sheet.wiseRows).toHaveCount(imported.wises.length);
      await expect(sheet.wiseInput(0)).toHaveValue(imported.wises[0]);

      // Traits — embedded Item documents, rendered in the traits table.
      // Alchemist packs 2 trait items (Curious / Wise).
      await expect(sheet.traitRows).toHaveCount(imported.traitCount);

      // No uncaught page errors during the render cycle.
      expect(pageErrors, pageErrors.map((e) => e.message).join('\n')).toEqual([]);
    } finally {
      await cleanupTaggedActors(page, tag);
    }
  });
});
