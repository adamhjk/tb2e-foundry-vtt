import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { ConflictTracker } from '../pages/ConflictTracker.mjs';
import { ConflictPanel } from '../pages/ConflictPanel.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §12 Conflict: Setup — add two characters and two monsters to a newly
 * created conflict; assert the combatant list reflects the add on both the
 * Combat document and the panel DOM.
 *
 * Rules under test: team composition during conflict setup (DH pp.118-122 —
 * setting up teams, team captains). Sibling specs (setup-assign-captain,
 * setup-assign-boss, setup-select-type — TEST_PLAN.md L367-369) cover the
 * rest of §12.
 *
 * Implementation map (file:line refs verified against current source):
 *
 *   - Combatant-add path: the panel's setup tab exposes two UI affordances —
 *     a per-group select (`.add-combatant-select`, panel-setup.hbs L126-133)
 *     routed through `#onAddCombatant` (conflict-panel.mjs L2127-2158) and
 *     actor-drag-and-drop onto `.setup-group` routed through `#onDropActor`
 *     (conflict-panel.mjs L2165-2198). Both paths call
 *     `combat.createEmbeddedDocuments("Combatant", [{ actorId, name, img,
 *     group, type: "conflict", tokenId, sceneId }])`.
 *
 *   - The select dropdown is filtered to actor types `character`/`npc` that
 *     also have a token on the current scene (conflict-panel.mjs L655-660),
 *     so *monsters cannot be added via the select* — drop is the only UI
 *     path for them. This spec uses the same `createEmbeddedDocuments` call
 *     the drop handler makes (wrapped by `ConflictPanel.addCombatant`) so
 *     the assertions exercise the identical code path without the flakiness
 *     of HTML5 drag synthesis in Playwright.
 *
 *   - Grouping: combatants store their group on the top-level `group` field
 *     (not `system.group`) — see `combatant._source.group` reads throughout
 *     conflict-panel.mjs (L426, L537, L633, L721, …). `TB2ECombat.create`
 *     (combat.mjs L20-35) seeds two default CombatantGroups (PCTeam +
 *     NPCTeam), surfaced as `combat.groups`.
 *
 *   - Synthetic token rule: per CLAUDE.md, conflict code must use
 *     `combatant.actor` rather than `game.actors.get(actorId)` so unlinked
 *     monster tokens resolve to their synthetic actor. We assert on
 *     `combatant.actor?.id` / `combatant.actor?.type` directly so a
 *     regression that reintroduces the world-actor lookup would show up as
 *     a failing expectation here.
 *
 *   - Panel DOM contract: `panel-setup.hbs` L83-136 renders
 *     `<div class="setup-group" data-group-id>` per group with
 *     `<ul class="setup-combatant-list">` → `<li class="setup-combatant"
 *     data-combatant-id>`. This is what `ConflictPanel.setupGroups`,
 *     `setupCombatants`, and `setupGroupCombatants(groupId)` target.
 *
 * Cleanup: every combat + every actor this test created is deleted in
 * afterEach, guarded so a mid-test failure doesn't leak state into sibling
 * specs sharing the same worker.
 */

const MONSTER_PACK_ID = 'tb2e.monsters';

async function importMonster(page, { sourceName, uniqueName, tag }) {
  return page.evaluate(
    async ({ pId, src, name, t }) => {
      const pack = game.packs.get(pId);
      if ( !pack ) throw new Error(`Pack not found: ${pId}`);
      const docs = await pack.getDocuments();
      const source = docs.find((d) => d.name === src);
      if ( !source ) throw new Error(`Source "${src}" not in pack ${pId}`);
      const data = source.toObject();
      data.name = name;
      data.flags = {
        ...(data.flags ?? {}),
        tb2e: { ...(data.flags?.tb2e ?? {}), e2eTag: t }
      };
      const created = await Actor.implementation.create(data);
      return created.id;
    },
    { pId: MONSTER_PACK_ID, src: sourceName, name: uniqueName, t: tag }
  );
}

async function createCharacter(page, { name, tag }) {
  return page.evaluate(
    async ({ n, t }) => {
      const actor = await Actor.implementation.create({
        name: n,
        type: 'character',
        flags: { tb2e: { e2eTag: t } }
      });
      return actor.id;
    },
    { n: name, t: tag }
  );
}

async function cleanupTaggedActors(page, tag) {
  await page.evaluate(async (t) => {
    const ids = game.actors
      .filter((a) => a.getFlag?.('tb2e', 'e2eTag') === t)
      .map((a) => a.id);
    if ( ids.length ) await Actor.implementation.deleteDocuments(ids);
  }, tag);
}

