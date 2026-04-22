import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { CompendiumWindow } from '../pages/CompendiumWindow.mjs';
import { CharacterSheet } from '../pages/CharacterSheet.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §8 Compendiums — drag a spell from the `tb2e.spells` pack onto a
 * character sheet's magic tab.
 *
 * Contract: dropping a pack spell onto the magic tab should materialize a
 * new embedded `spell` Item on the actor whose system fields reflect the
 * pack source. The drop goes through ActorSheetV2's base `_onDrop*`
 * pipeline and the character sheet's override at
 *   module/applications/actor/character-sheet.mjs:2008 (#_onDropItem).
 * That override delegates to `super._onDropItem` (which calls
 * `Actor.createEmbeddedDocuments('Item', [src.toObject()])` under the hood
 * for cross-document drops). The magic tab panel has no
 * `[data-slot-key]` ancestor — only the inventory tab does — so the
 * post-super slot-assignment branch is a no-op for spell drops. The Magic
 * tab is always rendered (character-sheet.mjs #prepareMagicContext has no
 * class gating), so this works for a default character without needing to
 * set `system.class = "magician"`.
 *
 * Source spell: `Arcane Semblance` (packs/_source/spells/arcane-semblance.yml,
 * `_id: a1b2c3d4e5f60003`). Chosen as a stable entry with well-known
 * system fields (type: spell, circle: 1, castingType: factors, obstacle
 * displayed as "Factors", materials: "A bit of clay") we can assert on.
 *
 * Approach: programmatic drop via the sheet's `_onDropItem(event, item)`
 * entrypoint, mirroring drag-weapon-to-inventory.spec.mjs. Native
 * Playwright `dragTo` is flaky against AppV2 sheet windows (see the
 * weapon spec's notes); calling `_onDropItem` directly exercises the same
 * code path a real drag would, without the native-drag synchronization
 * problem. Entry id (not name substring) is used when fetching from the
 * pack — a defensive habit inherited from the weapon spec.
 *
 * Narrow scope — out of scope (covered by other specs in §6/§7/§8):
 *   - casting the spell (§6 Spells)
 *   - spellbook / memory palace interactions (§6)
 *   - invocations and relics (§7)
 *   - drops onto non-magic tabs (covered by drag-weapon-to-inventory)
 */
const SPELL_NAME = 'Arcane Semblance';
const SPELL_ID = 'a1b2c3d4e5f60003'; // packs/_source/spells/arcane-semblance.yml
const SPELLS_PACK = 'tb2e.spells';

test.describe('Compendium drag spell to character magic tab', () => {
  test('dropping a pack spell onto the magic tab creates an embedded Item', async ({ page }) => {
    const actorName = `E2E SpellDrop ${Date.now()}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Create a fresh character with no items so the dropped spell is
    // unambiguously identifiable (only spell item on the actor post-drop).
    const actorId = await page.evaluate(async (n) => {
      const actor = await Actor.create({ name: n, type: 'character' });
      return actor.id;
    }, actorName);
    expect(actorId).toBeTruthy();

    try {
      // Snapshot the pack entry's source data — we'll assert the created
      // item's system fields match. Fetched via the compendium collection,
      // which is the same source the drop handler ultimately copies from.
      const source = await page.evaluate(async ({ packId, entryId }) => {
        const pack = window.game.packs.get(packId);
        if (!pack) throw new Error(`Pack not found: ${packId}`);
        const entry = await pack.getDocument(entryId);
        if (!entry) throw new Error(`Entry "${entryId}" not found in ${packId}`);
        const obj = entry.toObject();
        return {
          name: obj.name,
          type: obj.type,
          circle: obj.system?.circle,
          castingType: obj.system?.castingType,
          fixedObstacle: obj.system?.fixedObstacle,
          materials: obj.system?.materials,
          scribeObstacle: obj.system?.scribeObstacle,
          learnObstacle: obj.system?.learnObstacle,
          factorCount: obj.system?.factors?.length ?? 0
        };
      }, { packId: SPELLS_PACK, entryId: SPELL_ID });
      expect(source.name).toBe(SPELL_NAME);
      expect(source.type).toBe('spell');
      expect(source.castingType).toBe('factors');

      // Open the sheet and land on the magic tab (the drop target).
      await page.evaluate((id) => {
        window.game.actors.get(id).sheet.render(true);
      }, actorId);

      const sheet = new CharacterSheet(page, actorName);
      await sheet.expectOpen();
      await sheet.openMagicTab();

      // Pre-state: the actor has no spell items.
      const initialSpellCount = await page.evaluate(
        (id) => (window.game.actors.get(id).itemTypes.spell || []).length,
        actorId
      );
      expect(initialSpellCount).toBe(0);

      // Render the Spells compendium window programmatically. The sidebar
      // nests packs inside folders that are collapsed by default; driving
      // expansion via DOM clicks is brittle and adds no coverage beyond
      // open-each-pack.spec.mjs. `pack.render(true)` bypasses that entirely
      // — learned from drag-weapon-to-inventory.spec.mjs.
      await page.evaluate(async (packId) => {
        const pack = window.game.packs.get(packId);
        await pack.render(true);
      }, SPELLS_PACK);

      const compWindow = new CompendiumWindow(page, SPELLS_PACK);
      await compWindow.waitForOpen();

      // Use entryById — entry names in tb2e.spells can be substring-
      // overlapping (e.g. "Eye of Omens" vs. "Eye of the Overworld").
      const entry = compWindow.entryById(SPELL_ID);
      await expect(entry).toBeVisible();
      await expect(entry).toContainText(SPELL_NAME);

      // Drop target: the magic tab section. The magic tab DOM has no
      // `[data-slot-key]` ancestors (only the inventory tab uses that),
      // so #_onDropItem's slot-assignment branch is a no-op here.
      const magicSection = sheet.root.locator('section[data-tab="magic"].active');
      await expect(magicSection).toBeVisible();

      // Programmatic drop — invoke the sheet's `_onDropItem` handler with
      // the compendium-sourced Item and a synthetic event whose target is
      // the magic section.
      const dropResult = await page.evaluate(
        async ({ id, packId, entryId }) => {
          const actor = window.game.actors.get(id);
          const sheetApp = actor.sheet;
          const pack = window.game.packs.get(packId);
          const item = await pack.getDocument(entryId);
          if (!item) throw new Error(`Entry "${entryId}" not found in ${packId}`);
          const target = sheetApp.element.querySelector('section[data-tab="magic"].active');
          if (!target) throw new Error("magic tab section not found");
          const event = new DragEvent("drop", { bubbles: true, cancelable: true });
          Object.defineProperty(event, "target", { value: target });
          const created = await sheetApp._onDropItem(event, item);
          return {
            createdId: Array.isArray(created) ? created[0]?.id : created?.id,
            createdName: Array.isArray(created) ? created[0]?.name : created?.name,
            spellCount: (actor.itemTypes.spell || []).length
          };
        },
        { id: actorId, packId: SPELLS_PACK, entryId: SPELL_ID }
      );
      expect(dropResult.createdName, `drop failed: ${JSON.stringify(dropResult)}`).toBe(SPELL_NAME);
      expect(dropResult.spellCount).toBe(1);

      // Wait for the spell item to land on the actor.
      await expect
        .poll(
          () =>
            page.evaluate(
              ({ id, name }) => {
                const items = window.game.actors
                  .get(id)
                  .items.filter((i) => i.type === 'spell' && i.name === name);
                return items.length;
              },
              { id: actorId, name: SPELL_NAME }
            ),
          { timeout: 10_000 }
        )
        .toBe(1);

      // Data-model assertions: the embedded item matches the pack source.
      const created = await page.evaluate(
        ({ id, name }) => {
          const item = window.game.actors
            .get(id)
            .items.find((i) => i.type === 'spell' && i.name === name);
          if (!item) return null;
          return {
            id: item.id,
            name: item.name,
            type: item.type,
            circle: item.system.circle,
            castingType: item.system.castingType,
            fixedObstacle: item.system.fixedObstacle,
            materials: item.system.materials,
            scribeObstacle: item.system.scribeObstacle,
            learnObstacle: item.system.learnObstacle,
            factorCount: item.system.factors?.length ?? 0,
            // Per-character runtime state should start clean (SpellData
            // initial values — module/data/item/spell.mjs).
            library: item.system.library,
            memorized: item.system.memorized,
            cast: item.system.cast,
            spellbookId: item.system.spellbookId
          };
        },
        { id: actorId, name: SPELL_NAME }
      );
      expect(created).not.toBeNull();
      expect(created.type).toBe('spell');
      expect(created.name).toBe(SPELL_NAME);
      expect(created.circle).toBe(source.circle);
      expect(created.castingType).toBe(source.castingType);
      expect(created.fixedObstacle).toBe(source.fixedObstacle);
      expect(created.materials).toBe(source.materials);
      expect(created.scribeObstacle).toBe(source.scribeObstacle);
      expect(created.learnObstacle).toBe(source.learnObstacle);
      expect(created.factorCount).toBe(source.factorCount);
      // Fresh per-character tracking state: not in library, not memorized,
      // not cast, not linked to a spellbook.
      expect(created.library).toBe(false);
      expect(created.memorized).toBe(false);
      expect(created.cast).toBe(false);
      expect(created.spellbookId).toBe('');

      // DOM assertion: the new spell renders as a row in the Arcane Spells
      // table on the magic tab.
      await expect(sheet.spellRow(created.id)).toBeVisible();
      await expect(sheet.spellRow(created.id)).toContainText(SPELL_NAME);
    } finally {
      await page.evaluate((id) => window.game.actors.get(id)?.delete(), actorId);
    }
  });
});
