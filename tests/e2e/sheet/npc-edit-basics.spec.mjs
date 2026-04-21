import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { NPCSheet } from '../pages/NPCSheet.mjs';
import { getActorByName } from '../helpers/game.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * Edit basic NPC fields and verify persistence across a close + re-render
 * of the sheet.
 *
 * Scope (per TEST_PLAN §21): name and "notes". The "notes" field maps to
 * `system.description` — a plain `StringField` on the NPC data model
 * (`module/data/actor/npc.mjs` line 75, labeled "GM notes"), rendered as a
 * `<textarea name="system.description">` in the description fieldset
 * (`templates/actors/npc-body.hbs` line 216). The "basics" strip
 * (stock / class / goal — `npc-body.hbs` lines 4-17) is covered as well,
 * since the identity summary line in the header is derived from those
 * fields (`module/applications/actor/npc-sheet.mjs` line 86-90) and
 * editing them is a natural extension of the "edit name" path.
 *
 * Persistence model: `NPCSheet.DEFAULT_OPTIONS.form.submitOnChange = true`
 * (`module/applications/actor/npc-sheet.mjs` line 27), so each `.fill()` +
 * blur auto-submits the AppV2 form. No Save button exists. Mirrors the
 * established pattern from `tests/e2e/sheet/edit-identity.spec.mjs` and
 * `tests/e2e/sheet/biography-edit.spec.mjs`.
 *
 * Actor source: Alchemist from `tb2e.npcs` — same reference NPC the
 * neighboring npc-open.spec.mjs uses. Tagged via `flags.tb2e.e2eTag` and
 * cleaned up in `finally` so the world stays tidy across repeated runs.
 */

const NPC_PACK_ID = 'tb2e.npcs';
const SOURCE_NPC = 'Alchemist';

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
      return { id: created.id, name: created.name };
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

test.describe('NPC sheet — edit basics', () => {
  test('edits name, description, and identity strip; persists across re-render', async ({
    page,
  }, testInfo) => {
    const tag = `e2e-npc-edit-${testInfo.workerIndex}-${Date.now()}`;
    const originalName = `${SOURCE_NPC} E2E ${Date.now()}`;
    const updatedName = `${originalName} Edited`;
    const updatedDescription = `GM-only notes. ${Date.now()}`;
    const updatedStock = 'Human';
    const updatedClass = 'Wandering Alchemist';
    const updatedGoal = 'Find the lost formula';

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    try {
      const imported = await importNpcFromPack(page, {
        packId: NPC_PACK_ID,
        sourceName: SOURCE_NPC,
        uniqueName: originalName,
        tag,
      });
      expect(imported.id).toBeTruthy();

      await page.evaluate((id) => {
        window.game.actors.get(id).sheet.render(true);
      }, imported.id);

      const sheet = new NPCSheet(page, originalName);
      await sheet.expectOpen();
      await expect(sheet.nameInput).toHaveValue(originalName);

      // --- 1. Name (header input; the window title is derived from it) ---
      await sheet.nameInput.fill(updatedName);
      await sheet.nameInput.blur();

      // Wait for the world actor to reflect the new name.
      await expect
        .poll(async () => (await getActorByName(page, updatedName))?.id ?? null)
        .toBe(imported.id);

      // --- 2. Description textarea — system.description (GM notes) ---
      // Plain StringField, so fill + blur is enough. The Alchemist source
      // ships with a non-empty description (role summary + page ref), so we
      // overwrite it and assert the new value round-trips.
      await sheet.descriptionTextarea.fill(updatedDescription);
      await sheet.descriptionTextarea.blur();

      await expect
        .poll(() =>
          page.evaluate(
            (id) => window.game.actors.get(id)?.system.description,
            imported.id
          )
        )
        .toBe(updatedDescription);

      // --- 3. Identity strip — stock / class / goal ---
      // npc-body.hbs lines 4-17. Each is a plain StringField per
      // data/actor/npc.mjs lines 8-10.
      await sheet.stockInput.fill(updatedStock);
      await sheet.stockInput.blur();
      await sheet.classInput.fill(updatedClass);
      await sheet.classInput.blur();
      await sheet.goalInput.fill(updatedGoal);
      await sheet.goalInput.blur();

      await expect
        .poll(() =>
          page.evaluate((id) => {
            const a = window.game.actors.get(id);
            return {
              stock: a?.system.stock,
              class: a?.system.class,
              goal: a?.system.goal,
            };
          }, imported.id)
        )
        .toEqual({
          stock: updatedStock,
          class: updatedClass,
          goal: updatedGoal,
        });

      // --- Close + re-render and assert DOM reflects persisted values ---
      await page.evaluate((id) => {
        window.game.actors.get(id).sheet.close();
      }, imported.id);
      await expect(sheet.root).toHaveCount(0);

      await page.evaluate((id) => {
        window.game.actors.get(id).sheet.render(true);
      }, imported.id);

      // The POM root is keyed by window title (`NPC: <name>`), which now
      // reflects the updated name — so re-construct against updatedName.
      const rerendered = new NPCSheet(page, updatedName);
      await rerendered.expectOpen();
      await expect(rerendered.nameInput).toHaveValue(updatedName);
      await expect(rerendered.descriptionTextarea).toHaveValue(updatedDescription);
      await expect(rerendered.stockInput).toHaveValue(updatedStock);
      await expect(rerendered.classInput).toHaveValue(updatedClass);
      await expect(rerendered.goalInput).toHaveValue(updatedGoal);

      // Final authoritative check against the data model.
      const persisted = await page.evaluate((id) => {
        const a = window.game.actors.get(id);
        return {
          name: a.name,
          description: a.system.description,
          stock: a.system.stock,
          class: a.system.class,
          goal: a.system.goal,
        };
      }, imported.id);
      expect(persisted).toEqual({
        name: updatedName,
        description: updatedDescription,
        stock: updatedStock,
        class: updatedClass,
        goal: updatedGoal,
      });
    } finally {
      await cleanupTaggedActors(page, tag);
    }
  });
});
