import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { ActorsSidebar } from '../pages/ActorsSidebar.mjs';
import { CompendiumSidebar } from '../pages/CompendiumSidebar.mjs';
import { CompendiumWindow } from '../pages/CompendiumWindow.mjs';
import { getActorByName } from '../helpers/game.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * Import-from-iconic-characters — drag-drop + bulk import.
 *
 * The `tb2e.iconic-characters` pack (packs/_source/iconic-characters/) holds
 * pregenerated characters that players can import into a world by dragging
 * from the compendium window into the Actors sidebar. This spec verifies:
 *
 *   1. The UI-level drag-drop path materializes the actor correctly for one
 *      iconic (proof the sidebar DnD pipeline works end-to-end).
 *   2. The programmatic import path (what the drag handler ultimately calls
 *      under the hood — `Actor.implementation.create(src.toObject())`) yields
 *      actors whose `system.class` / `system.stock` match the pack source for
 *      all iconics.
 *
 * The ground-truth table below is the authoritative contract for the pack —
 * if an iconic is renamed or re-classed in the YAML source, this test will
 * fail loudly so the change is intentional.
 *
 * Source count: 9 iconics in packs/_source/iconic-characters/ (as of writing).
 * Class keys verified against CLASS_DEFS in module/data/actor/chargen.mjs.
 */
const EXPECTED = [
  { name: 'Beren of Carcaroth', class: 'outcast', stock: 'dwarf' },
  { name: 'Gerald', class: 'burglar', stock: 'halfling' },
  { name: 'Karolina', class: 'warrior', stock: 'human' },
  { name: 'Nienna', class: 'skald', stock: 'changeling' },
  { name: 'Rörik', class: 'shaman', stock: 'human' },
  { name: 'Taika', class: 'ranger', stock: 'elf' },
  { name: 'Tiziri', class: 'thief', stock: 'human' },
  { name: 'Ulrik', class: 'theurge', stock: 'human' },
  { name: 'Varg', class: 'magician', stock: 'human' },
];

/** UI drag path uses this iconic (one actor, to prove the DnD pipeline). */
const UI_DRAG_ICONIC = 'Taika';

/**
 * Delete any actors this spec created, identified by their `flags.tb2e.e2eTag`
 * flag (set at creation time). Run as afterEach / in the UI test's finally so
 * the Actors directory stays clean and names don't collide across specs.
 */
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

test.describe('Import from iconic-characters compendium', () => {
  test('drag one iconic from the compendium into the Actors sidebar', async ({ page }, testInfo) => {
    const tag = `e2e-iconic-ui-${testInfo.workerIndex}-${Date.now()}`;
    // Unique name suffix so this run doesn't collide with other specs that
    // may have dropped the same iconic (e.g. compendium-drag.spec.mjs).
    const uniqueName = `${UI_DRAG_ICONIC} E2E ${Date.now()}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    const compSidebar = new CompendiumSidebar(page);
    await compSidebar.open();
    await compSidebar.openPack('tb2e.iconic-characters');

    const compWindow = new CompendiumWindow(page, 'tb2e.iconic-characters');
    await compWindow.waitForOpen();

    const actors = new ActorsSidebar(page);
    await actors.open();

    const entry = compWindow.entryByName(UI_DRAG_ICONIC);
    await expect(entry).toBeVisible();
    await expect(actors.directoryList).toBeVisible();

    await entry.dragTo(actors.directoryList);

    // The drop creates an actor with the source name; wait for it, then
    // rename + tag it so cleanup doesn't hit other specs' actors.
    await expect
      .poll(() => getActorByName(page, UI_DRAG_ICONIC), { timeout: 10_000 })
      .not.toBeNull();

    const expected = EXPECTED.find((e) => e.name === UI_DRAG_ICONIC);
    expect(expected).toBeTruthy();

    try {
      const actual = await page.evaluate(
        async ({ sourceName, newName, t }) => {
          const a = window.game.actors.getName(sourceName);
          if (!a) return null;
          await a.update({ name: newName, 'flags.tb2e.e2eTag': t });
          return {
            type: a.type,
            class: a.system?.class,
            stock: a.system?.stock,
          };
        },
        { sourceName: UI_DRAG_ICONIC, newName: uniqueName, t: tag }
      );

      expect(actual).not.toBeNull();
      expect(actual.type).toBe('character');
      expect(actual.class).toBe(expected.class);
      expect(actual.stock).toBe(expected.stock);
    } finally {
      await cleanupTaggedActors(page, tag);
    }
  });

  test('bulk programmatic import of all iconics materializes class/stock correctly', async ({ page }, testInfo) => {
    const tag = `e2e-iconic-bulk-${testInfo.workerIndex}-${Date.now()}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Programmatic import — what the drag handler ultimately calls. Each
    // actor is created with a unique name + e2eTag flag so parallel specs
    // / previous runs don't collide.
    const imported = await page.evaluate(
      async ({ packId, t }) => {
        const pack = window.game.packs.get(packId);
        if (!pack) throw new Error(`Pack not found: ${packId}`);
        const docs = await pack.getDocuments();
        const results = [];
        for (let i = 0; i < docs.length; i++) {
          const src = docs[i];
          const data = src.toObject();
          const originalName = data.name;
          data.name = `${originalName} E2E ${Date.now()}-${i}`;
          // Foundry v13 flags path on create.
          data.flags = { ...(data.flags ?? {}), tb2e: { ...(data.flags?.tb2e ?? {}), e2eTag: t } };
          const created = await window.Actor.implementation.create(data);
          results.push({
            originalName,
            createdName: created?.name,
            type: created?.type,
            class: created?.system?.class,
            stock: created?.system?.stock,
          });
        }
        return results;
      },
      { packId: 'tb2e.iconic-characters', t: tag }
    );

    try {
      // Sanity: we should have imported at least as many as EXPECTED defines.
      expect(imported.length).toBe(EXPECTED.length);

      // Every EXPECTED entry must be present in the imported set with the
      // right class + stock.
      for (const expected of EXPECTED) {
        const got = imported.find((r) => r.originalName === expected.name);
        expect(got, `iconic "${expected.name}" missing from imported set`).toBeTruthy();
        expect(got.type).toBe('character');
        expect(got.class, `${expected.name} class mismatch`).toBe(expected.class);
        expect(got.stock, `${expected.name} stock mismatch`).toBe(expected.stock);
      }

      // And every imported iconic must be covered by EXPECTED (catches
      // new/unexpected entries added to the pack).
      for (const row of imported) {
        const expected = EXPECTED.find((e) => e.name === row.originalName);
        expect(
          expected,
          `imported iconic "${row.originalName}" not in EXPECTED table (pack has a new entry?)`
        ).toBeTruthy();
      }
    } finally {
      await cleanupTaggedActors(page, tag);
    }
  });
});