test.describe('§12 Conflict: Setup — add combatants', () => {
  test.afterEach(async ({ page }) => {
    // Always close the panel singleton, delete any conflicts, and remove
    // tagged actors — otherwise sibling specs in the same worker inherit
    // an orphan Combat and stale actors in game.actors.
    await page.evaluate(async () => {
      try { await game.tb2e.conflictPanel?.close(); } catch {}
      const ids = Array.from(game.combats ?? []).map((c) => c.id);
      if ( ids.length ) await Combat.deleteDocuments(ids);
    });
  });

  test('GM adds two characters + two monsters; panel and combat roster reflect the add', async ({
    page
  }, testInfo) => {
    const tag = `e2e-setup-add-${testInfo.parallelIndex}-${Date.now()}`;
    const charAName = `E2E Char A ${Date.now()}`;
    const charBName = `E2E Char B ${Date.now()}`;
    const monsterAName = `E2E Kobold ${Date.now()}`;
    const monsterBName = `E2E Bugbear ${Date.now()}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    try {
      // Arrange — four world actors: 2 characters, 2 monsters imported from
      // the tb2e.monsters compendium (same pattern as sheet/monster-open.spec.mjs).
      const charA = await createCharacter(page, { name: charAName, tag });
      const charB = await createCharacter(page, { name: charBName, tag });
      const monA = await importMonster(page, {
        sourceName: 'Kobold',
        uniqueName: monsterAName,
        tag
      });
      const monB = await importMonster(page, {
        sourceName: 'Bugbear',
        uniqueName: monsterBName,
        tag
      });
      expect(charA).toBeTruthy();
      expect(charB).toBeTruthy();
      expect(monA).toBeTruthy();
      expect(monB).toBeTruthy();

      // Act — open the tracker and create a conflict (shipped in line 365).
      const tracker = new ConflictTracker(page);
      await tracker.open();
      await tracker.clickCreateConflict();

      // Resolve the combat + both group ids — group[0] is PCTeam (party),
      // group[1] is NPCTeam (gm), per combat.mjs L27-32 seed order. Poll
      // first so the async create has time to commit, then read the ids.
      await expect
        .poll(
          () =>
            page.evaluate(() => {
              const c = game.combats.find((x) => x.isConflict);
              return c ? c.groups.size : 0;
            }),
          { timeout: 10_000 }
        )
        .toBe(2);
      const { combatId, partyGroupId, gmGroupId } = await page.evaluate(() => {
        const c = game.combats.find((x) => x.isConflict);
        const g = Array.from(c.groups);
        return { combatId: c.id, partyGroupId: g[0].id, gmGroupId: g[1].id };
      });

      // Open the panel before adding — so the reactive re-render is also
      // exercised on each add (the panel listens to combatant CRUD hooks).
      const panel = new ConflictPanel(page);
      await panel.open();
      expect(await panel.activeTabId()).toBe('setup');
      await expect(panel.setupGroups).toHaveCount(2);
      await expect(panel.setupCombatants).toHaveCount(0);

      // Add 2 characters to the party group + 2 monsters to the gm group,
      // using the panel's own `combat.createEmbeddedDocuments("Combatant", …)`
      // path (see `ConflictPanel.addCombatant` docstring for why programmatic
      // beats synthesized DnD here).
      const combatantIds = {};
      combatantIds.charA = await panel.addCombatant({ combatId, actorId: charA, groupId: partyGroupId });
      combatantIds.charB = await panel.addCombatant({ combatId, actorId: charB, groupId: partyGroupId });
      combatantIds.monA = await panel.addCombatant({ combatId, actorId: monA, groupId: gmGroupId });
      combatantIds.monB = await panel.addCombatant({ combatId, actorId: monB, groupId: gmGroupId });
      for ( const [key, id] of Object.entries(combatantIds) ) {
        expect(id, `expected combatant id for ${key}`).toBeTruthy();
      }

      // Assert — Combat document has 4 combatants, 2 per group.
      const snapshot = await page.evaluate(
        ({ cId, partyId, gmId }) => {
          const c = game.combats.get(cId);
          const list = Array.from(c.combatants).map((co) => ({
            id: co.id,
            name: co.name,
            actorId: co.actorId,
            groupId: co._source.group,
            // Per CLAUDE.md: use `combatant.actor`, not
            // `game.actors.get(combatant.actorId)`. This resolves to the
            // synthetic token actor when one is present.
            actorResolved: !!co.actor,
            actorType: co.actor?.type ?? null,
            combatantType: co.type
          }));
          return {
            combatantCount: c.combatants.size,
            partyCount: list.filter((x) => x.groupId === partyId).length,
            gmCount: list.filter((x) => x.groupId === gmId).length,
            list
          };
        },
        { cId: combatId, partyId: partyGroupId, gmId: gmGroupId }
      );
      expect(snapshot.combatantCount).toBe(4);
      expect(snapshot.partyCount).toBe(2);
      expect(snapshot.gmCount).toBe(2);
      // Every combatant resolves to a live actor and carries conflict type.
      for ( const entry of snapshot.list ) {
        expect(entry.actorResolved, `combatant ${entry.name} must resolve via combatant.actor`).toBe(true);
        expect(entry.combatantType).toBe('conflict');
      }
      // Characters landed in the party group, monsters in the gm group.
      const partySide = snapshot.list.filter((x) => x.groupId === partyGroupId);
      const gmSide = snapshot.list.filter((x) => x.groupId === gmGroupId);
      expect(partySide.map((x) => x.actorType).sort()).toEqual(['character', 'character']);
      expect(gmSide.map((x) => x.actorType).sort()).toEqual(['monster', 'monster']);

      // Assert — panel DOM reflects the roster. Four <li.setup-combatant>
      // total, split 2/2 across the two <div.setup-group> sections.
      await expect(panel.setupCombatants).toHaveCount(4);
      await expect(panel.setupGroupCombatants(partyGroupId)).toHaveCount(2);
      await expect(panel.setupGroupCombatants(gmGroupId)).toHaveCount(2);

      // Each rendered combatant <li> carries a data-combatant-id that matches
      // one of the four we just created.
      const renderedIds = await panel.setupCombatants.evaluateAll((nodes) =>
        nodes.map((n) => n.dataset.combatantId)
      );
      expect(renderedIds.sort()).toEqual(
        [combatantIds.charA, combatantIds.charB, combatantIds.monA, combatantIds.monB].sort()
      );
    } finally {
      await cleanupTaggedActors(page, tag);
    }
  });
});
